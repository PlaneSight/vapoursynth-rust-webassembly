//! Safe, thread-affine ownership of browser-hosted `VapourSynth` resources.
//!
//! The Emscripten implementation owns only typed opaque tokens. C++ retains
//! the `VSAPI` table and all actual upstream pointers, so Rust cannot expose a
//! core, node, frame, map, callback, or error-string pointer by accident.

#![cfg_attr(target_os = "emscripten", no_std)]

/// Allocation-free typed arguments for generic plugin invocation.
pub mod invocation;

use vapoursynth_sys::browser;

// The Emscripten build passes `-Cpanic=abort`. A no-`std` static library still
// needs this lang item; trap rather than unwinding through the C++ boundary.
#[cfg(target_os = "emscripten")]
#[panic_handler]
fn panic_handler(_: &core::panic::PanicInfo<'_>) -> ! {
    core::arch::wasm32::unreachable()
}

/// A failure reported by the browser bridge or detected at its Rust boundary.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Error {
    /// The caller supplied an invalid dimension, output slice, or frame number.
    InvalidArgument,
    /// The caller-owned RGBA8 slice is smaller than the required frame bytes.
    OutputTooSmall,
    /// The versioned upstream API table is unavailable.
    ApiUnavailable,
    /// The bridge could not create or configure the upstream core.
    CoreUnavailable,
    /// The statically registered standard plugin is unavailable.
    StandardPluginUnavailable,
    /// The bridge could not populate an upstream argument map.
    MapWriteFailed,
    /// An upstream plugin invocation failed.
    InvocationFailed,
    /// An upstream invocation did not return a usable node.
    NodeUnavailable,
    /// An upstream operation did not return a usable frame.
    FrameUnavailable,
    /// The upstream frame did not satisfy the required RGB24 contract.
    UnexpectedFrame,
    /// The bridge caught an unexpected internal C++ failure.
    InternalFailure,
    /// A synchronous upstream frame request failed.
    FrameRequestFailed,
    /// A token was zero, stale, vacant, or generation-mismatched.
    InvalidHandle,
    /// A token named a resource of the wrong kind.
    HandleKindMismatch,
    /// The bridge cannot issue another opaque token.
    HandleTableExhausted,
    /// The single-worker bridge already owns a live upstream core.
    CoreAlreadyActive,
    /// Rust and C++ disagree about their opaque-token ABI version.
    AbiMismatch {
        /// ABI version required by this Rust crate.
        expected: u32,
        /// ABI version reported by the C++ bridge.
        actual: u32,
    },
    /// A safe wrapper was explicitly closed and cannot be used again.
    Closed,
    /// C++ reported success without producing a valid non-zero token.
    ProtocolViolation,
    /// The C++ bridge returned an unrecognized fixed-width status value.
    UnknownStatus(browser::Status),
}

impl Error {
    /// Returns the fixed-width status used at the C ABI boundary.
    #[must_use]
    pub const fn status(self) -> browser::Status {
        match self {
            Self::InvalidArgument => browser::STATUS_INVALID_ARGUMENT,
            Self::OutputTooSmall => browser::STATUS_OUTPUT_TOO_SMALL,
            Self::ApiUnavailable => browser::STATUS_API_UNAVAILABLE,
            Self::CoreUnavailable => browser::STATUS_CORE_UNAVAILABLE,
            Self::StandardPluginUnavailable => browser::STATUS_STANDARD_PLUGIN_UNAVAILABLE,
            Self::MapWriteFailed => browser::STATUS_MAP_WRITE_FAILED,
            Self::InvocationFailed => browser::STATUS_INVOCATION_FAILED,
            Self::NodeUnavailable => browser::STATUS_NODE_UNAVAILABLE,
            Self::FrameUnavailable => browser::STATUS_FRAME_UNAVAILABLE,
            Self::UnexpectedFrame => browser::STATUS_UNEXPECTED_FRAME,
            Self::InternalFailure | Self::ProtocolViolation => browser::STATUS_INTERNAL_FAILURE,
            Self::FrameRequestFailed => browser::STATUS_FRAME_REQUEST_FAILED,
            Self::InvalidHandle | Self::Closed => browser::STATUS_INVALID_HANDLE,
            Self::HandleKindMismatch => browser::STATUS_HANDLE_KIND_MISMATCH,
            Self::HandleTableExhausted => browser::STATUS_HANDLE_TABLE_EXHAUSTED,
            Self::CoreAlreadyActive => browser::STATUS_CORE_ALREADY_ACTIVE,
            Self::AbiMismatch { .. } => browser::STATUS_ABI_MISMATCH,
            Self::UnknownStatus(status) => status,
        }
    }

    #[cfg(any(test, target_os = "emscripten"))]
    const fn from_status(status: browser::Status) -> Self {
        match status {
            browser::STATUS_INVALID_ARGUMENT => Self::InvalidArgument,
            browser::STATUS_OUTPUT_TOO_SMALL => Self::OutputTooSmall,
            browser::STATUS_API_UNAVAILABLE => Self::ApiUnavailable,
            browser::STATUS_CORE_UNAVAILABLE => Self::CoreUnavailable,
            browser::STATUS_STANDARD_PLUGIN_UNAVAILABLE => Self::StandardPluginUnavailable,
            browser::STATUS_MAP_WRITE_FAILED => Self::MapWriteFailed,
            browser::STATUS_INVOCATION_FAILED => Self::InvocationFailed,
            browser::STATUS_NODE_UNAVAILABLE => Self::NodeUnavailable,
            browser::STATUS_FRAME_UNAVAILABLE => Self::FrameUnavailable,
            browser::STATUS_UNEXPECTED_FRAME => Self::UnexpectedFrame,
            browser::STATUS_INTERNAL_FAILURE => Self::InternalFailure,
            browser::STATUS_FRAME_REQUEST_FAILED => Self::FrameRequestFailed,
            browser::STATUS_INVALID_HANDLE => Self::InvalidHandle,
            browser::STATUS_HANDLE_KIND_MISMATCH => Self::HandleKindMismatch,
            browser::STATUS_HANDLE_TABLE_EXHAUSTED => Self::HandleTableExhausted,
            browser::STATUS_CORE_ALREADY_ACTIVE => Self::CoreAlreadyActive,
            browser::STATUS_ABI_MISMATCH => Self::AbiMismatch {
                expected: browser::HANDLE_ABI_VERSION,
                actual: 0,
            },
            _ => Self::UnknownStatus(status),
        }
    }
}

/// Dimensions reported for an RGB24 frame before its RGBA8 copy.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct FrameDimensions {
    width: u32,
    height: u32,
}

impl FrameDimensions {
    /// Constructs dimensions returned by the C++ bridge.
    #[must_use]
    pub const fn new(width: u32, height: u32) -> Self {
        Self { width, height }
    }

    /// Returns the frame width in pixels.
    #[must_use]
    pub const fn width(self) -> u32 {
        self.width
    }

    /// Returns the frame height in pixels.
    #[must_use]
    pub const fn height(self) -> u32 {
        self.height
    }

    /// Returns the exact number of RGBA8 bytes needed for the frame.
    ///
    /// # Errors
    ///
    /// Returns [`Error::InvalidArgument`] if the dimensions overflow a `u32`
    /// byte count.
    pub fn rgba8_byte_len(self) -> Result<u32, Error> {
        self.width
            .checked_mul(self.height)
            .and_then(|pixels| pixels.checked_mul(4))
            .ok_or(Error::InvalidArgument)
    }
}

#[cfg(target_os = "emscripten")]
mod emscripten {
    use core::marker::PhantomData;
    use core::mem::MaybeUninit;
    use core::num::NonZeroU32;
    use core::slice;

    use vapoursynth_sys::browser;

    use crate::{Error, FrameDimensions};

    #[derive(Clone, Copy, Debug, Eq, PartialEq)]
    struct Token {
        slot: NonZeroU32,
        generation: NonZeroU32,
    }

    impl Token {
        fn from_raw(slot: u32, generation: u32) -> Result<Self, Error> {
            let slot = NonZeroU32::new(slot).ok_or(Error::ProtocolViolation)?;
            let generation = NonZeroU32::new(generation).ok_or(Error::ProtocolViolation)?;
            Ok(Self { slot, generation })
        }

        const fn slot(self) -> u32 {
            self.slot.get()
        }

        const fn generation(self) -> u32 {
            self.generation.get()
        }
    }

    fn check_status(status: browser::Status) -> Result<(), Error> {
        if status == browser::STATUS_OK {
            Ok(())
        } else {
            Err(Error::from_status(status))
        }
    }

    fn token_from_output(
        slot: MaybeUninit<u32>,
        generation: MaybeUninit<u32>,
    ) -> Result<Token, Error> {
        // Safety: every C++ token-creation function documents that an OK status
        // writes both output fields. Callers invoke this only after check_status.
        let slot = unsafe { slot.assume_init() };
        // Safety: see the preceding safety argument for the paired output field.
        let generation = unsafe { generation.assume_init() };
        Token::from_raw(slot, generation)
    }

    /// Owns one browser-hosted upstream core through a non-transferable token.
    pub struct Core {
        token: Option<Token>,
        _thread_bound: PhantomData<*mut ()>,
    }

    impl Core {
        /// Creates the only live upstream core permitted by this browser build.
        ///
        /// # Errors
        ///
        /// Returns a bridge error if the ABI does not match, another core or its
        /// child leases remain live, or upstream core creation fails.
        pub fn create() -> Result<Self, Error> {
            // Safety: this imported C function accepts no pointers and has no
            // ownership transfer. It only reads the bridge's ABI version.
            let actual_abi = unsafe { browser::vs_browser_handle_abi_version() };
            if actual_abi != browser::HANDLE_ABI_VERSION {
                return Err(Error::AbiMismatch {
                    expected: browser::HANDLE_ABI_VERSION,
                    actual: actual_abi,
                });
            }

            let mut slot = MaybeUninit::uninit();
            let mut generation = MaybeUninit::uninit();
            // Safety: both output pointers refer to valid writable local storage
            // for the duration of the synchronous C++ call.
            let status = unsafe {
                browser::vs_browser_core_create(slot.as_mut_ptr(), generation.as_mut_ptr())
            };
            check_status(status)?;
            let token = token_from_output(slot, generation)?;
            Ok(Self {
                token: Some(token),
                _thread_bound: PhantomData,
            })
        }

        /// Creates an RGB24 `std.BlankClip` node associated with this core.
        ///
        /// # Errors
        ///
        /// Returns a bridge error if the core is closed, the dimensions exceed
        /// the fixed frame budget, or the plugin invocation fails.
        pub fn blank_clip(&self, width: u32, height: u32) -> Result<Node<'_>, Error> {
            let core = self.token.ok_or(Error::Closed)?;
            let mut slot = MaybeUninit::uninit();
            let mut generation = MaybeUninit::uninit();
            // Safety: the core token is privately held, and both output pointers
            // refer to valid writable local storage for this synchronous call.
            let status = unsafe {
                browser::vs_browser_core_blank_clip(
                    core.slot(),
                    core.generation(),
                    width,
                    height,
                    slot.as_mut_ptr(),
                    generation.as_mut_ptr(),
                )
            };
            check_status(status)?;
            let token = token_from_output(slot, generation)?;
            Ok(Node {
                token: Some(token),
                _core: PhantomData,
                _thread_bound: PhantomData,
            })
        }

        /// Releases the core token before drop.
        ///
        /// # Errors
        ///
        /// Returns [`Error::Closed`] when called more than once, or a bridge
        /// error if the token has become invalid unexpectedly.
        pub fn close(&mut self) -> Result<(), Error> {
            let token = self.token.ok_or(Error::Closed)?;
            // Safety: this token was created by the paired C++ constructor and
            // is kept private, so its slot and generation are well-formed.
            let status =
                unsafe { browser::vs_browser_core_release(token.slot(), token.generation()) };
            check_status(status)?;
            self.token = None;
            Ok(())
        }
    }

    impl Drop for Core {
        fn drop(&mut self) {
            if let Some(token) = self.token.take() {
                // Safety: a live safe wrapper owns exactly this matching token.
                // Drop cannot report a release error and must not panic across C.
                let _ =
                    unsafe { browser::vs_browser_core_release(token.slot(), token.generation()) };
            }
        }
    }

    /// Owns one browser-hosted upstream node associated with a [`Core`].
    pub struct Node<'core> {
        token: Option<Token>,
        _core: PhantomData<&'core Core>,
        _thread_bound: PhantomData<*mut ()>,
    }

    impl<'core> Node<'core> {
        /// Creates an `std.Invert` node that retains this node as its input.
        ///
        /// # Errors
        ///
        /// Returns [`Error::Closed`] when this node was released, or a bridge
        /// error if the upstream invocation fails.
        pub fn invert(&self) -> Result<Self, Error> {
            let source = self.token.ok_or(Error::Closed)?;
            let mut slot = MaybeUninit::uninit();
            let mut generation = MaybeUninit::uninit();
            // Safety: the source token is privately owned by this live wrapper,
            // and both output pointers reference writable local storage.
            let status = unsafe {
                browser::vs_browser_node_invert(
                    source.slot(),
                    source.generation(),
                    slot.as_mut_ptr(),
                    generation.as_mut_ptr(),
                )
            };
            check_status(status)?;
            let token = token_from_output(slot, generation)?;
            Ok(Self {
                token: Some(token),
                _core: PhantomData,
                _thread_bound: PhantomData,
            })
        }

        /// Requests one synchronous frame from this node.
        ///
        /// # Errors
        ///
        /// Returns [`Error::Closed`] when this node was released, or a bridge
        /// error if the request or frame allocation fails.
        pub fn frame(&self, frame_number: u32) -> Result<Frame<'core>, Error> {
            let node = self.token.ok_or(Error::Closed)?;
            let mut slot = MaybeUninit::uninit();
            let mut generation = MaybeUninit::uninit();
            // Safety: the node token is privately owned by this live wrapper,
            // and both output pointers reference writable local storage.
            let status = unsafe {
                browser::vs_browser_node_get_frame(
                    node.slot(),
                    node.generation(),
                    frame_number,
                    slot.as_mut_ptr(),
                    generation.as_mut_ptr(),
                )
            };
            check_status(status)?;
            let token = token_from_output(slot, generation)?;
            Ok(Frame {
                token: Some(token),
                _core: PhantomData,
                _thread_bound: PhantomData,
            })
        }

        /// Releases the node token before drop.
        ///
        /// # Errors
        ///
        /// Returns [`Error::Closed`] when called more than once, or a bridge
        /// error if the token has become invalid unexpectedly.
        pub fn close(&mut self) -> Result<(), Error> {
            let token = self.token.ok_or(Error::Closed)?;
            // Safety: this token was created by the paired C++ constructor and
            // is kept private, so its slot and generation are well-formed.
            let status =
                unsafe { browser::vs_browser_node_release(token.slot(), token.generation()) };
            check_status(status)?;
            self.token = None;
            Ok(())
        }
    }

    impl Drop for Node<'_> {
        fn drop(&mut self) {
            if let Some(token) = self.token.take() {
                // Safety: a live safe wrapper owns exactly this matching token.
                // Drop cannot report a release error and must not panic across C.
                let _ =
                    unsafe { browser::vs_browser_node_release(token.slot(), token.generation()) };
            }
        }
    }

    /// Owns one browser-hosted frame associated with a [`Core`].
    pub struct Frame<'core> {
        token: Option<Token>,
        _core: PhantomData<&'core Core>,
        _thread_bound: PhantomData<*mut ()>,
    }

    impl Frame<'_> {
        /// Returns this frame's validated RGB24 dimensions.
        ///
        /// # Errors
        ///
        /// Returns [`Error::Closed`] when this frame was released, or a bridge
        /// error when upstream did not return the expected frame representation.
        pub fn dimensions(&self) -> Result<FrameDimensions, Error> {
            let frame = self.token.ok_or(Error::Closed)?;
            let mut width = MaybeUninit::uninit();
            let mut height = MaybeUninit::uninit();
            // Safety: the frame token is privately owned by this live wrapper,
            // and both output pointers reference writable local storage.
            let status = unsafe {
                browser::vs_browser_frame_dimensions(
                    frame.slot(),
                    frame.generation(),
                    width.as_mut_ptr(),
                    height.as_mut_ptr(),
                )
            };
            check_status(status)?;
            // Safety: an OK status from the C++ bridge writes both dimensions.
            let width = unsafe { width.assume_init() };
            // Safety: see the preceding safety argument for the paired output.
            let height = unsafe { height.assume_init() };
            Ok(FrameDimensions::new(width, height))
        }

        /// Returns the exact caller-owned RGBA8 byte count required for this frame.
        ///
        /// # Errors
        ///
        /// Returns [`Error::Closed`] when this frame was released, or a bridge
        /// error when upstream did not return an eligible RGB24 frame.
        pub fn rgba8_size(&self) -> Result<u32, Error> {
            let frame = self.token.ok_or(Error::Closed)?;
            let mut size = MaybeUninit::uninit();
            // Safety: the frame token is privately owned by this live wrapper,
            // and the output pointer references writable local storage.
            let status = unsafe {
                browser::vs_browser_frame_rgba8_size(
                    frame.slot(),
                    frame.generation(),
                    size.as_mut_ptr(),
                )
            };
            check_status(status)?;
            // Safety: an OK status from the C++ bridge writes the output size.
            Ok(unsafe { size.assume_init() })
        }

        /// Copies this frame into the caller's RGBA8 storage without allocation.
        ///
        /// # Errors
        ///
        /// Returns [`Error::OutputTooSmall`] when `output` is shorter than the
        /// required byte count, or a bridge error if this frame is no longer valid.
        pub fn copy_rgba8(&self, output: &mut [u8]) -> Result<(), Error> {
            let frame = self.token.ok_or(Error::Closed)?;
            let required_size = self.rgba8_size()?;
            let output_size = u32::try_from(output.len()).map_err(|_| Error::InvalidArgument)?;
            if output_size < required_size {
                return Err(Error::OutputTooSmall);
            }

            // Safety: the token is privately owned by this live wrapper. The
            // mutable slice guarantees a non-null, exclusive pointer valid for
            // output_size bytes, and C++ retains neither pointer nor contents.
            let status = unsafe {
                browser::vs_browser_frame_copy_rgba8(
                    frame.slot(),
                    frame.generation(),
                    output.as_mut_ptr(),
                    output_size,
                )
            };
            check_status(status)
        }

        /// Releases the frame token before drop.
        ///
        /// # Errors
        ///
        /// Returns [`Error::Closed`] when called more than once, or a bridge
        /// error if the token has become invalid unexpectedly.
        pub fn close(&mut self) -> Result<(), Error> {
            let token = self.token.ok_or(Error::Closed)?;
            // Safety: this token was created by the paired C++ constructor and
            // is kept private, so its slot and generation are well-formed.
            let status =
                unsafe { browser::vs_browser_frame_release(token.slot(), token.generation()) };
            check_status(status)?;
            self.token = None;
            Ok(())
        }
    }

    impl Drop for Frame<'_> {
        fn drop(&mut self) {
            if let Some(token) = self.token.take() {
                // Safety: a live safe wrapper owns exactly this matching token.
                // Drop cannot report a release error and must not panic across C.
                let _ =
                    unsafe { browser::vs_browser_frame_release(token.slot(), token.generation()) };
            }
        }
    }

    fn render_inverted_blank(width: u32, height: u32, output: &mut [u8]) -> Result<(), Error> {
        let mut core = Core::create()?;
        {
            let mut blank = core.blank_clip(width, height)?;
            let mut inverted = blank.invert()?;
            blank.close()?;

            let mut frame = inverted.frame(0)?;
            inverted.close()?;
            frame.copy_rgba8(output)?;
            frame.close()?;
        }
        core.close()
    }

    /// Renders an inverted blank frame through the safe Rust ownership layer.
    ///
    /// # Safety
    ///
    /// `rgba` must be non-null, exclusively writable for `rgba_size` bytes,
    /// and remain valid until this synchronous call returns. C++ retains neither
    /// the pointer nor the output bytes.
    #[unsafe(no_mangle)]
    pub unsafe extern "C" fn vs_rust_render_inverted_blank(
        width: u32,
        height: u32,
        rgba: *mut u8,
        rgba_size: u32,
    ) -> browser::Status {
        if rgba.is_null() {
            return browser::STATUS_INVALID_ARGUMENT;
        }
        let Ok(length) = usize::try_from(rgba_size) else {
            return browser::STATUS_INVALID_ARGUMENT;
        };

        // Safety: the C caller upholds the pointer, length, and exclusivity
        // contract documented on this entry point for the synchronous call.
        let output = unsafe { slice::from_raw_parts_mut(rgba, length) };
        match render_inverted_blank(width, height, output) {
            Ok(()) => browser::STATUS_OK,
            Err(error) => error.status(),
        }
    }
}

#[cfg(target_os = "emscripten")]
pub use emscripten::{Core, Frame, Node};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dimensions_calculate_rgba8_bytes() {
        assert_eq!(FrameDimensions::new(37, 19).rgba8_byte_len(), Ok(2_812));
    }

    #[test]
    fn status_translation_preserves_unknown_values() {
        assert_eq!(
            Error::from_status(browser::STATUS_INVALID_HANDLE),
            Error::InvalidHandle
        );
        assert_eq!(Error::from_status(-123), Error::UnknownStatus(-123));
    }
}
