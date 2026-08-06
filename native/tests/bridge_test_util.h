// Shared helpers for the native opaque-handle tests: descriptor builders,
// generic invoke plumbing, and pixel/status assertions.

#ifndef VAPOURSYNTH_BRIDGE_TEST_UTIL_H
#define VAPOURSYNTH_BRIDGE_TEST_UTIL_H

#include "browser_bridge.h"

#include <array>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

namespace bridge_test {

struct Token final {
    uint32_t slot = 0;
    uint32_t generation = 0;
};

[[nodiscard]] inline bool expect_status(
    const char *operation,
    vs_browser_status actual,
    vs_browser_status expected) {
    if (actual == expected) {
        return true;
    }

    std::fprintf(stderr, "%s returned %d; expected %d\n", operation, actual, expected);
    return false;
}

[[nodiscard]] inline bool expect_solid_rgba(
    const uint8_t *rgba,
    size_t pixel_count,
    uint8_t red,
    uint8_t green,
    uint8_t blue) {
    for (size_t pixel = 0; pixel < pixel_count; ++pixel) {
        const size_t offset = pixel * 4;
        if (rgba[offset] != red || rgba[offset + 1] != green || rgba[offset + 2] != blue ||
            rgba[offset + 3] != UINT8_MAX) {
            std::fputs("VapourSynth produced an unexpected RGBA pixel\n", stderr);
            return false;
        }
    }
    return true;
}

/// Accumulates typed argument values and materializes wire descriptors.
///
/// Every value is copied into the set so descriptors stay valid until the
/// synchronous invoke returns; `build()` must be called after all additions.
class ArgumentSet final {
public:
    void add_int(const char *key, int64_t value) {
        Entry entry;
        entry.key = key;
        entry.kind = VS_BROWSER_ARGUMENT_INT;
        entry.ints.push_back(value);
        entries_.push_back(std::move(entry));
    }

    void add_int_array(const char *key, std::initializer_list<int64_t> values) {
        Entry entry;
        entry.key = key;
        entry.kind = VS_BROWSER_ARGUMENT_INT;
        entry.ints.assign(values);
        entries_.push_back(std::move(entry));
    }

    void add_float(const char *key, double value) {
        Entry entry;
        entry.key = key;
        entry.kind = VS_BROWSER_ARGUMENT_FLOAT;
        entry.floats.push_back(value);
        entries_.push_back(std::move(entry));
    }

    void add_float_array(const char *key, std::initializer_list<double> values) {
        Entry entry;
        entry.key = key;
        entry.kind = VS_BROWSER_ARGUMENT_FLOAT;
        entry.floats.assign(values);
        entries_.push_back(std::move(entry));
    }

    void add_data(const char *key, std::initializer_list<uint8_t> values) {
        Entry entry;
        entry.key = key;
        entry.kind = VS_BROWSER_ARGUMENT_DATA;
        entry.data.assign(values);
        entries_.push_back(std::move(entry));
    }

    void add_node(const char *key, Token token) {
        Entry entry;
        entry.key = key;
        entry.kind = VS_BROWSER_ARGUMENT_NODE;
        entry.nodes.push_back(token.slot);
        entry.nodes.push_back(token.generation);
        entries_.push_back(std::move(entry));
    }

    [[nodiscard]] std::vector<vs_browser_argument> build() const {
        std::vector<vs_browser_argument> descriptors;
        descriptors.reserve(entries_.size());
        for (const Entry &entry : entries_) {
            const void *values = nullptr;
            uint32_t value_count = 0;
            if (!entry.ints.empty()) {
                values = entry.ints.data();
                value_count = static_cast<uint32_t>(entry.ints.size());
            } else if (!entry.floats.empty()) {
                values = entry.floats.data();
                value_count = static_cast<uint32_t>(entry.floats.size());
            } else if (!entry.data.empty()) {
                values = entry.data.data();
                value_count = static_cast<uint32_t>(entry.data.size());
            } else if (!entry.nodes.empty()) {
                values = entry.nodes.data();
                value_count = static_cast<uint32_t>(entry.nodes.size() / 2);
            }

            vs_browser_argument descriptor{};
            descriptor.key = reinterpret_cast<const uint8_t *>(entry.key.c_str());
            descriptor.key_length = static_cast<uint32_t>(entry.key.size());
            descriptor.kind = entry.kind;
            descriptor.values = values;
            descriptor.value_count = value_count;
            descriptors.push_back(descriptor);
        }
        return descriptors;
    }

private:
    struct Entry final {
        std::string key;
        uint32_t kind = 0;
        std::vector<int64_t> ints;
        std::vector<double> floats;
        std::vector<uint8_t> data;
        std::vector<uint32_t> nodes;
    };

    std::vector<Entry> entries_;
};

struct InvokeOutcome final {
    vs_browser_status status = VS_BROWSER_STATUS_INVALID_ARGUMENT;
    Token node;
    std::string error;
};

[[nodiscard]] inline InvokeOutcome invoke(
    Token core,
    const char *namespace_name,
    const char *function_name,
    const std::vector<vs_browser_argument> &arguments,
    const char *result_key,
    uint32_t result_index = 0) {
    std::array<char, 512> error{};
    InvokeOutcome outcome;
    outcome.status = vs_browser_core_invoke(
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
        result_index,
        error.data(),
        static_cast<uint32_t>(error.size()),
        &outcome.node.slot,
        &outcome.node.generation);
    outcome.error = error.data();
    return outcome;
}

/// Returns the generation of `replacement.slot` from an earlier released
/// token, proving the handle table reused the slot.
[[nodiscard]] inline bool find_stale_generation(
    const std::array<Token, 4> &released,
    Token replacement,
    uint32_t &result) {
    result = 0;
    for (const Token token : released) {
        if (token.slot == replacement.slot) {
            result = token.generation;
            return true;
        }
    }
    return false;
}

} // namespace bridge_test

#endif
