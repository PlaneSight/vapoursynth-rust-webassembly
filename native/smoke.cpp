#include "browser_bridge.h"

#include <array>
#include <cstddef>
#include <cstdint>
#include <cstdio>

int main() {
    constexpr uint32_t width = 37;
    constexpr uint32_t height = 19;
    std::array<uint8_t, static_cast<size_t>(width) * height * 4> rgba{};

    const vs_browser_status status =
        vs_browser_render_inverted_blank(width, height, rgba.data(), static_cast<uint32_t>(rgba.size()));
    if (status != VS_BROWSER_STATUS_OK) {
        std::fprintf(stderr, "VapourSynth smoke render failed: %s\\n", vs_browser_status_message(status));
        return static_cast<int>(status);
    }

    for (size_t pixel = 0; pixel < static_cast<size_t>(width) * height; ++pixel) {
        const size_t offset = pixel * 4;
        if (rgba[offset] != UINT8_MAX || rgba[offset + 1] != UINT8_MAX ||
            rgba[offset + 2] != UINT8_MAX || rgba[offset + 3] != UINT8_MAX) {
            std::fputs("VapourSynth smoke render produced an unexpected RGBA pixel\\n", stderr);
            return 64;
        }
    }

    std::puts("VapourSynth BlankClip -> Invert -> RGBA smoke test passed");
    return 0;
}
