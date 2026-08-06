#include "browser_bridge.h"

#include <VapourSynth4.h>
#include <VSHelper4.h>

#include <array>
#include <climits>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <limits>
#include <memory>
#include <optional>
#include <span>
#include <string>
#include <utility>
#include <variant>
#include <vector>

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

    [[nodiscard]] const VSAPI *api() const noexcept { return api_; }
    [[nodiscard]] VSCore *get() const noexcept { return value_; }

private:
    const VSAPI *api_;
    VSCore *value_;
};

class CoreState final {
public:
    CoreState(const VSAPI *api, int flags) noexcept : core_(api, flags) {}

    CoreState(const CoreState &) = delete;
    CoreState &operator=(const CoreState &) = delete;
    CoreState(CoreState &&) = delete;
    CoreState &operator=(CoreState &&) = delete;

    [[nodiscard]] const VSAPI *api() const noexcept { return core_.api(); }
    [[nodiscard]] VSCore *get() const noexcept { return core_.get(); }

private:
    Core core_;
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
    Node() noexcept = default;
    Node(const VSAPI *api, VSNode *value) noexcept : api_(api), value_(value) {}

    ~Node() { reset(); }

    Node(const Node &) = delete;
    Node &operator=(const Node &) = delete;

    Node(Node &&other) noexcept
        : api_(std::exchange(other.api_, nullptr)), value_(std::exchange(other.value_, nullptr)) {}

    Node &operator=(Node &&other) noexcept {
        if (this != &other) {
            reset();
            api_ = std::exchange(other.api_, nullptr);
            value_ = std::exchange(other.value_, nullptr);
        }
        return *this;
    }

    [[nodiscard]] VSNode *get() const noexcept { return value_; }

    [[nodiscard]] VSNode *release() noexcept {
        VSNode *result = value_;
        value_ = nullptr;
        return result;
    }

private:
    void reset() noexcept {
        if (value_ != nullptr) {
            api_->freeNode(value_);
            value_ = nullptr;
        }
    }

    const VSAPI *api_ = nullptr;
    VSNode *value_ = nullptr;
};

class Frame final {
public:
    Frame() noexcept = default;
    Frame(const VSAPI *api, const VSFrame *value) noexcept : api_(api), value_(value) {}

    ~Frame() { reset(); }

    Frame(const Frame &) = delete;
    Frame &operator=(const Frame &) = delete;

    Frame(Frame &&other) noexcept
        : api_(std::exchange(other.api_, nullptr)), value_(std::exchange(other.value_, nullptr)) {}

    Frame &operator=(Frame &&other) noexcept {
        if (this != &other) {
            reset();
            api_ = std::exchange(other.api_, nullptr);
            value_ = std::exchange(other.value_, nullptr);
        }
        return *this;
    }

    [[nodiscard]] const VSFrame *get() const noexcept { return value_; }

private:
    void reset() noexcept {
        if (value_ != nullptr) {
            api_->freeFrame(value_);
            value_ = nullptr;
        }
    }

    const VSAPI *api_ = nullptr;
    const VSFrame *value_ = nullptr;
};

struct FrameInfo final {
    uint32_t width;
    uint32_t height;
    size_t rgba_bytes;
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
    return result <= maximum_rgba_bytes;
}

[[nodiscard]] bool has_map_error(const VSAPI *api, const VSMap *map) noexcept {
    return api->mapGetError(map) != nullptr;
}

[[nodiscard]] vs_browser_status describe_rgb24_frame(
    const VSAPI *api,
    const VSFrame *frame,
    FrameInfo &result) noexcept {
    const VSVideoFormat *format = api->getVideoFrameFormat(frame);
    if (format == nullptr || format->colorFamily != cfRGB || format->sampleType != stInteger ||
        format->bitsPerSample != 8 || format->bytesPerSample != 1 || format->numPlanes != 3) {
        return VS_BROWSER_STATUS_UNEXPECTED_FRAME;
    }

    const int frame_width = api->getFrameWidth(frame, 0);
    const int frame_height = api->getFrameHeight(frame, 0);
    if (frame_width <= 0 || frame_height <= 0) {
        return VS_BROWSER_STATUS_UNEXPECTED_FRAME;
    }

    for (int plane = 1; plane < 3; ++plane) {
        if (api->getFrameWidth(frame, plane) != frame_width || api->getFrameHeight(frame, plane) != frame_height) {
            return VS_BROWSER_STATUS_UNEXPECTED_FRAME;
        }
    }

    const uint32_t width = static_cast<uint32_t>(frame_width);
    const uint32_t height = static_cast<uint32_t>(frame_height);
    size_t rgba_bytes = 0;
    if (!rgba_byte_count(width, height, rgba_bytes)) {
        return VS_BROWSER_STATUS_INVALID_ARGUMENT;
    }

    result = FrameInfo{width, height, rgba_bytes};
    return VS_BROWSER_STATUS_OK;
}

[[nodiscard]] vs_browser_status copy_rgb24_to_rgba(
    const VSAPI *api,
    const VSFrame *frame,
    std::span<uint8_t> output) noexcept {
    FrameInfo info{};
    const vs_browser_status description_status = describe_rgb24_frame(api, frame, info);
    if (description_status != VS_BROWSER_STATUS_OK) {
        return description_status;
    }
    if (output.size() < info.rgba_bytes) {
        return VS_BROWSER_STATUS_OUTPUT_TOO_SMALL;
    }

    std::array<const uint8_t *, 3> planes{};
    std::array<ptrdiff_t, 3> strides{};
    const ptrdiff_t required_stride = static_cast<ptrdiff_t>(info.width);
    for (int plane = 0; plane < 3; ++plane) {
        planes[plane] = api->getReadPtr(frame, plane);
        strides[plane] = api->getStride(frame, plane);
        if (planes[plane] == nullptr || strides[plane] < required_stride) {
            return VS_BROWSER_STATUS_UNEXPECTED_FRAME;
        }
    }

    const size_t row_width = info.width;
    for (uint32_t row = 0; row < info.height; ++row) {
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

[[nodiscard]] vs_browser_status create_core_state(std::shared_ptr<CoreState> &result) {
    result.reset();

    const VSAPI *api = getVapourSynthAPI(VAPOURSYNTH_API_VERSION);
    if (api == nullptr) {
        return VS_BROWSER_STATUS_API_UNAVAILABLE;
    }

    auto core = std::make_shared<CoreState>(api, ccfDisableAutoLoading | ccfDisableLibraryUnloading);
    if (core->get() == nullptr) {
        return VS_BROWSER_STATUS_CORE_UNAVAILABLE;
    }
    if (api->setThreadCount(1, core->get()) != 1) {
        return VS_BROWSER_STATUS_CORE_UNAVAILABLE;
    }

    result = std::move(core);
    return VS_BROWSER_STATUS_OK;
}

[[nodiscard]] bool valid_span(const uint8_t *bytes, uint32_t length) noexcept {
    return bytes != nullptr && length != 0;
}

[[nodiscard]] bool span_has_nul(const uint8_t *bytes, uint32_t length) noexcept {
    return std::memchr(bytes, 0, static_cast<size_t>(length)) != nullptr;
}

[[nodiscard]] std::string span_string(const uint8_t *bytes, uint32_t length) {
    return std::string(reinterpret_cast<const char *>(bytes), static_cast<size_t>(length));
}

void clear_error_text(char *error, uint32_t error_size) noexcept {
    if (error != nullptr && error_size != 0) {
        error[0] = '\0';
    }
}

void write_error_text(const VSAPI *api, const VSMap *map, char *error, uint32_t error_size) noexcept {
    if (error == nullptr || error_size == 0 || map == nullptr) {
        clear_error_text(error, error_size);
        return;
    }

    const char *text = api->mapGetError(map);
    if (text == nullptr) {
        error[0] = '\0';
        return;
    }

    size_t length = std::strlen(text);
    const size_t budget = static_cast<size_t>(error_size) - 1;
    if (length > budget) {
        length = budget;
    }
    std::memcpy(error, text, length);
    error[length] = '\0';
}

[[nodiscard]] vs_browser_status validate_descriptors(
    const vs_browser_argument *arguments,
    uint32_t argument_count) noexcept {
    if (argument_count == 0) {
        return VS_BROWSER_STATUS_OK;
    }
    if (arguments == nullptr) {
        return VS_BROWSER_STATUS_INVALID_ARGUMENT;
    }

    for (uint32_t index = 0; index < argument_count; ++index) {
        const vs_browser_argument &argument = arguments[index];
        if (argument.key == nullptr || argument.key_length == 0 ||
            span_has_nul(argument.key, argument.key_length)) {
            return VS_BROWSER_STATUS_INVALID_ARGUMENT;
        }
        if (argument.kind < VS_BROWSER_ARGUMENT_INT || argument.kind > VS_BROWSER_ARGUMENT_NODE) {
            return VS_BROWSER_STATUS_INVALID_ARGUMENT;
        }
        if (argument.value_count == 0 || argument.values == nullptr) {
            return VS_BROWSER_STATUS_INVALID_ARGUMENT;
        }
        for (uint32_t previous = 0; previous < index; ++previous) {
            const vs_browser_argument &earlier = arguments[previous];
            if (earlier.key_length == argument.key_length &&
                std::memcmp(earlier.key, argument.key, argument.key_length) == 0) {
                return VS_BROWSER_STATUS_INVALID_ARGUMENT;
            }
        }
    }

    return VS_BROWSER_STATUS_OK;
}

struct Token final {
    uint32_t slot = 0;
    uint32_t generation = 0;
    [[nodiscard]] bool valid() const noexcept { return slot != 0 && generation != 0; }
};
struct CoreLease final {
    std::shared_ptr<CoreState> core;
};
struct NodeLease final {
    std::shared_ptr<CoreState> core;
    Node node;
};
struct FrameLease final {
    std::shared_ptr<CoreState> core;
    Frame frame;
};
using Resource = std::variant<CoreLease, NodeLease, FrameLease>;
enum class ResourceKind : uint8_t {
    Core,
    Node,
    Frame,
};
struct Slot final {
    uint32_t generation = 0;
    uint32_t next_free = 0;
    bool retired = false;
    std::optional<Resource> resource;
};
class HandleTable final {
public:
    [[nodiscard]] bool has_active_core() const noexcept { return !active_core_.expired(); }
    void set_active_core(const std::shared_ptr<CoreState> &core) noexcept { active_core_ = core; }
    [[nodiscard]] vs_browser_status insert(Resource resource, Token &result) {
        result = Token{};
        if (free_head_ != 0) {
            const uint32_t slot_index = free_head_;
            Slot &slot = slots_[static_cast<size_t>(slot_index) - 1];
            free_head_ = slot.next_free;
            slot.next_free = 0;
            if (slot.retired || slot.resource.has_value() || slot.generation == std::numeric_limits<uint32_t>::max()) {
                return VS_BROWSER_STATUS_INTERNAL_FAILURE;
            }
            ++slot.generation;
            slot.resource.emplace(std::move(resource));
            result = Token{slot_index, slot.generation};
            return VS_BROWSER_STATUS_OK;
        }
        if (slots_.size() >= static_cast<size_t>(std::numeric_limits<uint32_t>::max())) {
            return VS_BROWSER_STATUS_HANDLE_TABLE_EXHAUSTED;
        }
        Slot slot;
        slot.generation = 1;
        slot.resource.emplace(std::move(resource));
        slots_.push_back(std::move(slot));
        result = Token{static_cast<uint32_t>(slots_.size()), 1};
        return VS_BROWSER_STATUS_OK;
    }
    template <typename Lease>
    [[nodiscard]] Lease *get(Token token, vs_browser_status &status) noexcept {
        Slot *slot = find_slot(token, status);
        if (slot == nullptr) {
            return nullptr;
        }
        Lease *lease = std::get_if<Lease>(&slot->resource.value());
        if (lease == nullptr) {
            status = VS_BROWSER_STATUS_HANDLE_KIND_MISMATCH;
        }
        return lease;
    }
    [[nodiscard]] vs_browser_status release(Token token, ResourceKind expected_kind) noexcept {
        vs_browser_status status = VS_BROWSER_STATUS_OK;
        Slot *slot = find_slot(token, status);
        if (slot == nullptr) {
            return status;
        }
        if (!has_kind(slot->resource.value(), expected_kind)) {
            return VS_BROWSER_STATUS_HANDLE_KIND_MISMATCH;
        }
        slot->resource.reset();
        if (slot->generation == std::numeric_limits<uint32_t>::max()) {
            slot->retired = true;
            return VS_BROWSER_STATUS_OK;
        }
        slot->next_free = free_head_;
        free_head_ = token.slot;
        return VS_BROWSER_STATUS_OK;
    }
private:
    [[nodiscard]] Slot *find_slot(Token token, vs_browser_status &status) noexcept {
        if (!token.valid()) {
            status = VS_BROWSER_STATUS_INVALID_HANDLE;
            return nullptr;
        }
        const size_t slot_index = static_cast<size_t>(token.slot) - 1;
        if (slot_index >= slots_.size()) {
            status = VS_BROWSER_STATUS_INVALID_HANDLE;
            return nullptr;
        }
        Slot &slot = slots_[slot_index];
        if (!slot.resource.has_value() || slot.generation != token.generation) {
            status = VS_BROWSER_STATUS_INVALID_HANDLE;
            return nullptr;
        }
        status = VS_BROWSER_STATUS_OK;
        return &slot;
    }
    [[nodiscard]] static bool has_kind(const Resource &resource, ResourceKind expected_kind) noexcept {
        switch (expected_kind) {
        case ResourceKind::Core:
            return std::holds_alternative<CoreLease>(resource);
        case ResourceKind::Node:
            return std::holds_alternative<NodeLease>(resource);
        case ResourceKind::Frame:
            return std::holds_alternative<FrameLease>(resource);
        }
        return false;
    }
    std::vector<Slot> slots_;
    uint32_t free_head_ = 0;
    std::weak_ptr<CoreState> active_core_;
};
HandleTable handles;

[[nodiscard]] vs_browser_status populate_map(
    const VSAPI *api,
    VSMap *map,
    const vs_browser_argument *arguments,
    uint32_t argument_count) noexcept {
    for (uint32_t index = 0; index < argument_count; ++index) {
        const vs_browser_argument &argument = arguments[index];
        const std::string key = span_string(argument.key, argument.key_length);
        const char *key_c = key.c_str();

        switch (argument.kind) {
        case VS_BROWSER_ARGUMENT_INT:
            if (argument.value_count == 1) {
                int64_t value = 0;
                std::memcpy(&value, argument.values, sizeof(value));
                if (api->mapSetInt(map, key_c, value, maReplace) != 0) {
                    return VS_BROWSER_STATUS_MAP_WRITE_FAILED;
                }
            } else if (api->mapSetIntArray(
                           map,
                           key_c,
                           static_cast<const int64_t *>(argument.values),
                           static_cast<int>(argument.value_count)) != 0) {
                return VS_BROWSER_STATUS_MAP_WRITE_FAILED;
            }
            break;

        case VS_BROWSER_ARGUMENT_FLOAT:
            if (argument.value_count == 1) {
                double value = 0;
                std::memcpy(&value, argument.values, sizeof(value));
                if (api->mapSetFloat(map, key_c, value, maReplace) != 0) {
                    return VS_BROWSER_STATUS_MAP_WRITE_FAILED;
                }
            } else if (api->mapSetFloatArray(
                           map,
                           key_c,
                           static_cast<const double *>(argument.values),
                           static_cast<int>(argument.value_count)) != 0) {
                return VS_BROWSER_STATUS_MAP_WRITE_FAILED;
            }
            break;

        case VS_BROWSER_ARGUMENT_DATA:
            if (api->mapSetData(
                    map,
                    key_c,
                    static_cast<const char *>(argument.values),
                    static_cast<int>(argument.value_count),
                    dtBinary,
                    maReplace) != 0) {
                return VS_BROWSER_STATUS_MAP_WRITE_FAILED;
            }
            break;

        case VS_BROWSER_ARGUMENT_NODE: {
            const auto *pairs = static_cast<const uint8_t *>(argument.values);
            for (uint32_t element = 0; element < argument.value_count; ++element) {
                uint32_t slot = 0;
                uint32_t generation = 0;
                std::memcpy(&slot, pairs + static_cast<size_t>(element) * 8, sizeof(slot));
                std::memcpy(&generation, pairs + static_cast<size_t>(element) * 8 + 4, sizeof(generation));

                vs_browser_status status = VS_BROWSER_STATUS_OK;
                NodeLease *lease = handles.get<NodeLease>(Token{slot, generation}, status);
                if (lease == nullptr) {
                    return status;
                }

                // The map takes ownership of this fresh reference; the upstream
                // map consumes it even when mapConsumeNode reports failure.
                VSNode *reference = api->addNodeRef(lease->node.get());
                if (reference == nullptr) {
                    return VS_BROWSER_STATUS_NODE_UNAVAILABLE;
                }
                if (api->mapConsumeNode(map, key_c, reference, element == 0 ? maReplace : maAppend) != 0) {
                    return VS_BROWSER_STATUS_MAP_WRITE_FAILED;
                }
            }
            break;
        }

        default:
            return VS_BROWSER_STATUS_INVALID_ARGUMENT;
        }
    }

    return VS_BROWSER_STATUS_OK;
}

[[nodiscard]] vs_browser_status invoke_core(
    const std::shared_ptr<CoreState> &core,
    const uint8_t *namespace_bytes,
    uint32_t namespace_length,
    const uint8_t *function_bytes,
    uint32_t function_length,
    const vs_browser_argument *arguments,
    uint32_t argument_count,
    const uint8_t *result_key_bytes,
    uint32_t result_key_length,
    uint32_t result_index,
    char *error,
    uint32_t error_size,
    Node &result) noexcept {
    result = Node{};
    clear_error_text(error, error_size);

    if (!valid_span(namespace_bytes, namespace_length) ||
        span_has_nul(namespace_bytes, namespace_length) ||
        !valid_span(function_bytes, function_length) ||
        span_has_nul(function_bytes, function_length) ||
        !valid_span(result_key_bytes, result_key_length) ||
        span_has_nul(result_key_bytes, result_key_length) ||
        (error_size != 0 && error == nullptr)) {
        return VS_BROWSER_STATUS_INVALID_ARGUMENT;
    }

    const vs_browser_status descriptor_status = validate_descriptors(arguments, argument_count);
    if (descriptor_status != VS_BROWSER_STATUS_OK) {
        return descriptor_status;
    }

    const VSAPI *api = core->api();
    const std::string namespace_name = span_string(namespace_bytes, namespace_length);
    const std::string function_name = span_string(function_bytes, function_length);
    const std::string result_key = span_string(result_key_bytes, result_key_length);

    VSPlugin *plugin = api->getPluginByNamespace(namespace_name.c_str(), core->get());
    if (plugin == nullptr) {
        return VS_BROWSER_STATUS_UNKNOWN_FUNCTION;
    }
    if (api->getPluginFunctionByName(function_name.c_str(), plugin) == nullptr) {
        return VS_BROWSER_STATUS_UNKNOWN_FUNCTION;
    }

    Map arguments_map(api);
    if (arguments_map.get() == nullptr) {
        return VS_BROWSER_STATUS_MAP_WRITE_FAILED;
    }
    const vs_browser_status populate_status =
        populate_map(api, arguments_map.get(), arguments, argument_count);
    if (populate_status != VS_BROWSER_STATUS_OK) {
        return populate_status;
    }

    Map invocation(api, api->invoke(plugin, function_name.c_str(), arguments_map.get()));
    if (invocation.get() == nullptr || has_map_error(api, invocation.get())) {
        write_error_text(api, invocation.get(), error, error_size);
        return VS_BROWSER_STATUS_INVOCATION_FAILED;
    }

    if (result_index > static_cast<uint32_t>(INT_MAX)) {
        return VS_BROWSER_STATUS_NODE_UNAVAILABLE;
    }

    int node_error = 0;
    Node node(
        api,
        api->mapGetNode(invocation.get(), result_key.c_str(), static_cast<int>(result_index), &node_error));
    if (node_error != 0 || node.get() == nullptr) {
        return VS_BROWSER_STATUS_NODE_UNAVAILABLE;
    }

    result = std::move(node);
    return VS_BROWSER_STATUS_OK;
}

[[nodiscard]] vs_browser_status request_frame(
    const std::shared_ptr<CoreState> &core,
    VSNode *node,
    uint32_t frame_number,
    Frame &result) noexcept {
    if (frame_number > static_cast<uint32_t>(INT_MAX)) {
        return VS_BROWSER_STATUS_INVALID_ARGUMENT;
    }

    std::array<char, 1024> error{};
    Frame frame(
        core->api(),
        core->api()->getFrame(static_cast<int>(frame_number), node, error.data(), static_cast<int>(error.size())));
    if (frame.get() == nullptr) {
        return VS_BROWSER_STATUS_FRAME_REQUEST_FAILED;
    }

    result = std::move(frame);
    return VS_BROWSER_STATUS_OK;
}


[[nodiscard]] vs_browser_status create_core(Token &result) {
    result = Token{};
    if (handles.has_active_core()) {
        return VS_BROWSER_STATUS_CORE_ALREADY_ACTIVE;
    }

    std::shared_ptr<CoreState> core;
    const vs_browser_status core_status = create_core_state(core);
    if (core_status != VS_BROWSER_STATUS_OK) {
        return core_status;
    }

    const vs_browser_status insert_status = handles.insert(Resource{CoreLease{core}}, result);
    if (insert_status == VS_BROWSER_STATUS_OK) {
        handles.set_active_core(core);
    }
    return insert_status;
}

[[nodiscard]] vs_browser_status get_node_frame(Token node_token, uint32_t frame_number, Token &result) {
    result = Token{};

    vs_browser_status status = VS_BROWSER_STATUS_OK;
    NodeLease *node = handles.get<NodeLease>(node_token, status);
    if (node == nullptr) {
        return status;
    }

    const std::shared_ptr<CoreState> core = node->core;
    VSNode *source_node = node->node.get();
    Frame frame;
    status = request_frame(core, source_node, frame_number, frame);
    if (status != VS_BROWSER_STATUS_OK) {
        return status;
    }

    return handles.insert(Resource{FrameLease{core, std::move(frame)}}, result);
}

[[nodiscard]] vs_browser_status get_frame_info(Token frame_token, FrameInfo &result) noexcept {
    vs_browser_status status = VS_BROWSER_STATUS_OK;
    FrameLease *frame = handles.get<FrameLease>(frame_token, status);
    if (frame == nullptr) {
        return status;
    }

    return describe_rgb24_frame(frame->core->api(), frame->frame.get(), result);
}

[[nodiscard]] vs_browser_status copy_frame(Token frame_token, std::span<uint8_t> output) noexcept {
    vs_browser_status status = VS_BROWSER_STATUS_OK;
    FrameLease *frame = handles.get<FrameLease>(frame_token, status);
    if (frame == nullptr) {
        return status;
    }

    return copy_rgb24_to_rgba(frame->core->api(), frame->frame.get(), output);
}

[[nodiscard]] bool reset_token_output(uint32_t *slot, uint32_t *generation) noexcept {
    if (slot != nullptr) {
        *slot = 0;
    }
    if (generation != nullptr) {
        *generation = 0;
    }
    return slot != nullptr && generation != nullptr;
}

void write_token(Token token, uint32_t *slot, uint32_t *generation) noexcept {
    *slot = token.slot;
    *generation = token.generation;
}

[[nodiscard]] bool reset_scalar_output(uint32_t *output) noexcept {
    if (output == nullptr) {
        return false;
    }
    *output = 0;
    return true;
}

template <typename Action>
[[nodiscard]] vs_browser_status protect(Action &&action) noexcept {
    try {
        return std::forward<Action>(action)();
    } catch (...) {
        return VS_BROWSER_STATUS_INTERNAL_FAILURE;
    }
}

} // namespace

extern "C" uint32_t vs_browser_handle_abi_version(void) noexcept {
    return VS_BROWSER_HANDLE_ABI_VERSION;
}

extern "C" vs_browser_status vs_browser_core_create(uint32_t *out_slot, uint32_t *out_generation) noexcept {
    if (!reset_token_output(out_slot, out_generation)) {
        return VS_BROWSER_STATUS_INVALID_ARGUMENT;
    }

    return protect([&] {
        Token token;
        const vs_browser_status status = create_core(token);
        if (status == VS_BROWSER_STATUS_OK) {
            write_token(token, out_slot, out_generation);
        }
        return status;
    });
}

extern "C" vs_browser_status vs_browser_core_release(uint32_t slot, uint32_t generation) noexcept {
    return protect([&] { return handles.release(Token{slot, generation}, ResourceKind::Core); });
}

extern "C" vs_browser_status vs_browser_core_invoke(
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
    uint32_t *out_node_generation) noexcept {
    if (!reset_token_output(out_node_slot, out_node_generation)) {
        return VS_BROWSER_STATUS_INVALID_ARGUMENT;
    }

    return protect([&] {
        vs_browser_status status = VS_BROWSER_STATUS_OK;
        CoreLease *lease = handles.get<CoreLease>(Token{core_slot, core_generation}, status);
        if (lease == nullptr) {
            return status;
        }

        Node node;
        status = invoke_core(
            lease->core,
            namespace_name,
            namespace_length,
            function_name,
            function_length,
            arguments,
            argument_count,
            result_key,
            result_key_length,
            result_index,
            error,
            error_size,
            node);
        if (status != VS_BROWSER_STATUS_OK) {
            return status;
        }

        Token token;
        status = handles.insert(Resource{NodeLease{lease->core, std::move(node)}}, token);
        if (status == VS_BROWSER_STATUS_OK) {
            write_token(token, out_node_slot, out_node_generation);
        }
        return status;
    });
}

extern "C" vs_browser_status vs_browser_node_get_frame(
    uint32_t node_slot,
    uint32_t node_generation,
    uint32_t frame_number,
    uint32_t *out_frame_slot,
    uint32_t *out_frame_generation) noexcept {
    if (!reset_token_output(out_frame_slot, out_frame_generation)) {
        return VS_BROWSER_STATUS_INVALID_ARGUMENT;
    }

    return protect([&] {
        Token frame;
        const vs_browser_status status = get_node_frame(Token{node_slot, node_generation}, frame_number, frame);
        if (status == VS_BROWSER_STATUS_OK) {
            write_token(frame, out_frame_slot, out_frame_generation);
        }
        return status;
    });
}

extern "C" vs_browser_status vs_browser_node_release(uint32_t slot, uint32_t generation) noexcept {
    return protect([&] { return handles.release(Token{slot, generation}, ResourceKind::Node); });
}

extern "C" vs_browser_status vs_browser_frame_dimensions(
    uint32_t slot,
    uint32_t generation,
    uint32_t *out_width,
    uint32_t *out_height) noexcept {
    if (!reset_scalar_output(out_width) || !reset_scalar_output(out_height)) {
        return VS_BROWSER_STATUS_INVALID_ARGUMENT;
    }

    return protect([&] {
        FrameInfo info{};
        const vs_browser_status status = get_frame_info(Token{slot, generation}, info);
        if (status == VS_BROWSER_STATUS_OK) {
            *out_width = info.width;
            *out_height = info.height;
        }
        return status;
    });
}

extern "C" vs_browser_status vs_browser_frame_rgba8_size(
    uint32_t slot,
    uint32_t generation,
    uint32_t *out_size) noexcept {
    if (!reset_scalar_output(out_size)) {
        return VS_BROWSER_STATUS_INVALID_ARGUMENT;
    }

    return protect([&] {
        FrameInfo info{};
        const vs_browser_status status = get_frame_info(Token{slot, generation}, info);
        if (status == VS_BROWSER_STATUS_OK) {
            *out_size = static_cast<uint32_t>(info.rgba_bytes);
        }
        return status;
    });
}

extern "C" vs_browser_status vs_browser_frame_copy_rgba8(
    uint32_t slot,
    uint32_t generation,
    uint8_t *rgba,
    uint32_t rgba_size) noexcept {
    if (rgba == nullptr) {
        return VS_BROWSER_STATUS_INVALID_ARGUMENT;
    }

    return protect([&] {
        return copy_frame(Token{slot, generation}, std::span<uint8_t>(rgba, static_cast<size_t>(rgba_size)));
    });
}

extern "C" vs_browser_status vs_browser_frame_release(uint32_t slot, uint32_t generation) noexcept {
    return protect([&] { return handles.release(Token{slot, generation}, ResourceKind::Frame); });
}
