// Differential conformance harness: executes a corpus plan (JSON) through the
// opaque-handle browser exports and compares every RGBA8 byte against the
// expected fixture the plan names, or prints deterministic statuses and
// dimensions when no fixture is named.
//
// The harness is fully generic: operations are dispatched through
// vs_browser_core_invoke with no per-function branches, so any plan the
// browser runtime can express runs through the same code path.

#include "browser_bridge.h"

#include <array>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <iterator>
#include <map>
#include <string>
#include <vector>

namespace {

// ---------------------------------------------------------------------------
// Minimal strict JSON parser for the corpus plan shape.
// ---------------------------------------------------------------------------

class Json final {
public:
    enum class Kind { Null, Bool, Number, String, Array, Object };

    Kind kind = Kind::Null;
    bool boolean = false;
    bool integral = false;
    int64_t integer = 0;
    double number = 0.0;
    std::string string;
    std::vector<Json> array;
    std::vector<std::pair<std::string, Json>> object;

    [[nodiscard]] const Json *member(const char *name) const {
        for (const auto &entry : object) {
            if (entry.first == name) {
                return &entry.second;
            }
        }
        return nullptr;
    }
};

class JsonError final {
public:
    explicit JsonError(std::string message) : message_(std::move(message)) {}

    [[nodiscard]] const std::string &message() const { return message_; }

private:
    std::string message_;
};

class JsonParser final {
public:
    explicit JsonParser(const std::string &text) : cursor_(text.data()) {}

    [[nodiscard]] Json parse() {
        skip_whitespace();
        Json value = parse_value();
        skip_whitespace();
        if (*cursor_ != '\0') {
            fail("trailing content after JSON value");
        }
        return value;
    }

private:
    [[nodiscard]] Json parse_value() {
        switch (*cursor_) {
        case '{':
            return parse_object();
        case '[':
            return parse_array();
        case '"':
            return parse_string();
        case 't':
            parse_literal("true");
            {
                Json value;
                value.kind = Json::Kind::Bool;
                value.boolean = true;
                return value;
            }
        case 'f':
            parse_literal("false");
            {
                Json value;
                value.kind = Json::Kind::Bool;
                value.boolean = false;
                return value;
            }
        case 'n':
            parse_literal("null");
            return Json{};
        case '\0':
            fail("unexpected end of input");
        default:
            if (is_number_start(*cursor_)) {
                return parse_number();
            }
            fail("unexpected character in JSON value");
        }
    }

    [[nodiscard]] Json parse_object() {
        Json value;
        value.kind = Json::Kind::Object;
        consume('{');
        skip_whitespace();
        if (*cursor_ == '}') {
            ++cursor_;
            return value;
        }

        while (true) {
            skip_whitespace();
            if (*cursor_ != '"') {
                fail("expected string key in object");
            }
            const std::string key = parse_string().string;
            skip_whitespace();
            consume(':');
            skip_whitespace();
            value.object.emplace_back(key, parse_value());
            skip_whitespace();
            if (*cursor_ == ',') {
                ++cursor_;
                continue;
            }
            consume('}');
            return value;
        }
    }

    [[nodiscard]] Json parse_array() {
        Json value;
        value.kind = Json::Kind::Array;
        consume('[');
        skip_whitespace();
        if (*cursor_ == ']') {
            ++cursor_;
            return value;
        }

        while (true) {
            skip_whitespace();
            value.array.push_back(parse_value());
            skip_whitespace();
            if (*cursor_ == ',') {
                ++cursor_;
                continue;
            }
            consume(']');
            return value;
        }
    }

    [[nodiscard]] Json parse_string() {
        Json value;
        value.kind = Json::Kind::String;
        consume('"');

        std::string result;
        while (true) {
            const char c = *cursor_;
            if (c == '\0') {
                fail("unterminated string");
            }
            if (c == '"') {
                ++cursor_;
                value.string = std::move(result);
                return value;
            }
            if (c == '\\') {
                ++cursor_;
                result.push_back(parse_escape());
                continue;
            }
            if (static_cast<unsigned char>(c) < 0x20) {
                fail("unescaped control character in string");
            }
            result.push_back(c);
            ++cursor_;
        }
    }

    [[nodiscard]] char parse_escape() {
        const char c = *cursor_;
        ++cursor_;
        switch (c) {
        case '"':
            return '"';
        case '\\':
            return '\\';
        case '/':
            return '/';
        case 'b':
            return '\b';
        case 'f':
            return '\f';
        case 'n':
            return '\n';
        case 'r':
            return '\r';
        case 't':
            return '\t';
        case 'u': {
            const uint32_t code_point = parse_hex_quad();
            if (code_point >= 0xD800 && code_point <= 0xDBFF) {
                if (cursor_[0] == '\\' && cursor_[1] == 'u') {
                    cursor_ += 2;
                    const uint32_t low = parse_hex_quad();
                    if (low < 0xDC00 || low > 0xDFFF) {
                        fail("invalid low surrogate");
                    }
                    return encode_utf8(0x10000 + ((code_point - 0xD800) << 10) + (low - 0xDC00));
                }
                fail("unpaired high surrogate");
            }
            if (code_point >= 0xDC00 && code_point <= 0xDFFF) {
                fail("unpaired low surrogate");
            }
            return encode_utf8(code_point);
        }
        default:
            fail("invalid escape sequence");
        }
    }

    [[nodiscard]] uint32_t parse_hex_quad() {
        uint32_t value = 0;
        for (int digit = 0; digit < 4; ++digit) {
            const char c = *cursor_;
            value <<= 4;
            if (c >= '0' && c <= '9') {
                value |= static_cast<uint32_t>(c - '0');
            } else if (c >= 'a' && c <= 'f') {
                value |= static_cast<uint32_t>(c - 'a' + 10);
            } else if (c >= 'A' && c <= 'F') {
                value |= static_cast<uint32_t>(c - 'A' + 10);
            } else {
                fail("invalid hex digit in \\u escape");
            }
            ++cursor_;
        }
        return value;
    }

    [[nodiscard]] char encode_utf8(uint32_t code_point) {
        // The corpus carries ASCII identifiers only; code points beyond
        // U+00FF are rejected to keep the single-byte encoding honest.
        if (code_point > 0xFF) {
            fail("non-Latin-1 code point in string");
        }
        return static_cast<char>(code_point);
    }

    [[nodiscard]] Json parse_number() {
        Json value;
        value.kind = Json::Kind::Number;
        const char *start = cursor_;

        if (*cursor_ == '-') {
            ++cursor_;
        }
        if (*cursor_ == '0') {
            ++cursor_;
        } else {
            if (!is_digit(*cursor_)) {
                fail("invalid number");
            }
            while (is_digit(*cursor_)) {
                ++cursor_;
            }
        }

        bool floating = false;
        if (*cursor_ == '.') {
            floating = true;
            ++cursor_;
            if (!is_digit(*cursor_)) {
                fail("invalid number fraction");
            }
            while (is_digit(*cursor_)) {
                ++cursor_;
            }
        }
        if (*cursor_ == 'e' || *cursor_ == 'E') {
            floating = true;
            ++cursor_;
            if (*cursor_ == '+' || *cursor_ == '-') {
                ++cursor_;
            }
            if (!is_digit(*cursor_)) {
                fail("invalid number exponent");
            }
            while (is_digit(*cursor_)) {
                ++cursor_;
            }
        }

        const std::string text(start, static_cast<size_t>(cursor_ - start));
        if (floating) {
            value.number = std::strtod(text.c_str(), nullptr);
        } else {
            value.integer = std::strtoll(text.c_str(), nullptr, 10);
            value.number = static_cast<double>(value.integer);
            value.integral = true;
        }
        return value;
    }

    void parse_literal(const char *literal) {
        const size_t length = std::strlen(literal);
        if (std::strncmp(cursor_, literal, length) != 0) {
            fail("invalid literal");
        }
        cursor_ += length;
    }

    void consume(char expected) {
        if (*cursor_ != expected) {
            fail("unexpected character");
        }
        ++cursor_;
    }

    void skip_whitespace() {
        while (*cursor_ == ' ' || *cursor_ == '\t' || *cursor_ == '\n' || *cursor_ == '\r') {
            ++cursor_;
        }
    }

    [[nodiscard]] static bool is_digit(char c) { return c >= '0' && c <= '9'; }
    [[nodiscard]] static bool is_number_start(char c) { return c == '-' || is_digit(c); }

    [[noreturn]] void fail(const char *message) const { throw JsonError(message); }

    const char *cursor_ = nullptr;
};

[[nodiscard]] bool parse_plan_file(const std::string &path, Json &plan, std::string &error) {
    std::ifstream stream(path, std::ios::binary);
    if (!stream) {
        error = "could not open plan file: " + path;
        return false;
    }

    const std::string text((std::istreambuf_iterator<char>(stream)), std::istreambuf_iterator<char>());
    if (text.empty()) {
        error = "plan file is empty: " + path;
        return false;
    }

    try {
        plan = JsonParser(text).parse();
    } catch (const JsonError &parse_error) {
        error = "plan JSON parse error: " + parse_error.message();
        return false;
    }
    return true;
}

// ---------------------------------------------------------------------------
// Token helpers
// ---------------------------------------------------------------------------

struct Token final {
    uint32_t slot = 0;
    uint32_t generation = 0;

    [[nodiscard]] bool valid() const noexcept { return slot != 0 && generation != 0; }
};

// ---------------------------------------------------------------------------
// Plan model
// ---------------------------------------------------------------------------

struct PlanArgument final {
    std::string key;
    uint32_t kind = 0;
    std::vector<int64_t> ints;
    std::vector<double> floats;
    std::vector<uint8_t> data;
    std::vector<Token> nodes; // raw plan operation ids until resolved
    std::vector<uint8_t> storage;
};

struct PlanOperation final {
    int64_t id = 0;
    std::string namespace_name;
    std::string function;
    std::vector<PlanArgument> arguments;
};

struct PlanOutput final {
    int64_t index = 0;
    int64_t node_id = 0;
    std::string expected; // empty when the plan names no fixture
};

struct Plan final {
    std::vector<PlanOperation> operations;
    std::vector<PlanOutput> outputs;
};

[[nodiscard]] bool require_member(
    const Json &object,
    const char *name,
    const char *context,
    std::string &error) {
    if (object.member(name) == nullptr) {
        error = std::string("plan ") + context + " is missing \"" + name + "\"";
        return false;
    }
    return true;
}

[[nodiscard]] bool parse_kind(const Json &value, uint32_t &kind, std::string &error) {
    const std::string &name = value.string;
    if (name == "int" || name == "intArray") {
        kind = VS_BROWSER_ARGUMENT_INT;
    } else if (name == "float" || name == "floatArray") {
        kind = VS_BROWSER_ARGUMENT_FLOAT;
    } else if (name == "data") {
        kind = VS_BROWSER_ARGUMENT_DATA;
    } else if (name == "node" || name == "nodeArray") {
        kind = VS_BROWSER_ARGUMENT_NODE;
    } else {
        error = "plan argument has unknown kind \"" + name + "\"";
        return false;
    }
    return true;
}

[[nodiscard]] bool parse_plan(
    const Json &root,
    const std::string &plan_directory,
    Plan &plan,
    std::string &error) {
    if (root.kind != Json::Kind::Object) {
        error = "plan root must be an object";
        return false;
    }

    const Json *version = root.member("version");
    if (version == nullptr || version->kind != Json::Kind::Number || !version->integral ||
        version->integer != 1) {
        error = "plan version must be the integer 1";
        return false;
    }

    const Json *operations = root.member("operations");
    if (operations == nullptr || operations->kind != Json::Kind::Array || operations->array.empty()) {
        error = "plan operations must be a non-empty array";
        return false;
    }

    for (const Json &entry : operations->array) {
        if (entry.kind != Json::Kind::Object) {
            error = "plan operation must be an object";
            return false;
        }
        if (!require_member(entry, "id", "operation", error) ||
            !require_member(entry, "namespace", "operation", error) ||
            !require_member(entry, "function", "operation", error) ||
            !require_member(entry, "arguments", "operation", error)) {
            return false;
        }

        PlanOperation operation;
        const Json *id = entry.member("id");
        const Json *ns = entry.member("namespace");
        const Json *function = entry.member("function");
        const Json *arguments = entry.member("arguments");
        if (id->kind != Json::Kind::Number || !id->integral || id->integer <= 0) {
            error = "plan operation id must be a positive integer";
            return false;
        }
        if (ns->kind != Json::Kind::String || ns->string.empty()) {
            error = "plan operation namespace must be a non-empty string";
            return false;
        }
        if (function->kind != Json::Kind::String || function->string.empty()) {
            error = "plan operation function must be a non-empty string";
            return false;
        }
        if (arguments->kind != Json::Kind::Array) {
            error = "plan operation arguments must be an array";
            return false;
        }

        operation.id = id->integer;
        operation.namespace_name = ns->string;
        operation.function = function->string;

        for (const Json &argument : arguments->array) {
            if (argument.kind != Json::Kind::Object) {
                error = "plan argument must be an object";
                return false;
            }
            if (!require_member(argument, "key", "argument", error) ||
                !require_member(argument, "kind", "argument", error) ||
                !require_member(argument, "value", "argument", error)) {
                return false;
            }

            PlanArgument parsed;
            const Json *key = argument.member("key");
            const Json *kind = argument.member("kind");
            const Json *value = argument.member("value");
            if (key->kind != Json::Kind::String || key->string.empty()) {
                error = "plan argument key must be a non-empty string";
                return false;
            }
            if (kind->kind != Json::Kind::String || !parse_kind(*kind, parsed.kind, error)) {
                return false;
            }

            parsed.key = key->string;
            const bool is_array = kind->string == "intArray" || kind->string == "floatArray" ||
                                  kind->string == "nodeArray";
            switch (parsed.kind) {
            case VS_BROWSER_ARGUMENT_INT: {
                if (is_array) {
                    if (value->kind != Json::Kind::Array) {
                        error = "plan intArray argument value must be an array";
                        return false;
                    }
                    for (const Json &element : value->array) {
                        if (element.kind != Json::Kind::Number || !element.integral) {
                            error = "plan intArray element must be an integer";
                            return false;
                        }
                        parsed.ints.push_back(element.integer);
                    }
                } else {
                    if (value->kind != Json::Kind::Number || !value->integral) {
                        error = "plan int argument must be an integer";
                        return false;
                    }
                    parsed.ints.push_back(value->integer);
                }
                break;
            }
            case VS_BROWSER_ARGUMENT_FLOAT: {
                if (is_array) {
                    if (value->kind != Json::Kind::Array) {
                        error = "plan floatArray argument value must be an array";
                        return false;
                    }
                    for (const Json &element : value->array) {
                        if (element.kind != Json::Kind::Number) {
                            error = "plan floatArray element must be a number";
                            return false;
                        }
                        parsed.floats.push_back(element.number);
                    }
                } else {
                    if (value->kind != Json::Kind::Number) {
                        error = "plan float argument must be a number";
                        return false;
                    }
                    parsed.floats.push_back(value->number);
                }
                break;
            }
            case VS_BROWSER_ARGUMENT_DATA: {
                if (value->kind != Json::Kind::Array) {
                    error = "plan data argument value must be an array of integers";
                    return false;
                }
                for (const Json &element : value->array) {
                    if (element.kind != Json::Kind::Number || !element.integral ||
                        element.integer < 0 || element.integer > 255) {
                        error = "plan data element must be a byte (0..255)";
                        return false;
                    }
                    parsed.data.push_back(static_cast<uint8_t>(element.integer));
                }
                break;
            }
            case VS_BROWSER_ARGUMENT_NODE: {
                // Node references are plan-local operation ids; they are
                // resolved to live tokens during execution.
                if (is_array) {
                    if (value->kind != Json::Kind::Array) {
                        error = "plan nodeArray argument value must be an array";
                        return false;
                    }
                    for (const Json &element : value->array) {
                        if (element.kind != Json::Kind::Number || !element.integral) {
                            error = "plan nodeArray element must be an operation id";
                            return false;
                        }
                        parsed.nodes.emplace_back();
                        parsed.nodes.back().slot = static_cast<uint32_t>(element.integer);
                    }
                } else {
                    if (value->kind != Json::Kind::Number || !value->integral) {
                        error = "plan node argument must be an operation id";
                        return false;
                    }
                    parsed.nodes.emplace_back();
                    parsed.nodes.back().slot = static_cast<uint32_t>(value->integer);
                }
                break;
            }
            default:
                error = "plan argument has an unsupported kind";
                return false;
            }

            if (parsed.ints.empty() && parsed.floats.empty() && parsed.data.empty() && parsed.nodes.empty()) {
                error = "plan argument \"" + parsed.key + "\" carries no values";
                return false;
            }
            operation.arguments.push_back(std::move(parsed));
        }

        plan.operations.push_back(std::move(operation));
    }

    const Json *outputs = root.member("outputs");
    if (outputs == nullptr || outputs->kind != Json::Kind::Array || outputs->array.empty()) {
        error = "plan outputs must be a non-empty array";
        return false;
    }

    for (const Json &entry : outputs->array) {
        if (entry.kind != Json::Kind::Object) {
            error = "plan output must be an object";
            return false;
        }
        if (!require_member(entry, "index", "output", error) ||
            !require_member(entry, "node", "output", error)) {
            return false;
        }

        PlanOutput output;
        const Json *index = entry.member("index");
        const Json *node = entry.member("node");
        if (index->kind != Json::Kind::Number || !index->integral || index->integer < 0) {
            error = "plan output index must be a non-negative integer";
            return false;
        }
        if (node->kind != Json::Kind::Number || !node->integral || node->integer <= 0) {
            error = "plan output node must be a positive operation id";
            return false;
        }
        output.index = index->integer;
        output.node_id = node->integer;

        if (const Json *expected = entry.member("expected"); expected != nullptr) {
            if (expected->kind != Json::Kind::String || expected->string.empty()) {
                error = "plan output expected must be a non-empty path string";
                return false;
            }
            output.expected = plan_directory.empty() ? expected->string : plan_directory + "/" + expected->string;
        }

        plan.outputs.push_back(std::move(output));
    }

    return true;
}

// ---------------------------------------------------------------------------
// Token helpers
// ---------------------------------------------------------------------------

struct HandleScope final {
    std::vector<Token> nodes;
    std::vector<Token> frames;
    Token core{};

    ~HandleScope() {
        for (const Token token : frames) {
            static_cast<void>(vs_browser_frame_release(token.slot, token.generation));
        }
        for (const Token token : nodes) {
            static_cast<void>(vs_browser_node_release(token.slot, token.generation));
        }
        if (core.valid()) {
            static_cast<void>(vs_browser_core_release(core.slot, core.generation));
        }
    }
};

[[nodiscard]] bool expect_status(
    const char *operation,
    vs_browser_status actual,
    vs_browser_status expected,
    const char *detail) {
    if (actual == expected) {
        return true;
    }

    std::fprintf(
        stderr,
        "%s returned %d; expected %d%s%s%s\n",
        operation,
        actual,
        expected,
        detail == nullptr ? "" : " (",
        detail == nullptr ? "" : detail,
        detail == nullptr ? "" : ")");
    return false;
}

[[nodiscard]] bool pack_argument(PlanArgument &argument, std::string &error) {
    switch (argument.kind) {
    case VS_BROWSER_ARGUMENT_INT: {
        argument.storage.resize(argument.ints.size() * sizeof(int64_t));
        auto *values = reinterpret_cast<int64_t *>(argument.storage.data());
        for (size_t index = 0; index < argument.ints.size(); ++index) {
            values[index] = argument.ints[index];
        }
        break;
    }
    case VS_BROWSER_ARGUMENT_FLOAT: {
        argument.storage.resize(argument.floats.size() * sizeof(double));
        auto *values = reinterpret_cast<double *>(argument.storage.data());
        for (size_t index = 0; index < argument.floats.size(); ++index) {
            values[index] = argument.floats[index];
        }
        break;
    }
    case VS_BROWSER_ARGUMENT_DATA:
        argument.storage = argument.data;
        break;
    case VS_BROWSER_ARGUMENT_NODE: {
        argument.storage.resize(argument.nodes.size() * sizeof(uint32_t) * 2);
        auto *pairs = reinterpret_cast<uint32_t *>(argument.storage.data());
        for (size_t index = 0; index < argument.nodes.size(); ++index) {
            pairs[index * 2] = argument.nodes[index].slot;
            pairs[index * 2 + 1] = argument.nodes[index].generation;
        }
        break;
    }
    default:
        error = "internal error: unhandled argument kind";
        return false;
    }
    return true;
}

[[nodiscard]] bool read_file(const std::string &path, std::vector<uint8_t> &bytes, std::string &error) {
    std::ifstream stream(path, std::ios::binary);
    if (!stream) {
        error = "could not open fixture: " + path;
        return false;
    }

    bytes.assign(std::istreambuf_iterator<char>(stream), std::istreambuf_iterator<char>());
    if (stream.bad()) {
        error = "could not read fixture: " + path;
        return false;
    }
    return true;
}

[[nodiscard]] bool execute_plan(Plan &plan) {
    HandleScope handles;

    vs_browser_status status = vs_browser_core_create(&handles.core.slot, &handles.core.generation);
    if (!expect_status("core create", status, VS_BROWSER_STATUS_OK, nullptr) || !handles.core.valid()) {
        return false;
    }

    std::map<int64_t, Token> node_by_id;

    for (PlanOperation &operation : plan.operations) {
        std::vector<vs_browser_argument> descriptors;
        descriptors.reserve(operation.arguments.size());

        for (PlanArgument &argument : operation.arguments) {
            if (argument.kind == VS_BROWSER_ARGUMENT_NODE) {
                for (Token &reference : argument.nodes) {
                    const auto found = node_by_id.find(static_cast<int64_t>(reference.slot));
                    if (found == node_by_id.end()) {
                        std::fprintf(
                            stderr,
                            "operation %lld references unknown node operation %u\n",
                            static_cast<long long>(operation.id),
                            reference.slot);
                        return false;
                    }
                    reference = found->second;
                }
            }

            std::string pack_error;
            if (!pack_argument(argument, pack_error)) {
                std::fprintf(stderr, "%s\n", pack_error.c_str());
                return false;
            }

            vs_browser_argument descriptor{};
            descriptor.key = reinterpret_cast<const uint8_t *>(argument.key.data());
            descriptor.key_length = static_cast<uint32_t>(argument.key.size());
            descriptor.kind = argument.kind;
            descriptor.values = argument.storage.data();
            switch (argument.kind) {
            case VS_BROWSER_ARGUMENT_INT:
                descriptor.value_count = static_cast<uint32_t>(argument.ints.size());
                break;
            case VS_BROWSER_ARGUMENT_FLOAT:
                descriptor.value_count = static_cast<uint32_t>(argument.floats.size());
                break;
            case VS_BROWSER_ARGUMENT_DATA:
                descriptor.value_count = static_cast<uint32_t>(argument.data.size());
                break;
            case VS_BROWSER_ARGUMENT_NODE:
                descriptor.value_count = static_cast<uint32_t>(argument.nodes.size());
                break;
            default:
                std::fprintf(stderr, "internal error: unhandled argument kind\n");
                return false;
            }
            descriptors.push_back(descriptor);
        }

        const std::string result_key = "clip";
        std::array<char, 1024> error_text{};
        Token node;
        status = vs_browser_core_invoke(
            handles.core.slot,
            handles.core.generation,
            reinterpret_cast<const uint8_t *>(operation.namespace_name.data()),
            static_cast<uint32_t>(operation.namespace_name.size()),
            reinterpret_cast<const uint8_t *>(operation.function.data()),
            static_cast<uint32_t>(operation.function.size()),
            descriptors.data(),
            static_cast<uint32_t>(descriptors.size()),
            reinterpret_cast<const uint8_t *>(result_key.data()),
            static_cast<uint32_t>(result_key.size()),
            0,
            error_text.data(),
            static_cast<uint32_t>(error_text.size()),
            &node.slot,
            &node.generation);

        if (status == VS_BROWSER_STATUS_OK) {
            std::printf(
                "operation %lld %s.%s: OK\n",
                static_cast<long long>(operation.id),
                operation.namespace_name.c_str(),
                operation.function.c_str());
            node_by_id.emplace(operation.id, node);
            handles.nodes.push_back(node);
        } else {
            std::printf(
                "operation %lld %s.%s: FAILED status=%d error=%s\n",
                static_cast<long long>(operation.id),
                operation.namespace_name.c_str(),
                operation.function.c_str(),
                status,
                error_text[0] != '\0' ? error_text.data() : "(no error text)");
            return false;
        }
    }

    for (const PlanOutput &output : plan.outputs) {
        const auto found = node_by_id.find(output.node_id);
        if (found == node_by_id.end()) {
            std::fprintf(
                stderr,
                "output %lld references unknown node operation %lld\n",
                static_cast<long long>(output.index),
                static_cast<long long>(output.node_id));
            return false;
        }

        Token frame;
        status = vs_browser_node_get_frame(found->second.slot, found->second.generation, 0, &frame.slot, &frame.generation);
        if (status != VS_BROWSER_STATUS_OK) {
            std::fprintf(
                stderr,
                "output %lld frame request returned %d\n",
                static_cast<long long>(output.index),
                status);
            return false;
        }
        handles.frames.push_back(frame);

        uint32_t width = 0;
        uint32_t height = 0;
        status = vs_browser_frame_dimensions(frame.slot, frame.generation, &width, &height);
        if (status != VS_BROWSER_STATUS_OK) {
            std::fprintf(
                stderr,
                "output %lld dimensions returned %d\n",
                static_cast<long long>(output.index),
                status);
            return false;
        }

        uint32_t rgba_size = 0;
        status = vs_browser_frame_rgba8_size(frame.slot, frame.generation, &rgba_size);
        if (status != VS_BROWSER_STATUS_OK) {
            std::fprintf(
                stderr,
                "output %lld rgba8 size returned %d\n",
                static_cast<long long>(output.index),
                status);
            return false;
        }

        std::vector<uint8_t> rgba(static_cast<size_t>(rgba_size));
        status = vs_browser_frame_copy_rgba8(frame.slot, frame.generation, rgba.data(), rgba_size);
        if (status != VS_BROWSER_STATUS_OK) {
            std::fprintf(
                stderr,
                "output %lld rgba8 copy returned %d\n",
                static_cast<long long>(output.index),
                status);
            return false;
        }

        if (output.expected.empty()) {
            std::printf(
                "output %lld: %ux%u rgba8=%u status=OK (no expected fixture named)\n",
                static_cast<long long>(output.index),
                width,
                height,
                rgba_size);
            continue;
        }

        std::vector<uint8_t> expected;
        std::string read_error;
        if (!read_file(output.expected, expected, read_error)) {
            std::fprintf(stderr, "%s\n", read_error.c_str());
            return false;
        }

        if (expected.size() != rgba.size()) {
            std::fprintf(
                stderr,
                "output %lld size mismatch: produced %zu bytes, fixture %s has %zu\n",
                static_cast<long long>(output.index),
                rgba.size(),
                output.expected.c_str(),
                expected.size());
            return false;
        }

        size_t first_difference = SIZE_MAX;
        for (size_t index = 0; index < rgba.size(); ++index) {
            if (rgba[index] != expected[index]) {
                first_difference = index;
                break;
            }
        }

        if (first_difference == SIZE_MAX) {
            std::printf(
                "output %lld: %ux%u rgba8=%u byte-exact MATCH\n",
                static_cast<long long>(output.index),
                width,
                height,
                rgba_size);
        } else {
            std::fprintf(
                stderr,
                "output %lld: %ux%u rgba8=%u MISMATCH at byte %zu (produced %u, fixture %u)\n",
                static_cast<long long>(output.index),
                width,
                height,
                rgba_size,
                first_difference,
                rgba[first_difference],
                expected[first_difference]);
            return false;
        }
    }

    return true;
}

} // namespace

int main(int argc, char **argv) {
    if (argc < 2) {
        std::fprintf(stderr, "usage: %s <plan.json>\n", argv[0]);
        return 64;
    }

    const std::string plan_path = argv[1];
    const size_t slash = plan_path.find_last_of('/');
    const std::string plan_directory = slash == std::string::npos ? std::string() : plan_path.substr(0, slash);

    Json root;
    std::string error;
    if (!parse_plan_file(plan_path, root, error)) {
        std::fprintf(stderr, "%s\n", error.c_str());
        return 65;
    }

    Plan plan;
    if (!parse_plan(root, plan_directory, plan, error)) {
        std::fprintf(stderr, "%s\n", error.c_str());
        return 66;
    }

    if (vs_browser_handle_abi_version() != VS_BROWSER_HANDLE_ABI_VERSION) {
        std::fprintf(stderr, "browser handle ABI version mismatch\n");
        return 67;
    }

    std::printf(
        "plan %s: %zu operation(s), %zu output(s)\n",
        plan_path.c_str(),
        plan.operations.size(),
        plan.outputs.size());
    if (!execute_plan(plan)) {
        std::fprintf(stderr, "plan %s failed\n", plan_path.c_str());
        return 1;
    }

    std::printf("plan %s passed\n", plan_path.c_str());
    return 0;
}
