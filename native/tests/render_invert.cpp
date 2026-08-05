#include "browser_bridge.h"

#include <array>
#include <cstddef>
#include <cstdint>
#include <cstdio>

namespace {

struct Token final {
    uint32_t slot = 0;
    uint32_t generation = 0;
};

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
            std::fputs("VapourSynth produced an unexpected RGBA pixel\n", stderr);
            return false;
        }
    }
    return true;
}

[[nodiscard]] bool verify_one_shot_control() {
    constexpr uint32_t width = 37;
    constexpr uint32_t height = 19;
    constexpr uint32_t rgba_size = width * height * 4;

    std::array<uint8_t, rgba_size> rgba{};
    const vs_browser_status status =
        vs_browser_render_inverted_blank(width, height, rgba.data(), static_cast<uint32_t>(rgba.size()));
    return expect_status("one-shot upstream control", status, VS_BROWSER_STATUS_OK) &&
           expect_opaque_white(rgba.data(), static_cast<size_t>(width) * height);
}

[[nodiscard]] bool find_stale_generation(const std::array<Token, 4> &released, Token replacement, uint32_t &result) {
    result = 0;
    for (const Token token : released) {
        if (token.slot == replacement.slot) {
            result = token.generation;
            return true;
        }
    }
    return false;
}

[[nodiscard]] bool verify_opaque_handle_lifecycle() {
    constexpr uint32_t width = 37;
    constexpr uint32_t height = 19;
    constexpr uint32_t rgba_size = width * height * 4;

    if (vs_browser_handle_abi_version() != VS_BROWSER_HANDLE_ABI_VERSION) {
        std::fputs("opaque handle ABI version mismatch\n", stderr);
        return false;
    }

    if (!expect_status(
            "zero core token",
            vs_browser_core_release(0, 0),
            VS_BROWSER_STATUS_INVALID_HANDLE) ||
        !expect_status(
            "unknown node token",
            vs_browser_node_release(UINT32_MAX, 1),
            VS_BROWSER_STATUS_INVALID_HANDLE)) {
        return false;
    }

    uint32_t null_generation = UINT32_MAX;
    if (!expect_status(
            "core creation with a null slot output",
            vs_browser_core_create(nullptr, &null_generation),
            VS_BROWSER_STATUS_INVALID_ARGUMENT) ||
        null_generation != 0) {
        std::fputs("failed token output was not cleared\n", stderr);
        return false;
    }

    Token core;
    if (!expect_status(
            "core creation",
            vs_browser_core_create(&core.slot, &core.generation),
            VS_BROWSER_STATUS_OK)) {
        return false;
    }

    Token failed_node{UINT32_MAX, UINT32_MAX};
    if (!expect_status(
            "invalid BlankClip creation",
            vs_browser_core_blank_clip(
                core.slot,
                core.generation,
                0,
                height,
                &failed_node.slot,
                &failed_node.generation),
            VS_BROWSER_STATUS_INVALID_ARGUMENT) ||
        failed_node.slot != 0 || failed_node.generation != 0) {
        std::fputs("failed BlankClip creation retained an output token\n", stderr);
        return false;
    }

    Token blank;
    if (!expect_status(
            "BlankClip creation",
            vs_browser_core_blank_clip(
                core.slot,
                core.generation,
                width,
                height,
                &blank.slot,
                &blank.generation),
            VS_BROWSER_STATUS_OK)) {
        return false;
    }

    Token inverted;
    if (!expect_status(
            "Invert creation",
            vs_browser_node_invert(blank.slot, blank.generation, &inverted.slot, &inverted.generation),
            VS_BROWSER_STATUS_OK)) {
        return false;
    }

    Token frame;
    if (!expect_status(
            "frame request",
            vs_browser_node_get_frame(
                inverted.slot,
                inverted.generation,
                0,
                &frame.slot,
                &frame.generation),
            VS_BROWSER_STATUS_OK)) {
        return false;
    }

    uint32_t wrong_width = UINT32_MAX;
    uint32_t wrong_height = UINT32_MAX;
    if (!expect_status(
            "frame dimensions with a node token",
            vs_browser_frame_dimensions(inverted.slot, inverted.generation, &wrong_width, &wrong_height),
            VS_BROWSER_STATUS_HANDLE_KIND_MISMATCH) ||
        wrong_width != 0 || wrong_height != 0) {
        std::fputs("wrong-kind frame query did not clear its output\n", stderr);
        return false;
    }

    if (!expect_status(
            "node release with a core token",
            vs_browser_node_release(core.slot, core.generation),
            VS_BROWSER_STATUS_HANDLE_KIND_MISMATCH) ||
        !expect_status(
            "core release before child leases",
            vs_browser_core_release(core.slot, core.generation),
            VS_BROWSER_STATUS_OK) ||
        !expect_status(
            "double core release",
            vs_browser_core_release(core.slot, core.generation),
            VS_BROWSER_STATUS_INVALID_HANDLE)) {
        return false;
    }

    Token blocked_core{UINT32_MAX, UINT32_MAX};
    if (!expect_status(
            "second core while child leases remain",
            vs_browser_core_create(&blocked_core.slot, &blocked_core.generation),
            VS_BROWSER_STATUS_CORE_ALREADY_ACTIVE) ||
        blocked_core.slot != 0 || blocked_core.generation != 0) {
        std::fputs("blocked core creation retained an output token\n", stderr);
        return false;
    }

    if (!expect_status(
            "BlankClip node release",
            vs_browser_node_release(blank.slot, blank.generation),
            VS_BROWSER_STATUS_OK) ||
        !expect_status(
            "Invert node release",
            vs_browser_node_release(inverted.slot, inverted.generation),
            VS_BROWSER_STATUS_OK)) {
        return false;
    }

    uint32_t frame_width = 0;
    uint32_t frame_height = 0;
    uint32_t frame_size = 0;
    if (!expect_status(
            "frame dimensions after parent release",
            vs_browser_frame_dimensions(frame.slot, frame.generation, &frame_width, &frame_height),
            VS_BROWSER_STATUS_OK) ||
        frame_width != width || frame_height != height ||
        !expect_status(
            "frame RGBA8 size",
            vs_browser_frame_rgba8_size(frame.slot, frame.generation, &frame_size),
            VS_BROWSER_STATUS_OK) ||
        frame_size != rgba_size) {
        std::fputs("frame metadata did not survive parent release\n", stderr);
        return false;
    }

    std::array<uint8_t, rgba_size - 1> short_output{};
    if (!expect_status(
            "short RGBA8 copy",
            vs_browser_frame_copy_rgba8(
                frame.slot,
                frame.generation,
                short_output.data(),
                static_cast<uint32_t>(short_output.size())),
            VS_BROWSER_STATUS_OUTPUT_TOO_SMALL)) {
        return false;
    }

    std::array<uint8_t, rgba_size> rgba{};
    if (!expect_status(
            "RGBA8 copy after parent release",
            vs_browser_frame_copy_rgba8(frame.slot, frame.generation, rgba.data(), static_cast<uint32_t>(rgba.size())),
            VS_BROWSER_STATUS_OK) ||
        !expect_opaque_white(rgba.data(), static_cast<size_t>(width) * height)) {
        return false;
    }

    if (!expect_status(
            "frame release",
            vs_browser_frame_release(frame.slot, frame.generation),
            VS_BROWSER_STATUS_OK) ||
        !expect_status(
            "copy after frame release",
            vs_browser_frame_copy_rgba8(frame.slot, frame.generation, rgba.data(), static_cast<uint32_t>(rgba.size())),
            VS_BROWSER_STATUS_INVALID_HANDLE)) {
        return false;
    }

    Token replacement_core;
    if (!expect_status(
            "core creation after all leases release",
            vs_browser_core_create(&replacement_core.slot, &replacement_core.generation),
            VS_BROWSER_STATUS_OK)) {
        return false;
    }

    uint32_t stale_generation = 0;
    const std::array<Token, 4> released{core, blank, inverted, frame};
    if (!find_stale_generation(released, replacement_core, stale_generation)) {
        std::fputs("handle table did not reuse a released slot\n", stderr);
        return false;
    }
    if (!expect_status(
            "reused slot with stale generation",
            vs_browser_core_release(replacement_core.slot, stale_generation),
            VS_BROWSER_STATUS_INVALID_HANDLE) ||
        !expect_status(
            "replacement core release",
            vs_browser_core_release(replacement_core.slot, replacement_core.generation),
            VS_BROWSER_STATUS_OK)) {
        return false;
    }

    return true;
}

} // namespace

int main() {
    if (!verify_one_shot_control() || !verify_opaque_handle_lifecycle()) {
        return 1;
    }

    std::puts("VapourSynth opaque-handle render-invert proof passed");
    return 0;
}
