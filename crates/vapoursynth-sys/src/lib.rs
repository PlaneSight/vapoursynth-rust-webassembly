//! Raw imports for the browser bridge's stable C ABI.
//!
//! `VapourSynth` pointers remain entirely in the C++ bridge. This crate only
//! describes fixed-width statuses, argument descriptors, opaque-token scalars,
//! and transient output spans used by the Emscripten-linked Rust ownership
//! layer.

#![cfg_attr(not(test), no_std)]

/// Raw declarations for the Emscripten browser bridge.
pub mod browser {
    use core::ffi::c_void;

    /// Fixed-width status value returned by the C++ bridge.
    pub type Status = i32;

    /// Version of the opaque-token ABI expected by this crate.
    pub const HANDLE_ABI_VERSION: u32 = 1;

    /// The operation completed successfully.
    pub const STATUS_OK: Status = 0;
    /// The caller supplied an invalid scalar, output pointer, or byte span.
    pub const STATUS_INVALID_ARGUMENT: Status = 1;
    /// The supplied output span is smaller than the required RGBA8 bytes.
    pub const STATUS_OUTPUT_TOO_SMALL: Status = 2;
    /// The versioned upstream API table is unavailable.
    pub const STATUS_API_UNAVAILABLE: Status = 3;
    /// The bridge could not create or configure the upstream core.
    pub const STATUS_CORE_UNAVAILABLE: Status = 4;
    /// The statically registered standard plugin is unavailable.
    pub const STATUS_STANDARD_PLUGIN_UNAVAILABLE: Status = 5;
    /// The bridge could not populate an upstream argument map.
    pub const STATUS_MAP_WRITE_FAILED: Status = 6;
    /// An upstream plugin invocation failed.
    pub const STATUS_INVOCATION_FAILED: Status = 7;
    /// An upstream invocation did not return a usable node.
    pub const STATUS_NODE_UNAVAILABLE: Status = 8;
    /// An upstream operation did not return a usable frame.
    pub const STATUS_FRAME_UNAVAILABLE: Status = 9;
    /// The returned frame does not meet the RGB24 contract.
    pub const STATUS_UNEXPECTED_FRAME: Status = 10;
    /// The bridge caught an unexpected internal C++ failure.
    pub const STATUS_INTERNAL_FAILURE: Status = 11;
    /// A synchronous upstream frame request failed.
    pub const STATUS_FRAME_REQUEST_FAILED: Status = 12;
    /// The opaque token is zero, stale, vacant, or generation-mismatched.
    pub const STATUS_INVALID_HANDLE: Status = 13;
    /// The opaque token names a resource of the wrong kind.
    pub const STATUS_HANDLE_KIND_MISMATCH: Status = 14;
    /// The bridge cannot issue another opaque token.
    pub const STATUS_HANDLE_TABLE_EXHAUSTED: Status = 15;
    /// The single-worker bridge already owns a live upstream core.
    pub const STATUS_CORE_ALREADY_ACTIVE: Status = 16;
    /// Rust and C++ disagree about their handwritten opaque-token ABI.
    pub const STATUS_ABI_MISMATCH: Status = 17;
    /// The requested plugin namespace or function is not registered.
    pub const STATUS_UNKNOWN_FUNCTION: Status = 18;

    /// Signed 64-bit integers: aligned `i64` values.
    pub const ARGUMENT_INT: u32 = 1;
    /// Double-precision floats: aligned `f64` values.
    pub const ARGUMENT_FLOAT: u32 = 2;
    /// Opaque binary bytes; `value_count` is the byte length.
    pub const ARGUMENT_DATA: u32 = 3;
    /// Node tokens: `(u32 slot, u32 generation)` pairs.
    pub const ARGUMENT_NODE: u32 = 4;

    /// One keyed argument descriptor for the generic invoke entry point.
    ///
    /// Mirrors `struct vs_browser_argument` in `native/browser_bridge.h`:
    /// 20 bytes on wasm32 with 4-byte alignment and fields at offsets 0, 4,
    /// 8, 12, and 16. `key` is a NUL-free byte span; for INT/FLOAT/NODE kinds
    /// `value_count` counts elements (INT and FLOAT element storage is 8-byte
    /// aligned, NODE storage is `(slot, generation)` pairs), and for DATA it
    /// is the byte length. `value_count` is at least 1 and `values` is
    /// non-null.
    #[repr(C)]
    #[derive(Clone, Copy)]
    pub struct Argument {
        /// Key bytes without a required NUL terminator.
        pub key: *const u8,
        /// Length of the key byte span.
        pub key_length: u32,
        /// One of the `ARGUMENT_*` kind constants.
        pub kind: u32,
        /// Element storage for `value_count` typed values.
        pub values: *const c_void,
        /// INT/FLOAT/NODE element count, or the byte length for DATA.
        pub value_count: u32,
    }

    #[cfg(target_os = "emscripten")]
    unsafe extern "C" {
        /// Returns the opaque-token ABI version implemented by the C++ bridge.
        pub fn vs_browser_handle_abi_version() -> u32;

        /// Creates the single live upstream core and writes its opaque token.
        pub fn vs_browser_core_create(out_slot: *mut u32, out_generation: *mut u32) -> Status;

        /// Releases an opaque core token.
        pub fn vs_browser_core_release(slot: u32, generation: u32) -> Status;

        /// Invokes one plugin function generically and writes its result node
        /// token and caller error text.
        pub fn vs_browser_core_invoke(
            core_slot: u32,
            core_generation: u32,
            namespace_name: *const u8,
            namespace_length: u32,
            function_name: *const u8,
            function_length: u32,
            arguments: *const Argument,
            argument_count: u32,
            result_key: *const u8,
            result_key_length: u32,
            result_index: u32,
            error: *mut u8,
            error_size: u32,
            out_node_slot: *mut u32,
            out_node_generation: *mut u32,
        ) -> Status;

        /// Requests a frame from an opaque node token.
        pub fn vs_browser_node_get_frame(
            node_slot: u32,
            node_generation: u32,
            frame_number: u32,
            out_frame_slot: *mut u32,
            out_frame_generation: *mut u32,
        ) -> Status;

        /// Returns video metadata for an opaque node token.
        pub fn vs_browser_node_video_info(
            node_slot: u32,
            node_generation: u32,
            out_width: *mut u32,
            out_height: *mut u32,
            out_num_frames: *mut u32,
            out_fps_num: *mut i64,
            out_fps_den: *mut i64,
        ) -> Status;

        /// Creates a C++-owned RGB24 source node.
        pub fn vs_browser_source_create(
            core_slot: u32,
            core_generation: u32,
            width: u32,
            height: u32,
            num_frames: u32,
            fps_num: i64,
            fps_den: i64,
            out_node_slot: *mut u32,
            out_node_generation: *mut u32,
        ) -> Status;

        /// Uploads one tightly packed RGBA8 frame into a source node.
        pub fn vs_browser_source_upload_rgba(
            node_slot: u32,
            node_generation: u32,
            frame_number: u32,
            rgba: *const u8,
            rgba_size: u32,
            duration_num: i64,
            duration_den: i64,
            absolute_time: f64,
        ) -> Status;

        /// Releases an opaque node token.
        pub fn vs_browser_node_release(slot: u32, generation: u32) -> Status;

        /// Returns the dimensions of an opaque RGB24 frame token.
        pub fn vs_browser_frame_dimensions(
            slot: u32,
            generation: u32,
            out_width: *mut u32,
            out_height: *mut u32,
        ) -> Status;

        /// Returns the required RGBA8 output size for an opaque frame token.
        pub fn vs_browser_frame_rgba8_size(
            slot: u32,
            generation: u32,
            out_size: *mut u32,
        ) -> Status;

        /// Copies an opaque frame token into caller-owned RGBA8 memory.
        pub fn vs_browser_frame_copy_rgba8(
            slot: u32,
            generation: u32,
            rgba: *mut u8,
            rgba_size: u32,
        ) -> Status;

        /// Releases an opaque frame token.
        pub fn vs_browser_frame_release(slot: u32, generation: u32) -> Status;

        /// Returns optional timing metadata for an opaque frame token.
        pub fn vs_browser_frame_timing(
            frame_slot: u32,
            frame_generation: u32,
            out_duration_num: *mut i64,
            out_duration_den: *mut i64,
            out_absolute_time: *mut f64,
            out_flags: *mut u32,
        ) -> Status;
    }
}

#[cfg(test)]
mod tests {
    use super::browser;

    #[test]
    fn opaque_handle_status_values_remain_distinct() {
        assert_ne!(
            browser::STATUS_INVALID_HANDLE,
            browser::STATUS_HANDLE_KIND_MISMATCH
        );
        assert_ne!(
            browser::STATUS_HANDLE_KIND_MISMATCH,
            browser::STATUS_HANDLE_TABLE_EXHAUSTED
        );
        assert_ne!(
            browser::STATUS_ABI_MISMATCH,
            browser::STATUS_UNKNOWN_FUNCTION
        );
        assert_eq!(browser::HANDLE_ABI_VERSION, 1);
    }

    #[test]
    fn argument_kinds_are_stable_and_distinct() {
        let kinds = [
            browser::ARGUMENT_INT,
            browser::ARGUMENT_FLOAT,
            browser::ARGUMENT_DATA,
            browser::ARGUMENT_NODE,
        ];
        for (index, kind) in kinds.iter().enumerate() {
            assert!(!kinds[..index].contains(kind));
        }
        assert_eq!(kinds[0], 1);
        assert_eq!(kinds[3], 4);
    }

    #[test]
    #[cfg(target_pointer_width = "32")]
    fn argument_descriptor_layout_matches_the_c_abi() {
        assert_eq!(core::mem::size_of::<browser::Argument>(), 20);
        assert_eq!(core::mem::align_of::<browser::Argument>(), 4);
        assert_eq!(core::mem::offset_of!(browser::Argument, key), 0);
        assert_eq!(core::mem::offset_of!(browser::Argument, key_length), 4);
        assert_eq!(core::mem::offset_of!(browser::Argument, kind), 8);
        assert_eq!(core::mem::offset_of!(browser::Argument, values), 12);
        assert_eq!(core::mem::offset_of!(browser::Argument, value_count), 16);
    }
}
