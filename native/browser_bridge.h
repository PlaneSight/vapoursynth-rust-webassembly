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
};

/// Renders an inverted black RGB24 VapourSynth frame into caller-owned RGBA8 storage.
/// Frames whose RGBA8 output exceeds the 16 MiB spike budget are rejected.
VS_BROWSER_EXPORT vs_browser_status vs_browser_render_inverted_blank(
    uint32_t width,
    uint32_t height,
    uint8_t *rgba,
    uint32_t rgba_size) VS_BROWSER_NOEXCEPT;

/// Returns a stable description for a status returned by this C ABI.
VS_BROWSER_EXPORT const char *vs_browser_status_message(vs_browser_status status) VS_BROWSER_NOEXCEPT;

#ifdef __cplusplus
}
#endif

#undef VS_BROWSER_NOEXCEPT
#undef VS_BROWSER_EXPORT

#endif
