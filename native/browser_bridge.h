#ifndef VAPOURSYNTH_BROWSER_BRIDGE_H
#define VAPOURSYNTH_BROWSER_BRIDGE_H

#include <stddef.h>
#include <stdint.h>

#if defined(__EMSCRIPTEN__)
#include <emscripten/emscripten.h>
#define VS_BROWSER_EXPORT EMSCRIPTEN_KEEPALIVE
#else
#define VS_BROWSER_EXPORT
#endif

#ifdef __cplusplus
#define VS_BROWSER_NOEXCEPT noexcept
extern "C" {
#else
#define VS_BROWSER_NOEXCEPT
#endif

typedef int32_t vs_browser_status;

enum {
    VS_BROWSER_STATUS_OK = 0,
    VS_BROWSER_STATUS_INVALID_ARGUMENT = 1,
    VS_BROWSER_STATUS_OUTPUT_TOO_SMALL = 2,
    VS_BROWSER_STATUS_API_UNAVAILABLE = 3,
    VS_BROWSER_STATUS_CORE_UNAVAILABLE = 4,
    VS_BROWSER_STATUS_STANDARD_PLUGIN_UNAVAILABLE = 5,
    VS_BROWSER_STATUS_MAP_WRITE_FAILED = 6,
    VS_BROWSER_STATUS_INVOCATION_FAILED = 7,
    VS_BROWSER_STATUS_NODE_UNAVAILABLE = 8,
    VS_BROWSER_STATUS_FRAME_UNAVAILABLE = 9,
    VS_BROWSER_STATUS_UNEXPECTED_FRAME = 10,
    VS_BROWSER_STATUS_INTERNAL_FAILURE = 11,
    VS_BROWSER_STATUS_FRAME_REQUEST_FAILED = 12,
    VS_BROWSER_STATUS_INVALID_HANDLE = 13,
    VS_BROWSER_STATUS_HANDLE_KIND_MISMATCH = 14,
    VS_BROWSER_STATUS_HANDLE_TABLE_EXHAUSTED = 15,
    VS_BROWSER_STATUS_CORE_ALREADY_ACTIVE = 16,
    VS_BROWSER_STATUS_ABI_MISMATCH = 17,
    VS_BROWSER_STATUS_UNKNOWN_FUNCTION = 18,
};

#define VS_BROWSER_HANDLE_ABI_VERSION UINT32_C(1)

/// Value kinds accepted by [`struct vs_browser_argument`].
enum {
    /// Signed 64-bit integers: aligned `int64_t` values.
    VS_BROWSER_ARGUMENT_INT = 1,
    /// Double-precision floats: aligned `double` values.
    VS_BROWSER_ARGUMENT_FLOAT = 2,
    /// Opaque binary bytes; `value_count` is the byte length.
    VS_BROWSER_ARGUMENT_DATA = 3,
    /// Node tokens: `(uint32_t slot, uint32_t generation)` pairs.
    VS_BROWSER_ARGUMENT_NODE = 4,
};

/// One keyed argument descriptor for [`vs_browser_core_invoke`].
///
/// The struct is 20 bytes on wasm32 with 4-byte alignment; fields sit at
/// offsets 0, 4, 8, 12, and 16. `key` is a byte span that does not need a NUL
/// terminator and must not contain one. For INT/FLOAT/NODE kinds `value_count`
/// counts elements (INT and FLOAT element storage is 8-byte aligned; NODE
/// storage is `(slot, generation)` pairs); for DATA it is the byte length.
/// `value_count` must be at least 1 and `values` must be non-null.
typedef struct vs_browser_argument {
    const uint8_t *key;
    uint32_t key_length;
    uint32_t kind;
    const void *values;
    uint32_t value_count;
} vs_browser_argument;

/// Returns the version of the scalar opaque-handle ABI.
VS_BROWSER_EXPORT uint32_t vs_browser_handle_abi_version(void) VS_BROWSER_NOEXCEPT;

/// Creates the only active browser core and returns its opaque token.
///
/// Both output fields are set to zero before work begins and are non-zero only
/// when this function returns [`VS_BROWSER_STATUS_OK`].
VS_BROWSER_EXPORT vs_browser_status vs_browser_core_create(
    uint32_t *out_slot,
    uint32_t *out_generation) VS_BROWSER_NOEXCEPT;

/// Releases a core token. Node and frame leases keep its actual core alive.
VS_BROWSER_EXPORT vs_browser_status vs_browser_core_release(
    uint32_t slot,
    uint32_t generation) VS_BROWSER_NOEXCEPT;

/// Invokes one plugin function generically and returns its result node token.
///
/// `namespace_name` and `function_name` are NUL-free byte spans naming the
/// plugin namespace and function. `arguments` holds `argument_count`
/// descriptors (may be null only when the count is zero). `result_key` names
/// the map key holding the result node and `result_index` selects one of its
/// values. Node descriptors resolve through the handle table: stale tokens
/// yield [`VS_BROWSER_STATUS_INVALID_HANDLE`] and non-node tokens yield
/// [`VS_BROWSER_STATUS_HANDLE_KIND_MISMATCH`]. Unknown namespaces or functions
/// yield [`VS_BROWSER_STATUS_UNKNOWN_FUNCTION`]; a missing result key or index
/// yields [`VS_BROWSER_STATUS_NODE_UNAVAILABLE`].
///
/// On upstream invocation failure the plugin's error text is copied into
/// `error` as a NUL-terminated, size-truncated string; on every other outcome
/// the first byte is NUL'd when the buffer is present. `error` may be null
/// only when `error_size` is zero. Both output fields are set to zero before
/// work begins and are non-zero only on [`VS_BROWSER_STATUS_OK`].
VS_BROWSER_EXPORT vs_browser_status vs_browser_core_invoke(
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
    uint32_t *out_node_generation) VS_BROWSER_NOEXCEPT;

/// Requests one synchronous frame from a retained node token.
VS_BROWSER_EXPORT vs_browser_status vs_browser_node_get_frame(
    uint32_t node_slot,
    uint32_t node_generation,
    uint32_t frame_number,
    uint32_t *out_frame_slot,
    uint32_t *out_frame_generation) VS_BROWSER_NOEXCEPT;
/// Returns video metadata for a retained node token.
///
/// The output fields are zeroed before work begins. `fps_num` and `fps_den`
/// are both zero for variable-rate video.
VS_BROWSER_EXPORT vs_browser_status vs_browser_node_video_info(
    uint32_t node_slot,
    uint32_t node_generation,
    uint32_t *out_width,
    uint32_t *out_height,
    uint32_t *out_num_frames,
    int64_t *out_fps_num,
    int64_t *out_fps_den) VS_BROWSER_NOEXCEPT;

/// Creates a C++-owned RGB24 source node with no upstream dependencies.
///
/// A fixed frame rate requires positive `fps_num` and `fps_den`; `0/0`
/// represents variable frame rate. Frames are populated with
/// [`vs_browser_source_upload_rgba`].
VS_BROWSER_EXPORT vs_browser_status vs_browser_source_create(
    uint32_t core_slot,
    uint32_t core_generation,
    uint32_t width,
    uint32_t height,
    uint32_t num_frames,
    int64_t fps_num,
    int64_t fps_den,
    uint32_t *out_node_slot,
    uint32_t *out_node_generation) VS_BROWSER_NOEXCEPT;

/// Uploads one tightly packed RGBA8 frame into a retained source node.
///
/// A duration pair of `0/0` removes duration metadata; a NaN
/// `absolute_time` removes absolute-time metadata.
VS_BROWSER_EXPORT vs_browser_status vs_browser_source_upload_rgba(
    uint32_t node_slot,
    uint32_t node_generation,
    uint32_t frame_number,
    const uint8_t *rgba,
    uint32_t rgba_size,
    int64_t duration_num,
    int64_t duration_den,
    double absolute_time) VS_BROWSER_NOEXCEPT;

/// Returns optional timing metadata for a retained frame token.
///
/// Missing timing is valid: all outputs are zeroed and `out_flags` is zero.
/// Bit 0 of `out_flags` indicates a complete duration pair; bit 1 indicates
/// an absolute time.
VS_BROWSER_EXPORT vs_browser_status vs_browser_frame_timing(
    uint32_t frame_slot,
    uint32_t frame_generation,
    int64_t *out_duration_num,
    int64_t *out_duration_den,
    double *out_absolute_time,
    uint32_t *out_flags) VS_BROWSER_NOEXCEPT;

/// Releases a node token.
VS_BROWSER_EXPORT vs_browser_status vs_browser_node_release(
    uint32_t slot,
    uint32_t generation) VS_BROWSER_NOEXCEPT;

/// Returns the dimensions of an RGB24 frame retained by a frame token.
VS_BROWSER_EXPORT vs_browser_status vs_browser_frame_dimensions(
    uint32_t slot,
    uint32_t generation,
    uint32_t *out_width,
    uint32_t *out_height) VS_BROWSER_NOEXCEPT;

/// Returns the exact RGBA8 byte count required to copy a retained frame.
VS_BROWSER_EXPORT vs_browser_status vs_browser_frame_rgba8_size(
    uint32_t slot,
    uint32_t generation,
    uint32_t *out_size) VS_BROWSER_NOEXCEPT;

/// Copies a retained RGB24 frame into caller-owned RGBA8 storage.
///
/// Frames whose RGBA8 output exceeds the 16 MiB browser render budget are
/// rejected. The bridge retains neither the output pointer nor its bytes.
VS_BROWSER_EXPORT vs_browser_status vs_browser_frame_copy_rgba8(
    uint32_t slot,
    uint32_t generation,
    uint8_t *rgba,
    uint32_t rgba_size) VS_BROWSER_NOEXCEPT;

/// Releases a frame token.
VS_BROWSER_EXPORT vs_browser_status vs_browser_frame_release(
    uint32_t slot,
    uint32_t generation) VS_BROWSER_NOEXCEPT;

#ifdef __cplusplus
}
#endif

#undef VS_BROWSER_NOEXCEPT
#undef VS_BROWSER_EXPORT

#endif
