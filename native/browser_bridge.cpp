#include "browser_bridge.h"

#include <VapourSynth4.h>
#include <VSHelper4.h>

#include <array>
#include <climits>
#include <cstddef>
#include <cstdint>
#include <limits>
#include <span>

namespace {

constexpr size_t maximum_rgba_bytes = 16U * 1024U * 1024U;

class Core final {
public:
    Core(const VSAPI *api, int flags) noexcept : api_(api), value_(api->createCore(flags)) {}

    ~Core() {
        if (value_ != nullptr) {
            api_->freeCore(value_);
        }
    }

    Core(const Core &) = delete;
    Core &operator=(const Core &) = delete;
    Core(Core &&) = delete;
    Core &operator=(Core &&) = delete;

    [[nodiscard]] VSCore *get() const noexcept { return value_; }

private:
    const VSAPI *api_;
    VSCore *value_;
};

class Map final {
public:
    explicit Map(const VSAPI *api) noexcept : api_(api), value_(api->createMap()) {}
    Map(const VSAPI *api, VSMap *value) noexcept : api_(api), value_(value) {}

    ~Map() {
        if (value_ != nullptr) {
            api_->freeMap(value_);
        }
    }

    Map(const Map &) = delete;
    Map &operator=(const Map &) = delete;
    Map(Map &&) = delete;
    Map &operator=(Map &&) = delete;

    [[nodiscard]] VSMap *get() const noexcept { return value_; }

private:
    const VSAPI *api_;
    VSMap *value_;
};

class Node final {
public:
    Node(const VSAPI *api, VSNode *value) noexcept : api_(api), value_(value) {}

    ~Node() {
        if (value_ != nullptr) {
            api_->freeNode(value_);
        }
    }

    Node(const Node &) = delete;
    Node &operator=(const Node &) = delete;
    Node(Node &&) = delete;
    Node &operator=(Node &&) = delete;

    [[nodiscard]] VSNode *get() const noexcept { return value_; }

    [[nodiscard]] VSNode *release() noexcept {
        VSNode *result = value_;
        value_ = nullptr;
        return result;
    }

private:
    const VSAPI *api_;
    VSNode *value_;
};

class Frame final {
public:
    Frame(const VSAPI *api, const VSFrame *value) noexcept : api_(api), value_(value) {}

    ~Frame() {
        if (value_ != nullptr) {
            api_->freeFrame(value_);
        }
    }

    Frame(const Frame &) = delete;
    Frame &operator=(const Frame &) = delete;
    Frame(Frame &&) = delete;
    Frame &operator=(Frame &&) = delete;

    [[nodiscard]] const VSFrame *get() const noexcept { return value_; }

private:
    const VSAPI *api_;
    const VSFrame *value_;
};

[[nodiscard]] bool rgba_byte_count(uint32_t width, uint32_t height, size_t &result) noexcept {
    if (width == 0 || height == 0) {
        return false;
    }

    constexpr size_t channels = 4;
    const size_t width_size = width;
    const size_t height_size = height;
    if (width_size > std::numeric_limits<size_t>::max() / height_size) {
        return false;
    }

    const size_t pixels = width_size * height_size;
    if (pixels > std::numeric_limits<size_t>::max() / channels) {
        return false;
    }

    result = pixels * channels;
    return true;
}

[[nodiscard]] bool map_set_int(const VSAPI *api, VSMap *map, const char *key, int64_t value) noexcept {
    return api->mapSetInt(map, key, value, maReplace) == 0;
}

[[nodiscard]] bool has_map_error(const VSAPI *api, const VSMap *map) noexcept {
    return api->mapGetError(map) != nullptr;
}

[[nodiscard]] vs_browser_status copy_rgb24_to_rgba(
    const VSAPI *api,
    const VSFrame *frame,
    uint32_t width,
    uint32_t height,
    std::span<uint8_t> output) noexcept {
    const VSVideoFormat *format = api->getVideoFrameFormat(frame);
    if (format == nullptr || format->colorFamily != cfRGB || format->sampleType != stInteger ||
        format->bitsPerSample != 8 || format->bytesPerSample != 1 || format->numPlanes != 3) {
        return VS_BROWSER_STATUS_UNEXPECTED_FRAME;
    }

    const int expected_width = static_cast<int>(width);
    const int expected_height = static_cast<int>(height);
    std::array<const uint8_t *, 3> planes{};
    std::array<ptrdiff_t, 3> strides{};
    for (int plane = 0; plane < 3; ++plane) {
        if (api->getFrameWidth(frame, plane) != expected_width ||
            api->getFrameHeight(frame, plane) != expected_height) {
            return VS_BROWSER_STATUS_UNEXPECTED_FRAME;
        }

        planes[plane] = api->getReadPtr(frame, plane);
        strides[plane] = api->getStride(frame, plane);
        if (planes[plane] == nullptr || strides[plane] < expected_width) {
            return VS_BROWSER_STATUS_UNEXPECTED_FRAME;
        }
    }

    const size_t row_width = width;
    for (uint32_t row = 0; row < height; ++row) {
        const size_t output_row = static_cast<size_t>(row) * row_width * 4;
        const auto *red = planes[0] + static_cast<ptrdiff_t>(row) * strides[0];
        const auto *green = planes[1] + static_cast<ptrdiff_t>(row) * strides[1];
        const auto *blue = planes[2] + static_cast<ptrdiff_t>(row) * strides[2];

        for (size_t column = 0; column < row_width; ++column) {
            const size_t destination = output_row + column * 4;
            output[destination] = red[column];
            output[destination + 1] = green[column];
            output[destination + 2] = blue[column];
            output[destination + 3] = UINT8_MAX;
        }
    }

    return VS_BROWSER_STATUS_OK;
}

[[nodiscard]] vs_browser_status render_inverted_blank(
    uint32_t width,
    uint32_t height,
    std::span<uint8_t> output) noexcept {
    if (width > static_cast<uint32_t>(INT_MAX) || height > static_cast<uint32_t>(INT_MAX)) {
        return VS_BROWSER_STATUS_INVALID_ARGUMENT;
    }

    const VSAPI *api = getVapourSynthAPI(VAPOURSYNTH_API_VERSION);
    if (api == nullptr) {
        return VS_BROWSER_STATUS_API_UNAVAILABLE;
    }

    Core core(api, ccfDisableAutoLoading | ccfDisableLibraryUnloading);
    if (core.get() == nullptr) {
        return VS_BROWSER_STATUS_CORE_UNAVAILABLE;
    }
    if (api->setThreadCount(1, core.get()) != 1) {
        return VS_BROWSER_STATUS_CORE_UNAVAILABLE;
    }

    VSPlugin *standard = api->getPluginByID(VSH_STD_PLUGIN_ID, core.get());
    if (standard == nullptr) {
        return VS_BROWSER_STATUS_STANDARD_PLUGIN_UNAVAILABLE;
    }

    Map blank_arguments(api);
    if (blank_arguments.get() == nullptr ||
        !map_set_int(api, blank_arguments.get(), "width", width) ||
        !map_set_int(api, blank_arguments.get(), "height", height) ||
        !map_set_int(api, blank_arguments.get(), "format", pfRGB24) ||
        !map_set_int(api, blank_arguments.get(), "length", 1)) {
        return VS_BROWSER_STATUS_MAP_WRITE_FAILED;
    }

    Map blank_result(api, api->invoke(standard, "BlankClip", blank_arguments.get()));
    if (blank_result.get() == nullptr || has_map_error(api, blank_result.get())) {
        return VS_BROWSER_STATUS_INVOCATION_FAILED;
    }

    int node_error = 0;
    Node blank_node(api, api->mapGetNode(blank_result.get(), "clip", 0, &node_error));
    if (node_error != 0 || blank_node.get() == nullptr) {
        return VS_BROWSER_STATUS_NODE_UNAVAILABLE;
    }

    Map invert_arguments(api);
    if (invert_arguments.get() == nullptr) {
        return VS_BROWSER_STATUS_MAP_WRITE_FAILED;
    }
    if (api->mapConsumeNode(invert_arguments.get(), "clip", blank_node.release(), maReplace) != 0) {
        return VS_BROWSER_STATUS_MAP_WRITE_FAILED;
    }

    Map invert_result(api, api->invoke(standard, "Invert", invert_arguments.get()));
    if (invert_result.get() == nullptr || has_map_error(api, invert_result.get())) {
        return VS_BROWSER_STATUS_INVOCATION_FAILED;
    }

    Node inverted_node(api, api->mapGetNode(invert_result.get(), "clip", 0, &node_error));
    if (node_error != 0 || inverted_node.get() == nullptr) {
        return VS_BROWSER_STATUS_NODE_UNAVAILABLE;
    }

    std::array<char, 1024> frame_error{};
    Frame frame(api, api->getFrame(0, inverted_node.get(), frame_error.data(), static_cast<int>(frame_error.size())));
    if (frame.get() == nullptr) {
        return VS_BROWSER_STATUS_FRAME_UNAVAILABLE;
    }

    return copy_rgb24_to_rgba(api, frame.get(), width, height, output);
}

} // namespace

extern "C" vs_browser_status vs_browser_render_inverted_blank(
    uint32_t width,
    uint32_t height,
    uint8_t *rgba,
    uint32_t rgba_size) noexcept {
    size_t required_size = 0;
    if (rgba == nullptr || !rgba_byte_count(width, height, required_size)) {
        return VS_BROWSER_STATUS_INVALID_ARGUMENT;
    }
    if (required_size > maximum_rgba_bytes) {
        return VS_BROWSER_STATUS_INVALID_ARGUMENT;
    }
    if (static_cast<size_t>(rgba_size) < required_size) {
        return VS_BROWSER_STATUS_OUTPUT_TOO_SMALL;
    }

    try {
        return render_inverted_blank(width, height, std::span<uint8_t>(rgba, required_size));
    } catch (...) {
        return VS_BROWSER_STATUS_INTERNAL_FAILURE;
    }
}

extern "C" const char *vs_browser_status_message(vs_browser_status status) noexcept {
    switch (status) {
    case VS_BROWSER_STATUS_OK:
        return "ok";
    case VS_BROWSER_STATUS_INVALID_ARGUMENT:
        return "invalid argument";
    case VS_BROWSER_STATUS_OUTPUT_TOO_SMALL:
        return "output buffer is too small";
    case VS_BROWSER_STATUS_API_UNAVAILABLE:
        return "VapourSynth API is unavailable";
    case VS_BROWSER_STATUS_CORE_UNAVAILABLE:
        return "VapourSynth core is unavailable";
    case VS_BROWSER_STATUS_STANDARD_PLUGIN_UNAVAILABLE:
        return "standard plugin is unavailable";
    case VS_BROWSER_STATUS_MAP_WRITE_FAILED:
        return "failed to populate a VapourSynth map";
    case VS_BROWSER_STATUS_INVOCATION_FAILED:
        return "VapourSynth plugin invocation failed";
    case VS_BROWSER_STATUS_NODE_UNAVAILABLE:
        return "VapourSynth node is unavailable";
    case VS_BROWSER_STATUS_FRAME_UNAVAILABLE:
        return "VapourSynth frame is unavailable";
    case VS_BROWSER_STATUS_UNEXPECTED_FRAME:
        return "VapourSynth returned an unexpected frame format";
    case VS_BROWSER_STATUS_INTERNAL_FAILURE:
        return "internal bridge failure";
    }

    return "unknown bridge status";
}
