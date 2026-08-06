#include "bridge_test_util.h"

#include <VapourSynth4.h>

#include <array>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstring>

extern "C" vs_browser_status vs_rust_core_create(
    uint32_t *out_slot,
    uint32_t *out_generation) noexcept;
extern "C" vs_browser_status vs_rust_core_release(uint32_t slot, uint32_t generation) noexcept;
extern "C" vs_browser_status vs_rust_core_invoke(
    uint32_t core_slot,
    uint32_t core_generation,
    const uint8_t *namespace_name,
    uint32_t namespace_length,
    const uint8_t *function_name,
    uint32_t function_length,
    const vs_browser_argument *arguments,
    uint32_t argument_count,
    const uint8_t *result_key,
    uint32_t result_key_length,
    uint32_t result_index,
    char *error,
    uint32_t error_size,
    uint32_t *out_node_slot,
    uint32_t *out_node_generation) noexcept;
extern "C" vs_browser_status vs_rust_node_get_frame(
    uint32_t node_slot,
    uint32_t node_generation,
    uint32_t frame_number,
    uint32_t *out_frame_slot,
    uint32_t *out_frame_generation) noexcept;
extern "C" vs_browser_status vs_rust_node_release(uint32_t slot, uint32_t generation) noexcept;
extern "C" vs_browser_status vs_rust_frame_dimensions(
    uint32_t slot,
    uint32_t generation,
    uint32_t *out_width,
    uint32_t *out_height) noexcept;
extern "C" vs_browser_status vs_rust_frame_rgba8_size(
    uint32_t slot,
    uint32_t generation,
    uint32_t *out_size) noexcept;
extern "C" vs_browser_status vs_rust_frame_copy_rgba8(
    uint32_t slot,
    uint32_t generation,
    uint8_t *rgba,
    uint32_t rgba_size) noexcept;
extern "C" vs_browser_status vs_rust_frame_release(uint32_t slot, uint32_t generation) noexcept;

namespace {

using bridge_test::ArgumentSet;
using bridge_test::expect_solid_rgba;
using bridge_test::expect_status;
using bridge_test::Token;

[[nodiscard]] bridge_test::InvokeOutcome rust_invoke(
    Token core,
    const char *namespace_name,
    const char *function_name,
    const std::vector<vs_browser_argument> &arguments,
    const char *result_key) {
    std::array<char, 512> error{};
    bridge_test::InvokeOutcome outcome;
    outcome.status = vs_rust_core_invoke(
        core.slot,
        core.generation,
        reinterpret_cast<const uint8_t *>(namespace_name),
        static_cast<uint32_t>(std::strlen(namespace_name)),
        reinterpret_cast<const uint8_t *>(function_name),
        static_cast<uint32_t>(std::strlen(function_name)),
        arguments.data(),
        static_cast<uint32_t>(arguments.size()),
        reinterpret_cast<const uint8_t *>(result_key),
        static_cast<uint32_t>(std::strlen(result_key)),
        0,
        error.data(),
        static_cast<uint32_t>(error.size()),
        &outcome.node.slot,
        &outcome.node.generation);
    outcome.error = error.data();
    return outcome;
}

[[nodiscard]] bool verify_rust_boundary_validation() {
    // Null output pointers must fail before any bridge call.
    uint32_t generation = UINT32_MAX;
    if (!expect_status(
            "Rust core creation with a null slot output",
            vs_rust_core_create(nullptr, &generation),
            VS_BROWSER_STATUS_INVALID_ARGUMENT) ||
        generation != UINT32_MAX) {
        std::fputs("null-output probe touched the output\n", stderr);
        return false;
    }

    std::array<char, 256> error{};
    uint32_t node_generation = UINT32_MAX;
    if (!expect_status(
            "Rust invoke with a null node output",
            vs_rust_core_invoke(
                1,
                1,
                reinterpret_cast<const uint8_t *>("std"),
                3,
                reinterpret_cast<const uint8_t *>("BlankClip"),
                9,
                nullptr,
                0,
                reinterpret_cast<const uint8_t *>("clip"),
                4,
                0,
                error.data(),
                static_cast<uint32_t>(error.size()),
                nullptr,
                &node_generation),
            VS_BROWSER_STATUS_INVALID_ARGUMENT) ||
        node_generation != UINT32_MAX) {
        std::fputs("null-invoke-output probe touched the output\n", stderr);
        return false;
    }

    uint32_t frame_generation = UINT32_MAX;
    if (!expect_status(
            "Rust frame request with a null frame output",
            vs_rust_node_get_frame(1, 1, 0, nullptr, &frame_generation),
            VS_BROWSER_STATUS_INVALID_ARGUMENT) ||
        frame_generation != UINT32_MAX ||
        !expect_status(
            "Rust frame dimensions with a null width output",
            vs_rust_frame_dimensions(1, 1, nullptr, &frame_generation),
            VS_BROWSER_STATUS_INVALID_ARGUMENT) ||
        !expect_status(
            "Rust frame size with a null size output",
            vs_rust_frame_rgba8_size(1, 1, nullptr),
            VS_BROWSER_STATUS_INVALID_ARGUMENT) ||
        !expect_status(
            "Rust RGBA8 copy with a null output",
            vs_rust_frame_copy_rgba8(1, 1, nullptr, 4),
            VS_BROWSER_STATUS_INVALID_ARGUMENT)) {
        std::fputs("Rust boundary did not reject null pointers\n", stderr);
        return false;
    }

    // Bad spans and descriptors must fail in the Rust layer with outputs zeroed.
    Token bad_node{UINT32_MAX, UINT32_MAX};
    if (!expect_status(
            "Rust invoke with a null namespace",
            vs_rust_core_invoke(
                1,
                1,
                nullptr,
                3,
                reinterpret_cast<const uint8_t *>("BlankClip"),
                9,
                nullptr,
                0,
                reinterpret_cast<const uint8_t *>("clip"),
                4,
                0,
                error.data(),
                static_cast<uint32_t>(error.size()),
                &bad_node.slot,
                &bad_node.generation),
            VS_BROWSER_STATUS_INVALID_ARGUMENT) ||
        bad_node.slot != 0 || bad_node.generation != 0) {
        std::fputs("null-namespace invoke retained an output token\n", stderr);
        return false;
    }

    int64_t value = 7;
    vs_browser_argument bad_kind{};
    bad_kind.key = reinterpret_cast<const uint8_t *>("width");
    bad_kind.key_length = 5;
    bad_kind.kind = 99;
    bad_kind.values = &value;
    bad_kind.value_count = 1;
    if (!expect_status(
            "Rust invoke with an unknown descriptor kind",
            vs_rust_core_invoke(
                1,
                1,
                reinterpret_cast<const uint8_t *>("std"),
                3,
                reinterpret_cast<const uint8_t *>("BlankClip"),
                9,
                &bad_kind,
                1,
                reinterpret_cast<const uint8_t *>("clip"),
                4,
                0,
                error.data(),
                static_cast<uint32_t>(error.size()),
                &bad_node.slot,
                &bad_node.generation),
            VS_BROWSER_STATUS_INVALID_ARGUMENT) ||
        bad_node.slot != 0 || bad_node.generation != 0) {
        std::fputs("bad-kind invoke retained an output token\n", stderr);
        return false;
    }

    vs_browser_argument null_values{};
    null_values.key = reinterpret_cast<const uint8_t *>("width");
    null_values.key_length = 5;
    null_values.kind = VS_BROWSER_ARGUMENT_INT;
    null_values.values = nullptr;
    null_values.value_count = 1;
    if (!expect_status(
            "Rust invoke with null descriptor values",
            vs_rust_core_invoke(
                1,
                1,
                reinterpret_cast<const uint8_t *>("std"),
                3,
                reinterpret_cast<const uint8_t *>("BlankClip"),
                9,
                &null_values,
                1,
                reinterpret_cast<const uint8_t *>("clip"),
                4,
                0,
                error.data(),
                static_cast<uint32_t>(error.size()),
                &bad_node.slot,
                &bad_node.generation),
            VS_BROWSER_STATUS_INVALID_ARGUMENT) ||
        bad_node.slot != 0 || bad_node.generation != 0) {
        std::fputs("null-values invoke retained an output token\n", stderr);
        return false;
    }

    return true;
}

[[nodiscard]] bool render_through_rust_boundary() {
    constexpr uint32_t width = 37;
    constexpr uint32_t height = 19;
    constexpr uint32_t rgba_size = width * height * 4;

    Token core;
    if (!expect_status(
            "Rust core creation",
            vs_rust_core_create(&core.slot, &core.generation),
            VS_BROWSER_STATUS_OK) ||
        core.slot == 0 || core.generation == 0) {
        return false;
    }

    ArgumentSet blank_arguments;
    blank_arguments.add_int("width", width);
    blank_arguments.add_int("height", height);
    blank_arguments.add_int("format", pfRGB24);
    blank_arguments.add_int("length", 1);
    blank_arguments.add_float_array("color", {10.0, 20.0, 30.0});
    const bridge_test::InvokeOutcome blank = rust_invoke(core, "std", "BlankClip", blank_arguments.build(), "clip");
    if (!expect_status("Rust BlankClip invoke", blank.status, VS_BROWSER_STATUS_OK) ||
        blank.node.slot == 0 || blank.node.generation == 0) {
        return false;
    }

    const bridge_test::InvokeOutcome unknown =
        rust_invoke(core, "std", "NoSuchFunction", std::vector<vs_browser_argument>{}, "clip");
    if (!expect_status(
            "Rust invoke with an unknown function",
            unknown.status,
            VS_BROWSER_STATUS_UNKNOWN_FUNCTION) ||
        unknown.node.slot != 0 || unknown.node.generation != 0) {
        std::fputs("unknown-function invoke retained an output token\n", stderr);
        return false;
    }

    ArgumentSet invert_arguments;
    invert_arguments.add_node("clip", blank.node);
    const bridge_test::InvokeOutcome inverted =
        rust_invoke(core, "std", "Invert", invert_arguments.build(), "clip");
    if (!expect_status("Rust Invert invoke", inverted.status, VS_BROWSER_STATUS_OK) ||
        inverted.node.slot == 0 || inverted.node.generation == 0) {
        return false;
    }

    Token frame;
    if (!expect_status(
            "Rust frame request",
            vs_rust_node_get_frame(
                inverted.node.slot,
                inverted.node.generation,
                0,
                &frame.slot,
                &frame.generation),
            VS_BROWSER_STATUS_OK) ||
        frame.slot == 0 || frame.generation == 0) {
        return false;
    }

    uint32_t frame_width = 0;
    uint32_t frame_height = 0;
    uint32_t frame_size = 0;
    if (!expect_status(
            "Rust frame dimensions",
            vs_rust_frame_dimensions(frame.slot, frame.generation, &frame_width, &frame_height),
            VS_BROWSER_STATUS_OK) ||
        frame_width != width || frame_height != height ||
        !expect_status(
            "Rust frame RGBA8 size",
            vs_rust_frame_rgba8_size(frame.slot, frame.generation, &frame_size),
            VS_BROWSER_STATUS_OK) ||
        frame_size != rgba_size) {
        return false;
    }

    std::array<uint8_t, rgba_size> rgba{};
    if (!expect_status(
            "Rust RGBA8 copy",
            vs_rust_frame_copy_rgba8(
                frame.slot,
                frame.generation,
                rgba.data(),
                static_cast<uint32_t>(rgba.size())),
            VS_BROWSER_STATUS_OK) ||
        !expect_solid_rgba(rgba.data(), static_cast<size_t>(width) * height, 245, 235, 225)) {
        return false;
    }

    if (!expect_status(
            "Rust BlankClip node release",
            vs_rust_node_release(blank.node.slot, blank.node.generation),
            VS_BROWSER_STATUS_OK) ||
        !expect_status(
            "Rust Invert node release",
            vs_rust_node_release(inverted.node.slot, inverted.node.generation),
            VS_BROWSER_STATUS_OK) ||
        !expect_status(
            "Rust frame release",
            vs_rust_frame_release(frame.slot, frame.generation),
            VS_BROWSER_STATUS_OK) ||
        !expect_status(
            "Rust core release",
            vs_rust_core_release(core.slot, core.generation),
            VS_BROWSER_STATUS_OK) ||
        !expect_status(
            "Rust double core release",
            vs_rust_core_release(core.slot, core.generation),
            VS_BROWSER_STATUS_INVALID_HANDLE)) {
        return false;
    }

    return true;
}

} // namespace

int main() {
    if (!verify_rust_boundary_validation() || !render_through_rust_boundary()) {
        return 1;
    }

    std::puts("Rust generic-invoke ownership through VapourSynth RGBA proof passed");
    return 0;
}
