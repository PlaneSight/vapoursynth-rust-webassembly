#ifndef VAPOURSYNTH_BROWSER_BRIDGE_H
#define VAPOURSYNTH_BROWSER_BRIDGE_H

#include <stddef.h>
#include <stdint.h>

#if defined(__EMSCRIPTEN__)
#include <emscripten/emscripten.h>
#define VS_BROWSER_EXPORT EMSCRIPTEN_KEEPALIVE
#else
#define VS_BROWSER_EXPORT
#endif

#ifdef __cplusplus
#define VS_BROWSER_NOEXCEPT noexcept
extern "C" {
#else
#define VS_BROWSER_NOEXCEPT
#endif

typedef int32_t vs_browser_status;

enum {
    VS_BROWSER_STATUS_OK = 0,
    VS_BROWSER_STATUS_INVALID_ARGUMENT = 1,
    VS_BROWSER_STATUS_OUTPUT_TOO_SMALL = 2,
    VS_BROWSER_STATUS_API_UNAVAILABLE = 3,
    VS_BROWSER_STATUS_CORE_UNAVAILABLE = 4,
    VS_BROWSER_STATUS_STANDARD_PLUGIN_UNAVAILABLE = 5,
    VS_BROWSER_STATUS_MAP_WRITE_FAILED = 6,
    VS_BROWSER_STATUS_INVOCATION_FAILED = 7,
    VS_BROWSER_STATUS_NODE_UNAVAILABLE = 8,
    VS_BROWSER_STATUS_FRAME_UNAVAILABLE = 9,
    VS_BROWSER_STATUS_UNEXPECTED_FRAME = 10,
    VS_BROWSER_STATUS_INTERNAL_FAILURE = 11,
    VS_BROWSER_STATUS_FRAME_REQUEST_FAILED = 12,
    VS_BROWSER_STATUS_INVALID_HANDLE = 13,
    VS_BROWSER_STATUS_HANDLE_KIND_MISMATCH = 14,
    VS_BROWSER_STATUS_HANDLE_TABLE_EXHAUSTED = 15,
    VS_BROWSER_STATUS_CORE_ALREADY_ACTIVE = 16,
    VS_BROWSER_STATUS_ABI_MISMATCH = 17,
};

#define VS_BROWSER_HANDLE_ABI_VERSION UINT32_C(1)

/// Returns the version of the scalar opaque-handle ABI.
VS_BROWSER_EXPORT uint32_t vs_browser_handle_abi_version(void) VS_BROWSER_NOEXCEPT;

/// Creates the only active browser core and returns its opaque token.
///
/// Both output fields are set to zero before work begins and are non-zero only
/// when this function returns [`VS_BROWSER_STATUS_OK`].
VS_BROWSER_EXPORT vs_browser_status vs_browser_core_create(
    uint32_t *out_slot,
    uint32_t *out_generation) VS_BROWSER_NOEXCEPT;

/// Releases a core token. Node and frame leases keep its actual core alive.
VS_BROWSER_EXPORT vs_browser_status vs_browser_core_release(
    uint32_t slot,
    uint32_t generation) VS_BROWSER_NOEXCEPT;

/// Creates an RGB24 `std.BlankClip` node owned by the supplied core token.
VS_BROWSER_EXPORT vs_browser_status vs_browser_core_blank_clip(
    uint32_t core_slot,
    uint32_t core_generation,
    uint32_t width,
    uint32_t height,
    uint32_t *out_node_slot,
    uint32_t *out_node_generation) VS_BROWSER_NOEXCEPT;

/// Creates a `std.Invert` node from a retained node token.
VS_BROWSER_EXPORT vs_browser_status vs_browser_node_invert(
    uint32_t node_slot,
    uint32_t node_generation,
    uint32_t *out_node_slot,
    uint32_t *out_node_generation) VS_BROWSER_NOEXCEPT;

/// Requests one synchronous frame from a retained node token.
VS_BROWSER_EXPORT vs_browser_status vs_browser_node_get_frame(
    uint32_t node_slot,
    uint32_t node_generation,
    uint32_t frame_number,
    uint32_t *out_frame_slot,
    uint32_t *out_frame_generation) VS_BROWSER_NOEXCEPT;

/// Releases a node token.
VS_BROWSER_EXPORT vs_browser_status vs_browser_node_release(
    uint32_t slot,
    uint32_t generation) VS_BROWSER_NOEXCEPT;

/// Returns the dimensions of an RGB24 frame retained by a frame token.
VS_BROWSER_EXPORT vs_browser_status vs_browser_frame_dimensions(
    uint32_t slot,
    uint32_t generation,
    uint32_t *out_width,
    uint32_t *out_height) VS_BROWSER_NOEXCEPT;

/// Returns the exact RGBA8 byte count required to copy a retained frame.
VS_BROWSER_EXPORT vs_browser_status vs_browser_frame_rgba8_size(
    uint32_t slot,
    uint32_t generation,
    uint32_t *out_size) VS_BROWSER_NOEXCEPT;

/// Copies a retained RGB24 frame into caller-owned RGBA8 storage.
///
/// Frames whose RGBA8 output exceeds the 16 MiB browser-spike budget are
/// rejected. The bridge retains neither the output pointer nor its bytes.
VS_BROWSER_EXPORT vs_browser_status vs_browser_frame_copy_rgba8(
    uint32_t slot,
    uint32_t generation,
    uint8_t *rgba,
    uint32_t rgba_size) VS_BROWSER_NOEXCEPT;

/// Releases a frame token.
VS_BROWSER_EXPORT vs_browser_status vs_browser_frame_release(
    uint32_t slot,
    uint32_t generation) VS_BROWSER_NOEXCEPT;

/// Renders an inverted black RGB24 VapourSynth frame into caller-owned RGBA8 storage.
/// Frames whose RGBA8 output exceeds the 16 MiB spike budget are rejected.
VS_BROWSER_EXPORT vs_browser_status vs_browser_render_inverted_blank(
    uint32_t width,
    uint32_t height,
    uint8_t *rgba,
    uint32_t rgba_size) VS_BROWSER_NOEXCEPT;

#ifdef __cplusplus
}
#endif

#undef VS_BROWSER_NOEXCEPT
#undef VS_BROWSER_EXPORT

#endif
