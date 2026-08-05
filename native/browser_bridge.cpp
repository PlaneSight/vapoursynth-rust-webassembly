#include "browser_bridge.h"

#include <VapourSynth4.h>
#include <VSHelper4.h>

#include <array>
#include <climits>
#include <cstddef>
#include <cstdint>
#include <limits>
#include <memory>
#include <optional>
#include <span>
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

[[nodiscard]] bool valid_dimensions(uint32_t width, uint32_t height) noexcept {
    size_t rgba_bytes = 0;
    return width <= static_cast<uint32_t>(INT_MAX) && height <= static_cast<uint32_t>(INT_MAX) &&
           rgba_byte_count(width, height, rgba_bytes);
}

[[nodiscard]] bool map_set_int(const VSAPI *api, VSMap *map, const char *key, int64_t value) noexcept {
    return api->mapSetInt(map, key, value, maReplace) == 0;
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

[[nodiscard]] vs_browser_status create_blank_clip_node(
    const std::shared_ptr<CoreState> &core,
    uint32_t width,
    uint32_t height,
    Node &result) noexcept {
    if (!valid_dimensions(width, height)) {
        return VS_BROWSER_STATUS_INVALID_ARGUMENT;
    }

    const VSAPI *api = core->api();
    VSPlugin *standard = api->getPluginByID(VSH_STD_PLUGIN_ID, core->get());
    if (standard == nullptr) {
        return VS_BROWSER_STATUS_STANDARD_PLUGIN_UNAVAILABLE;
    }

    Map arguments(api);
    if (arguments.get() == nullptr || !map_set_int(api, arguments.get(), "width", width) ||
        !map_set_int(api, arguments.get(), "height", height) ||
        !map_set_int(api, arguments.get(), "format", pfRGB24) || !map_set_int(api, arguments.get(), "length", 1)) {
        return VS_BROWSER_STATUS_MAP_WRITE_FAILED;
    }

    Map invocation(api, api->invoke(standard, "BlankClip", arguments.get()));
    if (invocation.get() == nullptr || has_map_error(api, invocation.get())) {
        return VS_BROWSER_STATUS_INVOCATION_FAILED;
    }

    int node_error = 0;
    Node node(api, api->mapGetNode(invocation.get(), "clip", 0, &node_error));
    if (node_error != 0 || node.get() == nullptr) {
        return VS_BROWSER_STATUS_NODE_UNAVAILABLE;
    }

    result = std::move(node);
    return VS_BROWSER_STATUS_OK;
}

[[nodiscard]] vs_browser_status create_inverted_node(
    const std::shared_ptr<CoreState> &core,
    VSNode *source,
    Node &result) noexcept {
    const VSAPI *api = core->api();
    VSPlugin *standard = api->getPluginByID(VSH_STD_PLUGIN_ID, core->get());
    if (standard == nullptr) {
        return VS_BROWSER_STATUS_STANDARD_PLUGIN_UNAVAILABLE;
    }

    Node source_reference(api, api->addNodeRef(source));
    if (source_reference.get() == nullptr) {
        return VS_BROWSER_STATUS_NODE_UNAVAILABLE;
    }

    Map arguments(api);
    if (arguments.get() == nullptr) {
        return VS_BROWSER_STATUS_MAP_WRITE_FAILED;
    }
    if (api->mapConsumeNode(arguments.get(), "clip", source_reference.release(), maReplace) != 0) {
        return VS_BROWSER_STATUS_MAP_WRITE_FAILED;
    }

    Map invocation(api, api->invoke(standard, "Invert", arguments.get()));
    if (invocation.get() == nullptr || has_map_error(api, invocation.get())) {
        return VS_BROWSER_STATUS_INVOCATION_FAILED;
    }

    int node_error = 0;
    Node node(api, api->mapGetNode(invocation.get(), "clip", 0, &node_error));
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

[[nodiscard]] vs_browser_status create_blank_clip(Token core_token, uint32_t width, uint32_t height, Token &result) {
    result = Token{};

    vs_browser_status status = VS_BROWSER_STATUS_OK;
    CoreLease *lease = handles.get<CoreLease>(core_token, status);
    if (lease == nullptr) {
        return status;
    }

    const std::shared_ptr<CoreState> core = lease->core;
    Node node;
    status = create_blank_clip_node(core, width, height, node);
    if (status != VS_BROWSER_STATUS_OK) {
        return status;
    }

    return handles.insert(Resource{NodeLease{core, std::move(node)}}, result);
}

[[nodiscard]] vs_browser_status invert_node(Token source_token, Token &result) {
    result = Token{};

    vs_browser_status status = VS_BROWSER_STATUS_OK;
    NodeLease *source = handles.get<NodeLease>(source_token, status);
    if (source == nullptr) {
        return status;
    }

    const std::shared_ptr<CoreState> core = source->core;
    VSNode *source_node = source->node.get();
    Node inverted;
    status = create_inverted_node(core, source_node, inverted);
    if (status != VS_BROWSER_STATUS_OK) {
        return status;
    }

    return handles.insert(Resource{NodeLease{core, std::move(inverted)}}, result);
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

class TokenScope final {
public:
    explicit TokenScope(ResourceKind kind) noexcept : kind_(kind) {}

    ~TokenScope() {
        if (token_.valid()) {
            static_cast<void>(handles.release(token_, kind_));
        }
    }

    TokenScope(const TokenScope &) = delete;
    TokenScope &operator=(const TokenScope &) = delete;
    TokenScope(TokenScope &&) = delete;
    TokenScope &operator=(TokenScope &&) = delete;

    void reset(Token token) noexcept { token_ = token; }

    [[nodiscard]] Token get() const noexcept { return token_; }

private:
    ResourceKind kind_;
    Token token_;
};

[[nodiscard]] vs_browser_status render_inverted_blank(
    uint32_t width,
    uint32_t height,
    std::span<uint8_t> output) {
    if (!valid_dimensions(width, height)) {
        return VS_BROWSER_STATUS_INVALID_ARGUMENT;
    }

    TokenScope core(ResourceKind::Core);
    TokenScope blank(ResourceKind::Node);
    TokenScope inverted(ResourceKind::Node);
    TokenScope frame(ResourceKind::Frame);

    Token token;
    vs_browser_status status = create_core(token);
    if (status != VS_BROWSER_STATUS_OK) {
        return status;
    }
    core.reset(token);

    status = create_blank_clip(core.get(), width, height, token);
    if (status != VS_BROWSER_STATUS_OK) {
        return status;
    }
    blank.reset(token);

    status = invert_node(blank.get(), token);
    if (status != VS_BROWSER_STATUS_OK) {
        return status;
    }
    inverted.reset(token);

    status = get_node_frame(inverted.get(), 0, token);
    if (status != VS_BROWSER_STATUS_OK) {
        return status;
    }
    frame.reset(token);

    return copy_frame(frame.get(), output);
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

extern "C" vs_browser_status vs_browser_core_blank_clip(
    uint32_t core_slot,
    uint32_t core_generation,
    uint32_t width,
    uint32_t height,
    uint32_t *out_node_slot,
    uint32_t *out_node_generation) noexcept {
    if (!reset_token_output(out_node_slot, out_node_generation)) {
        return VS_BROWSER_STATUS_INVALID_ARGUMENT;
    }

    return protect([&] {
        Token node;
        const vs_browser_status status = create_blank_clip(Token{core_slot, core_generation}, width, height, node);
        if (status == VS_BROWSER_STATUS_OK) {
            write_token(node, out_node_slot, out_node_generation);
        }
        return status;
    });
}

extern "C" vs_browser_status vs_browser_node_invert(
    uint32_t node_slot,
    uint32_t node_generation,
    uint32_t *out_node_slot,
    uint32_t *out_node_generation) noexcept {
    if (!reset_token_output(out_node_slot, out_node_generation)) {
        return VS_BROWSER_STATUS_INVALID_ARGUMENT;
    }

    return protect([&] {
        Token node;
        const vs_browser_status status = invert_node(Token{node_slot, node_generation}, node);
        if (status == VS_BROWSER_STATUS_OK) {
            write_token(node, out_node_slot, out_node_generation);
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

extern "C" vs_browser_status vs_browser_render_inverted_blank(
    uint32_t width,
    uint32_t height,
    uint8_t *rgba,
    uint32_t rgba_size) noexcept {
    size_t required_size = 0;
    if (rgba == nullptr || !rgba_byte_count(width, height, required_size)) {
        return VS_BROWSER_STATUS_INVALID_ARGUMENT;
    }
    if (static_cast<size_t>(rgba_size) < required_size) {
        return VS_BROWSER_STATUS_OUTPUT_TOO_SMALL;
    }

    return protect([&] { return render_inverted_blank(width, height, std::span<uint8_t>(rgba, required_size)); });
}
