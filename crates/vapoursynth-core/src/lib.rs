//! Rust-prefixed opaque-handle forwarders for the browser-hosted `VapourSynth`
//! core.
//!
//! The Emscripten implementation exports the `vs_rust_*` entry points the
//! worker runtime calls. Each forwarder validates its spans, pointers, and
//! argument descriptors against the shared ABI and then delegates to the C++
//! bridge. C++ retains the `VSAPI` table and all actual upstream pointers, so
//! Rust never exposes a core, node, frame, map, callback, or error-string
//! pointer.

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
    /// The requested plugin namespace or function is not registered.
    UnknownFunction,
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
            Self::UnknownFunction => browser::STATUS_UNKNOWN_FUNCTION,
            Self::AbiMismatch { .. } => browser::STATUS_ABI_MISMATCH,
            Self::UnknownStatus(status) => status,
        }
    }

    #[cfg(test)]
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
            browser::STATUS_UNKNOWN_FUNCTION => Self::UnknownFunction,
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
    use core::slice;

    use vapoursynth_sys::browser;

    use crate::invocation;

    /// Zeroes a caller-owned error buffer when one is present.
    fn clear_error(error: *mut u8, error_size: u32) {
        if !error.is_null() && error_size != 0 {
            // Safety: a non-null error pointer with a positive size is
            // exclusively writable for the duration of the call.
            unsafe { *error = 0 };
        }
    }

    /// Rejects null or empty byte spans.
    fn span_ok(bytes: *const u8, length: u32) -> bool {
        !bytes.is_null() && length != 0
    }

    /// Creates the single live upstream core through the Rust-prefixed ABI.
    ///
    /// Checks the opaque-token ABI version before forwarding and zeroes both
    /// outputs on every failure.
    ///
    /// # Safety
    ///
    /// `out_slot` and `out_generation` must be non-null and writable for the
    /// duration of the synchronous call.
    #[unsafe(no_mangle)]
    pub unsafe extern "C" fn vs_rust_core_create(
        out_slot: *mut u32,
        out_generation: *mut u32,
    ) -> browser::Status {
        if out_slot.is_null() || out_generation.is_null() {
            return browser::STATUS_INVALID_ARGUMENT;
        }
        // Safety: both outputs were checked non-null and are writable.
        unsafe {
            *out_slot = 0;
            *out_generation = 0;
        }

        // Safety: the ABI version query takes no pointers.
        let actual_abi = unsafe { browser::vs_browser_handle_abi_version() };
        if actual_abi != browser::HANDLE_ABI_VERSION {
            return browser::STATUS_ABI_MISMATCH;
        }

        // Safety: the C++ bridge validates and zeroes the outputs itself on
        // every failure path; the pointers remain writable for the call.
        unsafe { browser::vs_browser_core_create(out_slot, out_generation) }
    }

    /// Releases an opaque core token through the Rust-prefixed ABI.
    ///
    /// # Safety
    ///
    /// `slot` and `generation` must name a token created by
    /// [`vs_rust_core_create`] unless the call is intentionally probing for
    /// an invalid handle.
    #[unsafe(no_mangle)]
    pub unsafe extern "C" fn vs_rust_core_release(slot: u32, generation: u32) -> browser::Status {
        // Safety: pure scalar forward with no pointer arguments.
        unsafe { browser::vs_browser_core_release(slot, generation) }
    }

    /// Invokes one plugin function generically through the Rust-prefixed ABI.
    ///
    /// Validates every span, pointer, and argument descriptor before
    /// forwarding; the C++ bridge re-validates as the ABI authority. Both
    /// output fields are zeroed before work begins and the caller error buffer
    /// is NUL-terminated when present.
    ///
    /// # Safety
    ///
    /// Every byte span (`namespace_name`, `function_name`, `result_key`, and
    /// each descriptor's key and values) must be valid and readable for its
    /// declared length, aligned as its kind requires, and stable for the
    /// duration of the synchronous call. `error` must be writable for
    /// `error_size` bytes when `error_size` is non-zero, and both output
    /// pointers must be non-null and writable.
    #[unsafe(no_mangle)]
    pub unsafe extern "C" fn vs_rust_core_invoke(
        core_slot: u32,
        core_generation: u32,
        namespace_name: *const u8,
        namespace_length: u32,
        function_name: *const u8,
        function_length: u32,
        arguments: *const browser::Argument,
        argument_count: u32,
        result_key: *const u8,
        result_key_length: u32,
        result_index: u32,
        error: *mut u8,
        error_size: u32,
        out_node_slot: *mut u32,
        out_node_generation: *mut u32,
    ) -> browser::Status {
        if out_node_slot.is_null() || out_node_generation.is_null() {
            return browser::STATUS_INVALID_ARGUMENT;
        }
        // Safety: both outputs were checked non-null and are writable.
        unsafe {
            *out_node_slot = 0;
            *out_node_generation = 0;
        }

        if !span_ok(namespace_name, namespace_length)
            || !span_ok(function_name, function_length)
            || !span_ok(result_key, result_key_length)
            || (error_size != 0 && error.is_null())
            || (argument_count != 0 && arguments.is_null())
        {
            clear_error(error, error_size);
            return browser::STATUS_INVALID_ARGUMENT;
        }

        if argument_count != 0 {
            // Safety: the caller guarantees `argument_count` readable
            // descriptors at `arguments`; each is validated before use.
            let descriptors = unsafe { slice::from_raw_parts(arguments, argument_count as usize) };
            for descriptor in descriptors {
                // Safety: the enclosing C ABI contract keeps every non-null
                // descriptor span readable for this synchronous invocation.
                if unsafe { invocation::Argument::from_descriptor(descriptor) }.is_err() {
                    clear_error(error, error_size);
                    return browser::STATUS_INVALID_ARGUMENT;
                }
            }
        }

        // Safety: every span and pointer above was validated, and the C++
        // bridge re-validates everything before touching upstream state.
        unsafe {
            browser::vs_browser_core_invoke(
                core_slot,
                core_generation,
                namespace_name,
                namespace_length,
                function_name,
                function_length,
                arguments,
                argument_count,
                result_key,
                result_key_length,
                result_index,
                error,
                error_size,
                out_node_slot,
                out_node_generation,
            )
        }
    }

    /// Requests one synchronous frame through the Rust-prefixed ABI.
    ///
    /// # Safety
    ///
    /// Both output pointers must be non-null and writable for the duration of
    /// the synchronous call.
    #[unsafe(no_mangle)]
    pub unsafe extern "C" fn vs_rust_node_get_frame(
        node_slot: u32,
        node_generation: u32,
        frame_number: u32,
        out_frame_slot: *mut u32,
        out_frame_generation: *mut u32,
    ) -> browser::Status {
        if out_frame_slot.is_null() || out_frame_generation.is_null() {
            return browser::STATUS_INVALID_ARGUMENT;
        }
        // Safety: the C++ bridge validates the token and zeroes both outputs
        // on every failure path; the pointers remain writable for the call.
        unsafe {
            browser::vs_browser_node_get_frame(
                node_slot,
                node_generation,
                frame_number,
                out_frame_slot,
                out_frame_generation,
            )
        }
    }

    /// Releases an opaque node token through the Rust-prefixed ABI.
    ///
    /// # Safety
    ///
    /// `slot` and `generation` must name a token produced by
    /// [`vs_rust_core_invoke`] unless the call is intentionally probing for an
    /// invalid handle.
    #[unsafe(no_mangle)]
    pub unsafe extern "C" fn vs_rust_node_release(slot: u32, generation: u32) -> browser::Status {
        // Safety: pure scalar forward with no pointer arguments.
        unsafe { browser::vs_browser_node_release(slot, generation) }
    }

    /// Returns the dimensions of an opaque RGB24 frame token.
    ///
    /// # Safety
    ///
    /// Both output pointers must be non-null and writable for the duration of
    /// the synchronous call.
    #[unsafe(no_mangle)]
    pub unsafe extern "C" fn vs_rust_frame_dimensions(
        slot: u32,
        generation: u32,
        out_width: *mut u32,
        out_height: *mut u32,
    ) -> browser::Status {
        if out_width.is_null() || out_height.is_null() {
            return browser::STATUS_INVALID_ARGUMENT;
        }
        // Safety: the C++ bridge zeroes both outputs on failure; the pointers
        // remain writable for the synchronous call.
        unsafe { browser::vs_browser_frame_dimensions(slot, generation, out_width, out_height) }
    }

    /// Returns the exact RGBA8 byte count for an opaque frame token.
    ///
    /// # Safety
    ///
    /// `out_size` must be non-null and writable for the duration of the
    /// synchronous call.
    #[unsafe(no_mangle)]
    pub unsafe extern "C" fn vs_rust_frame_rgba8_size(
        slot: u32,
        generation: u32,
        out_size: *mut u32,
    ) -> browser::Status {
        if out_size.is_null() {
            return browser::STATUS_INVALID_ARGUMENT;
        }
        // Safety: the C++ bridge zeroes the output on failure; the pointer
        // remains writable for the synchronous call.
        unsafe { browser::vs_browser_frame_rgba8_size(slot, generation, out_size) }
    }

    /// Copies an opaque frame token into caller-owned RGBA8 memory.
    ///
    /// # Safety
    ///
    /// `rgba` must be non-null and exclusively writable for `rgba_size` bytes
    /// and remain valid until the synchronous call returns. C++ retains
    /// neither the pointer nor the output bytes.
    #[unsafe(no_mangle)]
    pub unsafe extern "C" fn vs_rust_frame_copy_rgba8(
        slot: u32,
        generation: u32,
        rgba: *mut u8,
        rgba_size: u32,
    ) -> browser::Status {
        if rgba.is_null() {
            return browser::STATUS_INVALID_ARGUMENT;
        }
        // Safety: the caller upholds the pointer, length, and exclusivity
        // contract documented on this entry point for the synchronous call.
        unsafe { browser::vs_browser_frame_copy_rgba8(slot, generation, rgba, rgba_size) }
    }

    /// Releases an opaque frame token through the Rust-prefixed ABI.
    ///
    /// # Safety
    ///
    /// `slot` and `generation` must name a token produced by
    /// [`vs_rust_node_get_frame`] unless the call is intentionally probing for
    /// an invalid handle.
    #[unsafe(no_mangle)]
    pub unsafe extern "C" fn vs_rust_frame_release(slot: u32, generation: u32) -> browser::Status {
        // Safety: pure scalar forward with no pointer arguments.
        unsafe { browser::vs_browser_frame_release(slot, generation) }
    }
}

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
        assert_eq!(
            Error::from_status(browser::STATUS_UNKNOWN_FUNCTION),
            Error::UnknownFunction
        );
        assert_eq!(
            Error::UnknownFunction.status(),
            browser::STATUS_UNKNOWN_FUNCTION
        );
        assert_eq!(Error::from_status(-123), Error::UnknownStatus(-123));
    }
}
