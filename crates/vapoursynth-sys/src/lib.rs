//! Raw imports for the browser bridge's stable C ABI.
//!
//! `VapourSynth` pointers remain entirely in the C++ bridge. This crate only
//! describes fixed-width statuses, opaque-token scalars, and transient output
//! spans used by the Emscripten-linked Rust ownership layer.

#![cfg_attr(not(test), no_std)]

/// Raw declarations for the Emscripten browser bridge.
pub mod browser {
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

    #[cfg(target_os = "emscripten")]
    unsafe extern "C" {
        /// Returns the opaque-token ABI version implemented by the C++ bridge.
        pub fn vs_browser_handle_abi_version() -> u32;

        /// Creates the single live upstream core and writes its opaque token.
        pub fn vs_browser_core_create(out_slot: *mut u32, out_generation: *mut u32) -> Status;

        /// Releases an opaque core token.
        pub fn vs_browser_core_release(slot: u32, generation: u32) -> Status;

        /// Creates an RGB24 `std.BlankClip` node from an opaque core token.
        pub fn vs_browser_core_blank_clip(
            core_slot: u32,
            core_generation: u32,
            width: u32,
            height: u32,
            out_node_slot: *mut u32,
            out_node_generation: *mut u32,
        ) -> Status;

        /// Creates an `std.Invert` node from an opaque node token.
        pub fn vs_browser_node_invert(
            node_slot: u32,
            node_generation: u32,
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
        assert_eq!(browser::HANDLE_ABI_VERSION, 1);
    }
}
