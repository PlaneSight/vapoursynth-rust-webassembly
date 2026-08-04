//! Raw VapourSynth ABI boundary.
//!
//! Generated bindings and upstream symbols belong here. Higher-level crates
//! must not duplicate C layouts or call raw functions directly.

#![cfg_attr(not(test), no_std)]

use core::ffi::{c_char, c_void};

/// Opaque upstream core type.
#[repr(C)]
pub struct VSCore {
    _private: [u8; 0],
}

/// Opaque upstream node type.
#[repr(C)]
pub struct VSNode {
    _private: [u8; 0],
}

/// Opaque upstream frame type.
#[repr(C)]
pub struct VSFrame {
    _private: [u8; 0],
}

/// Opaque upstream map type.
#[repr(C)]
pub struct VSMap {
    _private: [u8; 0],
}

/// Minimal callback type retained while the generated API is not checked in.
pub type VSMessageHandler = unsafe extern "C" fn(
    message_type: i32,
    message: *const c_char,
    user_data: *mut c_void,
);

/// Marker proving the crate is currently a scaffold, not linked upstream.
pub const UPSTREAM_LINKED: bool = cfg!(feature = "upstream");

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opaque_types_are_zero_sized_markers() {
        assert_eq!(core::mem::size_of::<VSCore>(), 0);
        assert_eq!(core::mem::size_of::<VSNode>(), 0);
        assert_eq!(core::mem::size_of::<VSFrame>(), 0);
        assert_eq!(core::mem::size_of::<VSMap>(), 0);
    }
}
