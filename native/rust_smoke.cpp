#include "browser_bridge.h"

#include <array>
#include <cstddef>
#include <cstdint>
#include <cstdio>

extern "C" vs_browser_status vs_rust_render_inverted_blank(
    uint32_t width,
    uint32_t height,
    uint8_t *rgba,
    uint32_t rgba_size) noexcept;

int main() {
    constexpr uint32_t width = 37;
    constexpr uint32_t height = 19;
    constexpr uint32_t rgba_size = width * height * 4;

    const vs_browser_status null_status = vs_rust_render_inverted_blank(width, height, nullptr, 0);
    if (null_status != VS_BROWSER_STATUS_INVALID_ARGUMENT) {
        std::fprintf(stderr, "Rust probe did not reject a null output buffer: %d\n", null_status);
        return 65;
    }

    std::array<uint8_t, rgba_size - 1> short_output{};
    const vs_browser_status short_status =
        vs_rust_render_inverted_blank(width, height, short_output.data(), static_cast<uint32_t>(short_output.size()));
    if (short_status != VS_BROWSER_STATUS_OUTPUT_TOO_SMALL) {
        std::fprintf(stderr, "Rust probe did not reject a short output buffer: %d\n", short_status);
        return 66;
    }

    std::array<uint8_t, 1> over_limit_output{};
    const vs_browser_status over_limit_status =
        vs_rust_render_inverted_blank(4097, 1024, over_limit_output.data(),
            static_cast<uint32_t>(over_limit_output.size()));
    if (over_limit_status != VS_BROWSER_STATUS_INVALID_ARGUMENT) {
        std::fprintf(stderr, "Rust probe did not reject an over-limit frame: %d\n", over_limit_status);
        return 67;
    }

    std::array<uint8_t, rgba_size> rgba{};
    const vs_browser_status status =
        vs_rust_render_inverted_blank(width, height, rgba.data(), static_cast<uint32_t>(rgba.size()));
    if (status != VS_BROWSER_STATUS_OK) {
        std::fprintf(stderr, "Rust VapourSynth smoke render failed: %s\n", vs_browser_status_message(status));
        return static_cast<int>(status);
    }

    for (size_t pixel = 0; pixel < static_cast<size_t>(width) * height; ++pixel) {
        const size_t offset = pixel * 4;
        if (rgba[offset] != UINT8_MAX || rgba[offset + 1] != UINT8_MAX ||
            rgba[offset + 2] != UINT8_MAX || rgba[offset + 3] != UINT8_MAX) {
            std::fputs("Rust VapourSynth smoke render produced an unexpected RGBA pixel\n", stderr);
            return 68;
        }
    }

    std::puts("Rust -> VapourSynth -> RGBA ABI smoke test passed");
    return 0;
}
