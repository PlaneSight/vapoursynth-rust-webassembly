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

namespace {

[[nodiscard]] bool expect_status(const char *operation, vs_browser_status actual, vs_browser_status expected) {
    if (actual == expected) {
        return true;
    }

    std::fprintf(stderr, "%s returned %d; expected %d\n", operation, actual, expected);
    return false;
}

[[nodiscard]] bool expect_opaque_white(const uint8_t *rgba, size_t pixel_count) {
    for (size_t pixel = 0; pixel < pixel_count; ++pixel) {
        const size_t offset = pixel * 4;
        if (rgba[offset] != UINT8_MAX || rgba[offset + 1] != UINT8_MAX ||
            rgba[offset + 2] != UINT8_MAX || rgba[offset + 3] != UINT8_MAX) {
            std::fputs("Rust ownership layer produced an unexpected RGBA pixel\n", stderr);
            return false;
        }
    }
    return true;
}

[[nodiscard]] bool render_and_verify(uint32_t width, uint32_t height) {
    const uint32_t rgba_size = width * height * 4;
    std::array<uint8_t, 37 * 19 * 4> rgba{};
    if (rgba_size != static_cast<uint32_t>(rgba.size())) {
        std::fputs("Rust smoke received an unsupported test frame size\n", stderr);
        return false;
    }

    const vs_browser_status status =
        vs_rust_render_inverted_blank(width, height, rgba.data(), static_cast<uint32_t>(rgba.size()));
    return expect_status("Rust ownership render", status, VS_BROWSER_STATUS_OK) &&
           expect_opaque_white(rgba.data(), static_cast<size_t>(width) * height);
}

} // namespace

int main() {
    constexpr uint32_t width = 37;
    constexpr uint32_t height = 19;
    constexpr uint32_t rgba_size = width * height * 4;

    if (vs_browser_handle_abi_version() != VS_BROWSER_HANDLE_ABI_VERSION) {
        std::fputs("Rust ownership smoke found an opaque handle ABI mismatch\n", stderr);
        return 65;
    }

    if (!expect_status(
            "Rust ownership render with a null output",
            vs_rust_render_inverted_blank(width, height, nullptr, 0),
            VS_BROWSER_STATUS_INVALID_ARGUMENT)) {
        return 66;
    }

    std::array<uint8_t, rgba_size - 1> short_output{};
    if (!expect_status(
            "Rust ownership render with a short output",
            vs_rust_render_inverted_blank(
                width,
                height,
                short_output.data(),
                static_cast<uint32_t>(short_output.size())),
            VS_BROWSER_STATUS_OUTPUT_TOO_SMALL)) {
        return 67;
    }

    std::array<uint8_t, 1> over_limit_output{};
    if (!expect_status(
            "Rust ownership render over the frame budget",
            vs_rust_render_inverted_blank(
                4097,
                1024,
                over_limit_output.data(),
                static_cast<uint32_t>(over_limit_output.size())),
            VS_BROWSER_STATUS_INVALID_ARGUMENT)) {
        return 68;
    }

    if (!render_and_verify(width, height) || !render_and_verify(width, height)) {
        return 69;
    }

    std::puts("Rust safe ownership to VapourSynth RGBA smoke test passed");
    return 0;
}
