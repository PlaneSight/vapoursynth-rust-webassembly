#include "bridge_test_util.h"

#include <VapourSynth4.h>

#include <array>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstring>

namespace {

using bridge_test::ArgumentSet;
using bridge_test::expect_solid_rgba;
using bridge_test::expect_status;
using bridge_test::find_stale_generation;
using bridge_test::invoke;
using bridge_test::Token;

/// Builds a one-frame RGB24 BlankClip argument set; the width arrives as an
/// int array to exercise the array write path.
[[nodiscard]] ArgumentSet blank_clip_arguments(uint32_t width, uint32_t height) {
    ArgumentSet arguments;
    arguments.add_int_array("width", {static_cast<int64_t>(width)});
    arguments.add_int("height", height);
    arguments.add_int("format", pfRGB24);
    arguments.add_int("length", 1);
    arguments.add_float_array("color", {10.0, 20.0, 30.0});
    return arguments;
}

[[nodiscard]] bool verify_span_and_descriptor_validation(const Token &core) {
    const char *namespace_name = "std";
    const char *function_name = "BlankClip";
    const char *result_key = "clip";
    std::array<char, 256> error{};
    const uint32_t error_size = static_cast<uint32_t>(error.size());

    const auto raw_invoke = [&](const uint8_t *ns,
                                uint32_t ns_length,
                                const uint8_t *function,
                                uint32_t function_length,
                                const vs_browser_argument *arguments,
                                uint32_t argument_count,
                                const uint8_t *key,
                                uint32_t key_length,
                                uint32_t result_index,
                                char *buffer,
                                uint32_t buffer_size,
                                Token &out) {
        out = Token{UINT32_MAX, UINT32_MAX};
        return vs_browser_core_invoke(
            core.slot,
            core.generation,
            ns,
            ns_length,
            function,
            function_length,
            arguments,
            argument_count,
            key,
            key_length,
            result_index,
            buffer,
            buffer_size,
            &out.slot,
            &out.generation);
    };

    // A core token must precede any generic invocation.
    Token zero_core{UINT32_MAX, UINT32_MAX};
    if (!expect_status(
            "invoke with a zero core token",
            vs_browser_core_invoke(
                0,
                0,
                reinterpret_cast<const uint8_t *>(namespace_name),
                static_cast<uint32_t>(std::strlen(namespace_name)),
                reinterpret_cast<const uint8_t *>(function_name),
                static_cast<uint32_t>(std::strlen(function_name)),
                nullptr,
                0,
                reinterpret_cast<const uint8_t *>(result_key),
                static_cast<uint32_t>(std::strlen(result_key)),
                0,
                error.data(),
                error_size,
                &zero_core.slot,
                &zero_core.generation),
            VS_BROWSER_STATUS_INVALID_HANDLE) ||
        zero_core.slot != 0 || zero_core.generation != 0) {
        std::fputs("failed invoke retained an output token\n", stderr);
        return false;
    }

    // Every malformed span must fail with INVALID_ARGUMENT and zero outputs.
    Token bad{UINT32_MAX, UINT32_MAX};
    const auto expect_bad_span = [&](const uint8_t *ns,
                                     uint32_t ns_length,
                                     const uint8_t *function,
                                     uint32_t function_length,
                                     const uint8_t *key,
                                     uint32_t key_length,
                                     const char *operation) {
        if (!expect_status(
                operation,
                raw_invoke(
                    ns,
                    ns_length,
                    function,
                    function_length,
                    nullptr,
                    0,
                    key,
                    key_length,
                    0,
                    error.data(),
                    error_size,
                    bad),
                VS_BROWSER_STATUS_INVALID_ARGUMENT) ||
            bad.slot != 0 || bad.generation != 0) {
            std::fputs("bad-span invoke retained an output token\n", stderr);
            return false;
        }
        return true;
    };

    if (!expect_bad_span(
            nullptr,
            3,
            reinterpret_cast<const uint8_t *>(function_name),
            static_cast<uint32_t>(std::strlen(function_name)),
            reinterpret_cast<const uint8_t *>(result_key),
            static_cast<uint32_t>(std::strlen(result_key)),
            "invoke with a null namespace") ||
        !expect_bad_span(
            reinterpret_cast<const uint8_t *>(namespace_name),
            static_cast<uint32_t>(std::strlen(namespace_name)),
            nullptr,
            4,
            reinterpret_cast<const uint8_t *>(result_key),
            static_cast<uint32_t>(std::strlen(result_key)),
            "invoke with a null function") ||
        !expect_bad_span(
            reinterpret_cast<const uint8_t *>(namespace_name),
            static_cast<uint32_t>(std::strlen(namespace_name)),
            reinterpret_cast<const uint8_t *>(function_name),
            0,
            reinterpret_cast<const uint8_t *>(result_key),
            static_cast<uint32_t>(std::strlen(result_key)),
            "invoke with an empty function") ||
        !expect_bad_span(
            reinterpret_cast<const uint8_t *>(namespace_name),
            static_cast<uint32_t>(std::strlen(namespace_name)),
            reinterpret_cast<const uint8_t *>(function_name),
            static_cast<uint32_t>(std::strlen(function_name)),
            nullptr,
            5,
            "invoke with a null result key") ||
        !expect_bad_span(
            reinterpret_cast<const uint8_t *>(namespace_name),
            static_cast<uint32_t>(std::strlen(namespace_name)),
            reinterpret_cast<const uint8_t *>(function_name),
            static_cast<uint32_t>(std::strlen(function_name)),
            reinterpret_cast<const uint8_t *>(result_key),
            0,
            "invoke with an empty result key")) {
        return false;
    }

    // A null error buffer with a non-zero size is a malformed span.
    Token null_error{UINT32_MAX, UINT32_MAX};
    if (!expect_status(
            "invoke with a null error buffer",
            vs_browser_core_invoke(
                core.slot,
                core.generation,
                reinterpret_cast<const uint8_t *>(namespace_name),
                static_cast<uint32_t>(std::strlen(namespace_name)),
                reinterpret_cast<const uint8_t *>(function_name),
                static_cast<uint32_t>(std::strlen(function_name)),
                nullptr,
                0,
                reinterpret_cast<const uint8_t *>(result_key),
                static_cast<uint32_t>(std::strlen(result_key)),
                0,
                nullptr,
                256,
                &null_error.slot,
                &null_error.generation),
            VS_BROWSER_STATUS_INVALID_ARGUMENT) ||
        null_error.slot != 0 || null_error.generation != 0) {
        std::fputs("null error buffer invoke retained an output token\n", stderr);
        return false;
    }

    // Malformed descriptors must fail before any upstream lookup.
    int64_t value = 7;

    vs_browser_argument bad_kind{};
    bad_kind.key = reinterpret_cast<const uint8_t *>("width");
    bad_kind.key_length = 5;
    bad_kind.kind = 99;
    bad_kind.values = &value;
    bad_kind.value_count = 1;
    Token bad_kind_node{UINT32_MAX, UINT32_MAX};
    if (!expect_status(
            "invoke with an unknown descriptor kind",
            raw_invoke(
                reinterpret_cast<const uint8_t *>(namespace_name),
                static_cast<uint32_t>(std::strlen(namespace_name)),
                reinterpret_cast<const uint8_t *>(function_name),
                static_cast<uint32_t>(std::strlen(function_name)),
                &bad_kind,
                1,
                reinterpret_cast<const uint8_t *>(result_key),
                static_cast<uint32_t>(std::strlen(result_key)),
                0,
                error.data(),
                error_size,
                bad_kind_node),
            VS_BROWSER_STATUS_INVALID_ARGUMENT) ||
        bad_kind_node.slot != 0 || bad_kind_node.generation != 0) {
        std::fputs("bad-kind invoke retained an output token\n", stderr);
        return false;
    }

    vs_browser_argument null_values{};
    null_values.key = reinterpret_cast<const uint8_t *>("width");
    null_values.key_length = 5;
    null_values.kind = VS_BROWSER_ARGUMENT_INT;
    null_values.values = nullptr;
    null_values.value_count = 1;
    Token null_values_node{UINT32_MAX, UINT32_MAX};
    if (!expect_status(
            "invoke with null descriptor values",
            raw_invoke(
                reinterpret_cast<const uint8_t *>(namespace_name),
                static_cast<uint32_t>(std::strlen(namespace_name)),
                reinterpret_cast<const uint8_t *>(function_name),
                static_cast<uint32_t>(std::strlen(function_name)),
                &null_values,
                1,
                reinterpret_cast<const uint8_t *>(result_key),
                static_cast<uint32_t>(std::strlen(result_key)),
                0,
                error.data(),
                error_size,
                null_values_node),
            VS_BROWSER_STATUS_INVALID_ARGUMENT) ||
        null_values_node.slot != 0 || null_values_node.generation != 0) {
        std::fputs("null-values invoke retained an output token\n", stderr);
        return false;
    }

    vs_browser_argument zero_count{};
    zero_count.key = reinterpret_cast<const uint8_t *>("width");
    zero_count.key_length = 5;
    zero_count.kind = VS_BROWSER_ARGUMENT_INT;
    zero_count.values = &value;
    zero_count.value_count = 0;
    Token zero_count_node{UINT32_MAX, UINT32_MAX};
    if (!expect_status(
            "invoke with a zero value count",
            raw_invoke(
                reinterpret_cast<const uint8_t *>(namespace_name),
                static_cast<uint32_t>(std::strlen(namespace_name)),
                reinterpret_cast<const uint8_t *>(function_name),
                static_cast<uint32_t>(std::strlen(function_name)),
                &zero_count,
                1,
                reinterpret_cast<const uint8_t *>(result_key),
                static_cast<uint32_t>(std::strlen(result_key)),
                0,
                error.data(),
                error_size,
                zero_count_node),
            VS_BROWSER_STATUS_INVALID_ARGUMENT) ||
        zero_count_node.slot != 0 || zero_count_node.generation != 0) {
        std::fputs("zero-count invoke retained an output token\n", stderr);
        return false;
    }

    vs_browser_argument null_key{};
    null_key.key = nullptr;
    null_key.key_length = 5;
    null_key.kind = VS_BROWSER_ARGUMENT_INT;
    null_key.values = &value;
    null_key.value_count = 1;
    Token null_key_node{UINT32_MAX, UINT32_MAX};
    if (!expect_status(
            "invoke with a null descriptor key",
            raw_invoke(
                reinterpret_cast<const uint8_t *>(namespace_name),
                static_cast<uint32_t>(std::strlen(namespace_name)),
                reinterpret_cast<const uint8_t *>(function_name),
                static_cast<uint32_t>(std::strlen(function_name)),
                &null_key,
                1,
                reinterpret_cast<const uint8_t *>(result_key),
                static_cast<uint32_t>(std::strlen(result_key)),
                0,
                error.data(),
                error_size,
                null_key_node),
            VS_BROWSER_STATUS_INVALID_ARGUMENT) ||
        null_key_node.slot != 0 || null_key_node.generation != 0) {
        std::fputs("null-key invoke retained an output token\n", stderr);
        return false;
    }

    std::array<vs_browser_argument, 2> duplicate_keys{};
    duplicate_keys[0] = bad_kind;
    duplicate_keys[0].kind = VS_BROWSER_ARGUMENT_INT;
    duplicate_keys[1] = duplicate_keys[0];
    Token duplicate_node{UINT32_MAX, UINT32_MAX};
    if (!expect_status(
            "invoke with duplicate descriptor keys",
            raw_invoke(
                reinterpret_cast<const uint8_t *>(namespace_name),
                static_cast<uint32_t>(std::strlen(namespace_name)),
                reinterpret_cast<const uint8_t *>(function_name),
                static_cast<uint32_t>(std::strlen(function_name)),
                duplicate_keys.data(),
                2,
                reinterpret_cast<const uint8_t *>(result_key),
                static_cast<uint32_t>(std::strlen(result_key)),
                0,
                error.data(),
                error_size,
                duplicate_node),
            VS_BROWSER_STATUS_INVALID_ARGUMENT) ||
        duplicate_node.slot != 0 || duplicate_node.generation != 0) {
        std::fputs("duplicate-key invoke retained an output token\n", stderr);
        return false;
    }

    return true;
}

[[nodiscard]] bool verify_unknown_namespace_and_function(const Token &core) {
    const char *result_key = "clip";
    const std::vector<vs_browser_argument> no_arguments;

    const bridge_test::InvokeOutcome unknown_namespace = invoke(core, "nosuch", "BlankClip", no_arguments, result_key);
    if (!expect_status(
            "invoke with an unknown namespace",
            unknown_namespace.status,
            VS_BROWSER_STATUS_UNKNOWN_FUNCTION) ||
        unknown_namespace.node.slot != 0 || unknown_namespace.node.generation != 0) {
        std::fputs("unknown-namespace invoke retained an output token\n", stderr);
        return false;
    }

    const bridge_test::InvokeOutcome unknown_function = invoke(core, "std", "NoSuchFunction", no_arguments, result_key);
    if (!expect_status(
            "invoke with an unknown function",
            unknown_function.status,
            VS_BROWSER_STATUS_UNKNOWN_FUNCTION) ||
        unknown_function.node.slot != 0 || unknown_function.node.generation != 0) {
        std::fputs("unknown-function invoke retained an output token\n", stderr);
        return false;
    }

    return true;
}

[[nodiscard]] bool verify_blank_clip_with_color(const Token &core, Token &blank) {
    ArgumentSet arguments = blank_clip_arguments(37, 19);
    const std::vector<vs_browser_argument> descriptors = arguments.build();
    const bridge_test::InvokeOutcome outcome = invoke(core, "std", "BlankClip", descriptors, "clip");
    if (!expect_status("BlankClip invoke with color", outcome.status, VS_BROWSER_STATUS_OK) ||
        outcome.node.slot == 0 || outcome.node.generation == 0) {
        return false;
    }

    blank = outcome.node;
    return true;
}

[[nodiscard]] bool verify_missing_results(const Token &core, const std::vector<vs_browser_argument> &descriptors) {
    const bridge_test::InvokeOutcome missing_key = invoke(core, "std", "BlankClip", descriptors, "clp");
    if (!expect_status(
            "BlankClip invoke with an absent result key",
            missing_key.status,
            VS_BROWSER_STATUS_NODE_UNAVAILABLE) ||
        missing_key.node.slot != 0 || missing_key.node.generation != 0) {
        std::fputs("absent-result-key invoke retained an output token\n", stderr);
        return false;
    }

    const bridge_test::InvokeOutcome missing_index = invoke(core, "std", "BlankClip", descriptors, "clip", 1);
    if (!expect_status(
            "BlankClip invoke with an out-of-range result index",
            missing_index.status,
            VS_BROWSER_STATUS_NODE_UNAVAILABLE) ||
        missing_index.node.slot != 0 || missing_index.node.generation != 0) {
        std::fputs("out-of-range-index invoke retained an output token\n", stderr);
        return false;
    }

    return true;
}

[[nodiscard]] bool verify_bad_argument_types(const Token &core) {
    // An integer where Invert requires a video node fails upstream and the
    // plugin's error text must reach the caller buffer.
    ArgumentSet wrong_type_arguments;
    wrong_type_arguments.add_int("clip", 5);
    const bridge_test::InvokeOutcome wrong_type =
        invoke(core, "std", "Invert", wrong_type_arguments.build(), "clip");
    if (!expect_status(
            "Invert invoke with an integer clip",
            wrong_type.status,
            VS_BROWSER_STATUS_INVOCATION_FAILED) ||
        wrong_type.node.slot != 0 || wrong_type.node.generation != 0 ||
        wrong_type.error.find("clip is not of the correct type") == std::string::npos) {
        std::fputs("wrong-type invoke did not populate its error text\n", stderr);
        return false;
    }

    // A DATA descriptor reaches the argument map; BlankClip rejects the
    // unknown key and the error names it. A truncated caller buffer must stay
    // NUL-terminated.
    ArgumentSet data_arguments;
    data_arguments.add_int("width", 37);
    data_arguments.add_data("payload", {0x01, 0x02, 0x03});
    const bridge_test::InvokeOutcome data_outcome =
        invoke(core, "std", "BlankClip", data_arguments.build(), "clip");
    if (!expect_status(
            "BlankClip invoke with an unknown data argument",
            data_outcome.status,
            VS_BROWSER_STATUS_INVOCATION_FAILED) ||
        data_outcome.node.slot != 0 || data_outcome.node.generation != 0 ||
        data_outcome.error.find("payload") == std::string::npos) {
        std::fputs("data-argument invoke did not populate its error text\n", stderr);
        return false;
    }

    std::array<char, 8> small_error{};
    const std::vector<vs_browser_argument> descriptors = data_arguments.build();
    Token truncated{UINT32_MAX, UINT32_MAX};
    if (!expect_status(
            "BlankClip invoke with a truncated error buffer",
            vs_browser_core_invoke(
                core.slot,
                core.generation,
                reinterpret_cast<const uint8_t *>("std"),
                3,
                reinterpret_cast<const uint8_t *>("BlankClip"),
                9,
                descriptors.data(),
                static_cast<uint32_t>(descriptors.size()),
                reinterpret_cast<const uint8_t *>("clip"),
                4,
                0,
                small_error.data(),
                static_cast<uint32_t>(small_error.size()),
                &truncated.slot,
                &truncated.generation),
            VS_BROWSER_STATUS_INVOCATION_FAILED) ||
        truncated.slot != 0 || truncated.generation != 0 ||
        std::strcmp(small_error.data(), "BlankCl") != 0) {
        std::fputs("truncated error buffer was not NUL-terminated\n", stderr);
        return false;
    }

    return true;
}

[[nodiscard]] bool verify_invert_with_node(const Token &core, const Token &blank, Token &inverted) {
    ArgumentSet arguments;
    arguments.add_node("clip", blank);
    const bridge_test::InvokeOutcome outcome = invoke(core, "std", "Invert", arguments.build(), "clip");
    if (!expect_status("Invert invoke with a node", outcome.status, VS_BROWSER_STATUS_OK) ||
        outcome.node.slot == 0 || outcome.node.generation == 0) {
        return false;
    }

    inverted = outcome.node;
    return true;
}

[[nodiscard]] bool verify_node_handle_failures(const Token &core, const Token &inverted) {
    // A released node token must fail with INVALID_HANDLE and zero outputs.
    Token throwaway;
    {
        ArgumentSet arguments = blank_clip_arguments(5, 5);
        const bridge_test::InvokeOutcome outcome = invoke(core, "std", "BlankClip", arguments.build(), "clip");
        if (!expect_status("throwaway BlankClip invoke", outcome.status, VS_BROWSER_STATUS_OK)) {
            return false;
        }
        throwaway = outcome.node;
    }
    if (!expect_status(
            "throwaway node release",
            vs_browser_node_release(throwaway.slot, throwaway.generation),
            VS_BROWSER_STATUS_OK)) {
        return false;
    }

    ArgumentSet stale_arguments;
    stale_arguments.add_node("clip", throwaway);
    const bridge_test::InvokeOutcome stale = invoke(core, "std", "Invert", stale_arguments.build(), "clip");
    if (!expect_status(
            "Invert invoke with a stale node token",
            stale.status,
            VS_BROWSER_STATUS_INVALID_HANDLE) ||
        stale.node.slot != 0 || stale.node.generation != 0) {
        std::fputs("stale-node invoke retained an output token\n", stderr);
        return false;
    }

    // A core token passed as a node argument must fail with a kind mismatch.
    ArgumentSet wrong_kind_arguments;
    wrong_kind_arguments.add_node("clip", core);
    const bridge_test::InvokeOutcome wrong_kind =
        invoke(core, "std", "Invert", wrong_kind_arguments.build(), "clip");
    if (!expect_status(
            "Invert invoke with a core token as node",
            wrong_kind.status,
            VS_BROWSER_STATUS_HANDLE_KIND_MISMATCH) ||
        wrong_kind.node.slot != 0 || wrong_kind.node.generation != 0) {
        std::fputs("wrong-kind-node invoke retained an output token\n", stderr);
        return false;
    }

    // A frame query with a node token must also report a kind mismatch and
    // clear its outputs.
    uint32_t wrong_width = UINT32_MAX;
    uint32_t wrong_height = UINT32_MAX;
    if (!expect_status(
            "frame dimensions with a node token",
            vs_browser_frame_dimensions(
                inverted.slot,
                inverted.generation,
                &wrong_width,
                &wrong_height),
            VS_BROWSER_STATUS_HANDLE_KIND_MISMATCH) ||
        wrong_width != 0 || wrong_height != 0) {
        std::fputs("wrong-kind frame query did not clear its output\n", stderr);
        return false;
    }

    return true;
}

[[nodiscard]] bool verify_frame_lifecycle(
    const Token &core,
    const Token &blank,
    const Token &inverted,
    Token &frame) {
    constexpr uint32_t width = 37;
    constexpr uint32_t height = 19;
    constexpr uint32_t rgba_size = width * height * 4;

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

    uint32_t frame_width = 0;
    uint32_t frame_height = 0;
    uint32_t frame_size = 0;
    if (!expect_status(
            "frame dimensions",
            vs_browser_frame_dimensions(frame.slot, frame.generation, &frame_width, &frame_height),
            VS_BROWSER_STATUS_OK) ||
        frame_width != width || frame_height != height ||
        !expect_status(
            "frame RGBA8 size",
            vs_browser_frame_rgba8_size(frame.slot, frame.generation, &frame_size),
            VS_BROWSER_STATUS_OK) ||
        frame_size != rgba_size) {
        std::fputs("frame metadata mismatch\n", stderr);
        return false;
    }

    // The core and node leases may be released while the frame stays live.
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

    frame_width = 0;
    frame_height = 0;
    frame_size = 0;
    if (!expect_status(
            "frame dimensions after parent release",
            vs_browser_frame_dimensions(frame.slot, frame.generation, &frame_width, &frame_height),
            VS_BROWSER_STATUS_OK) ||
        frame_width != width || frame_height != height ||
        !expect_status(
            "frame RGBA8 size after parent release",
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

    // BlankClip color {10, 20, 30} inverted is {245, 235, 225}.
    std::array<uint8_t, rgba_size> rgba{};
    if (!expect_status(
            "RGBA8 copy after parent release",
            vs_browser_frame_copy_rgba8(frame.slot, frame.generation, rgba.data(), static_cast<uint32_t>(rgba.size())),
            VS_BROWSER_STATUS_OK) ||
        !expect_solid_rgba(rgba.data(), static_cast<size_t>(width) * height, 245, 235, 225)) {
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

    return true;
}

[[nodiscard]] bool verify_slot_reuse_with_stale_generation(
    const Token &core,
    const Token &blank,
    const Token &inverted,
    const Token &frame) {
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
            VS_BROWSER_STATUS_OK) ||
        !expect_status(
            "double replacement core release",
            vs_browser_core_release(replacement_core.slot, replacement_core.generation),
            VS_BROWSER_STATUS_INVALID_HANDLE)) {
        return false;
    }

    return true;
}

} // namespace

int main() {
    if (vs_browser_handle_abi_version() != VS_BROWSER_HANDLE_ABI_VERSION) {
        std::fputs("opaque handle ABI version mismatch\n", stderr);
        return 1;
    }

    if (!expect_status(
            "zero core token",
            vs_browser_core_release(0, 0),
            VS_BROWSER_STATUS_INVALID_HANDLE) ||
        !expect_status(
            "unknown node token",
            vs_browser_node_release(UINT32_MAX, 1),
            VS_BROWSER_STATUS_INVALID_HANDLE)) {
        return 1;
    }

    uint32_t null_generation = UINT32_MAX;
    if (!expect_status(
            "core creation with a null slot output",
            vs_browser_core_create(nullptr, &null_generation),
            VS_BROWSER_STATUS_INVALID_ARGUMENT) ||
        null_generation != 0) {
        std::fputs("failed token output was not cleared\n", stderr);
        return 1;
    }

    Token core;
    if (!expect_status(
            "core creation",
            vs_browser_core_create(&core.slot, &core.generation),
            VS_BROWSER_STATUS_OK)) {
        return 1;
    }

    if (!verify_span_and_descriptor_validation(core) || !verify_unknown_namespace_and_function(core)) {
        return 1;
    }

    Token blank;
    if (!verify_blank_clip_with_color(core, blank)) {
        return 1;
    }
    {
        ArgumentSet arguments = blank_clip_arguments(37, 19);
        if (!verify_missing_results(core, arguments.build())) {
            return 1;
        }
    }

    if (!verify_bad_argument_types(core)) {
        return 1;
    }

    Token inverted;
    if (!verify_invert_with_node(core, blank, inverted) ||
        !verify_node_handle_failures(core, inverted)) {
        return 1;
    }

    Token frame;
    if (!verify_frame_lifecycle(core, blank, inverted, frame)) {
        return 1;
    }

    // The frame token was released last, so the replacement core reuses its
    // slot; the stale-generation probe must then fail.
    if (!verify_slot_reuse_with_stale_generation(core, blank, inverted, frame)) {
        return 1;
    }

    std::puts("VapourSynth generic-invoke opaque-handle proof passed");
    return 0;
}
