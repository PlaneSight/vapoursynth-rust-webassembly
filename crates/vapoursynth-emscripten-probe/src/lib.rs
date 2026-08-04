//! A non-unwinding `Rust` to browser-bridge ABI probe.
//!
//! This crate is deliberately smaller than the eventual ownership layer. It
//! proves that one `Emscripten`-linked `Rust` static library can call the
//! narrow `C++` bridge and return its fixed-width status without exposing an
//! upstream pointer or a `JavaScript` binding.

#![cfg_attr(target_os = "emscripten", no_std)]

// The probe build passes `-Cpanic=abort`. A `no_std` static library still
// needs this lang item; trap rather than unwinding across the C ABI.
#[cfg(target_os = "emscripten")]
#[panic_handler]
fn panic_handler(_: &core::panic::PanicInfo<'_>) -> ! {
    core::arch::wasm32::unreachable()
}

#[cfg(target_os = "emscripten")]
mod emscripten {
    use core::ffi::c_uchar;

    /// Mirrors the bridge's fixed-width C status ABI.
    pub type BrowserStatus = i32;

    unsafe extern "C" {
        fn vs_browser_render_inverted_blank(
            width: u32,
            height: u32,
            rgba: *mut c_uchar,
            rgba_size: u32,
        ) -> BrowserStatus;
    }

    /// Renders the browser spike through Rust and into caller-owned RGBA8 memory.
    ///
    /// This is a deliberately plain C entry point used only by the `C++` ABI
    /// smoke. The real `JavaScript`-facing boundary remains the `C++`
    /// bridge.
    ///
    /// # Safety
    ///
    /// `rgba` must be non-null, exclusively writable for `rgba_size` bytes,
    /// and remain valid until this synchronous call returns. The native bridge
    /// retains neither the pointer nor the output bytes.
    #[unsafe(no_mangle)]
    pub unsafe extern "C" fn vs_rust_render_inverted_blank(
        width: u32,
        height: u32,
        rgba: *mut c_uchar,
        rgba_size: u32,
    ) -> BrowserStatus {
        // Safety: the C caller upholds the documented pointer, length, and
        // exclusivity contract. The C++ bridge catches its own exceptions and
        // returns a status instead of unwinding into Rust.
        unsafe { vs_browser_render_inverted_blank(width, height, rgba, rgba_size) }
    }
}
