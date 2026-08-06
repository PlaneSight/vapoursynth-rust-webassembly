"""Deliberately small VapourSynth authoring API for the browser runtime.

The module runs inside a Pyodide worker. Every ``vs.core.<namespace>.<function>
(...)`` call records one operation into a synchronous in-process graph plan;
``VideoNode.set_output(index)`` records a graph output. Nothing crosses an RPC
boundary while the script runs. After the script finishes, the host drains the
plan JSON with ``vapoursynth._drain_plan()`` and executes it as one generic
worker graph request.

``VideoNode`` instances are therefore local plan references (operation ids),
never native pointers or worker tokens. Only ``RGB24`` is a supported
``VideoFormat``; it serializes as its native pixel format id. All other API
paths fail explicitly instead of silently approximating desktop VapourSynth.
"""

from __future__ import annotations

import json as _json

__all__ = [
    "Error",
    "UnsupportedApiError",
    "VideoNode",
    "VideoFormat",
    "RGB",
    "INTEGER",
    "RGB24",
    "core",
    "set_output",
]

_PLAN_VERSION = 1
_MAX_OPERATIONS = 64
_MAX_OUTPUTS = 16
_MAX_ARGUMENTS = 64
_MAX_ARRAY_VALUES = 4096
_MAX_NAME_LENGTH = 64
_MAX_DATA_LENGTH = 65_536
_U32_MAX = 0xFFFF_FFFF
# Number.isSafeInteger range: the JSON plan and the worker both represent
# integers with JavaScript numbers, so authoring rejects anything wider.
_INT_MIN = -(2**53) + 1
_INT_MAX = 2**53 - 1

# Native VapourSynth preset pixel format identifiers (legacy VapourSynth.h:
# pfRGB24 = cmRGB + 10, where cmRGB = 2000000).
_FORMAT_IDS = {"RGB24": 2_000_010}

_plan = {"version": _PLAN_VERSION, "operations": [], "outputs": []}
_next_op_id = 1
_plan_generation = 1


class Error(RuntimeError):
    """Base exception raised by the browser VapourSynth subset."""


class UnsupportedApiError(Error):
    """Raised when a desktop VapourSynth API is absent from this build."""


class _EnumValue:
    __slots__ = ("name",)

    def __init__(self, name: str) -> None:
        self.name = name

    def __repr__(self) -> str:
        return f"vapoursynth.{self.name}"


class VideoFormat:
    """A named preset format supported by the browser graph runtime."""

    __slots__ = ("name", "color_family", "sample_type", "bits_per_sample", "num_planes")

    def __init__(
        self,
        name: str,
        color_family: _EnumValue,
        sample_type: _EnumValue,
        bits_per_sample: int,
        num_planes: int,
    ) -> None:
        self.name = name
        self.color_family = color_family
        self.sample_type = sample_type
        self.bits_per_sample = bits_per_sample
        self.num_planes = num_planes

    def __repr__(self) -> str:
        return f"vapoursynth.{self.name}"


RGB = _EnumValue("RGB")
INTEGER = _EnumValue("INTEGER")
RGB24 = VideoFormat("RGB24", RGB, INTEGER, 8, 3)


class VideoNode:
    """A local graph reference owned by the current plan.

    The node names one recorded operation and is valid only until the plan is
    drained or reset; referencing a stale or released node is an error.
    """

    __slots__ = ("_op_id", "_plan_generation", "_released")

    def __init__(self, op_id: int) -> None:
        self._op_id = op_id
        self._plan_generation = _plan_generation
        self._released = False

    def set_output(self, index: int = 0) -> None:
        """Register this node as a graph output by index (synchronous)."""

        self._require_open()
        _require_output_index(index)
        for output in _plan["outputs"]:
            if output["index"] == index:
                raise Error(f"output index {index} is already registered")
        _plan["outputs"].append({"index": index, "node": self._op_id})
        if len(_plan["outputs"]) > _MAX_OUTPUTS:
            _plan["outputs"].pop()
            raise Error(f"a graph plan may register at most {_MAX_OUTPUTS} outputs")

    def close(self) -> None:
        """Mark this local node reference as released.

        Releasing is local to the authoring process; the recorded operation
        remains part of the plan. A released node rejects every further use.
        """

        self._require_open()
        self._released = True

    def __repr__(self) -> str:
        state = "released" if self._released else "opaque"
        return f"VideoNode({state})"

    def __getattr__(self, name: str) -> object:
        raise UnsupportedApiError(f"VideoNode.{name} is unsupported in the browser VapourSynth API")

    def _require_open(self) -> None:
        if self._released:
            raise Error("VideoNode has already been released")
        if self._plan_generation != _plan_generation:
            raise Error("VideoNode belongs to a previous graph plan (the plan was reset or drained)")


class _Function:
    __slots__ = ("_namespace", "_function")

    def __init__(self, namespace: str, function: str) -> None:
        self._namespace = namespace
        self._function = function

    def __call__(self, *args: object, **kwargs: object) -> VideoNode:
        arguments: list[dict[str, object]] = []
        if args:
            if len(args) == 1 and isinstance(args[0], VideoNode):
                arguments.append(_serialize_argument("clip", args[0]))
            elif len(args) >= 2 and all(isinstance(value, VideoNode) for value in args):
                arguments.append(
                    {
                        "key": "clips",
                        "kind": "nodeArray",
                        "value": [_serialize_node(value) for value in args],
                    }
                )
            else:
                raise TypeError(
                    "positional arguments are supported only as a single clip "
                    "or a sequence of clips"
                )
        if len(arguments) + len(kwargs) > _MAX_ARGUMENTS:
            raise Error(f"an operation may take at most {_MAX_ARGUMENTS} arguments")
        for key, value in kwargs.items():
            arguments.append(_serialize_argument(key, value))
        return VideoNode(_record_operation(self._namespace, self._function, arguments))

    def __repr__(self) -> str:
        return f"<vapoursynth function {self._namespace}.{self._function}>"


class _Namespace:
    __slots__ = ("_namespace",)

    def __init__(self, namespace: str) -> None:
        self._namespace = namespace

    def __getattr__(self, function: str) -> _Function:
        if function.startswith("_"):
            raise AttributeError(f"vapoursynth namespace has no attribute {function!r}")
        return _Function(self._namespace, function)

    def __repr__(self) -> str:
        return f"<vapoursynth namespace {self._namespace!r}>"


class Core:
    """The browser subset of the standard VapourSynth core."""

    __slots__ = ()

    def __getattr__(self, namespace: str) -> _Namespace:
        if namespace.startswith("_"):
            raise AttributeError(f"vapoursynth core has no attribute {namespace!r}")
        return _Namespace(namespace)


core = Core()


def set_output(index: int, clip: VideoNode) -> None:
    """Register a graph output by index (synchronous desktop compatibility)."""

    clip.set_output(index)


def __getattr__(name: str) -> object:
    raise UnsupportedApiError(f"vapoursynth.{name} is unsupported in the browser VapourSynth API")


def _reset_plan() -> None:
    """Clear the recorded plan and invalidate every outstanding VideoNode."""

    global _next_op_id, _plan_generation
    _plan["operations"].clear()
    _plan["outputs"].clear()
    _next_op_id = 1
    _plan_generation += 1


def _drain_plan() -> str:
    """Return the recorded plan as JSON and reset the authoring state."""

    plan_json = _json.dumps(_plan, separators=(",", ":"))
    _reset_plan()
    return plan_json


def _record_operation(namespace: str, function: str, arguments: list[dict[str, object]]) -> int:
    global _next_op_id
    _require_name(namespace, "namespace")
    _require_name(function, "function")
    if len(_plan["operations"]) >= _MAX_OPERATIONS:
        raise Error(f"a graph plan may record at most {_MAX_OPERATIONS} operations")

    op_id = _next_op_id
    _next_op_id += 1
    if _next_op_id > _U32_MAX:
        raise Error("the graph plan operation id space is exhausted")
    _plan["operations"].append(
        {
            "id": op_id,
            "namespace": namespace,
            "function": function,
            "arguments": arguments,
        }
    )
    return op_id


def _serialize_argument(key: str, value: object) -> dict[str, object]:
    _require_name(key, "argument key")
    if isinstance(value, VideoNode):
        return {"key": key, "kind": "node", "value": _serialize_node(value)}
    if isinstance(value, VideoFormat):
        return {"key": key, "kind": "int", "value": _serialize_format(value)}
    if isinstance(value, bool):
        raise TypeError(f"argument {key!r} must not be a bool; pass an int, float, str, list, or VideoNode")
    if isinstance(value, int):
        _require_safe_int(value, key)
        return {"key": key, "kind": "int", "value": value}
    if isinstance(value, float):
        if not _finite_float(value):
            raise TypeError(f"argument {key!r} must be a finite float")
        return {"key": key, "kind": "float", "value": value}
    if isinstance(value, str):
        if not value:
            raise TypeError(f"argument {key!r} must be a non-empty string")
        if len(value) > _MAX_DATA_LENGTH:
            raise Error(f"argument {key!r} is longer than {_MAX_DATA_LENGTH} bytes")
        return {"key": key, "kind": "data", "value": value}
    if isinstance(value, list):
        return {"key": key, "kind": _serialize_list_kind(key, value), "value": _serialize_list(key, value)}
    raise TypeError(
        f"argument {key!r} has unsupported type {type(value).__name__}; "
        "pass an int, float, str, list, VideoFormat, or VideoNode"
    )


def _serialize_node(value: VideoNode) -> int:
    value._require_open()
    return value._op_id


def _serialize_format(value: VideoFormat) -> int:
    format_id = _FORMAT_IDS.get(value.name)
    if format_id is None:
        raise UnsupportedApiError(f"format {value.name} is unsupported in the browser runtime")
    return format_id


def _serialize_list_kind(key: str, value: list[object]) -> str:
    if not value:
        raise TypeError(f"argument {key!r} must be a non-empty list")
    if all(isinstance(item, VideoNode) for item in value):
        return "nodeArray"
    if all(isinstance(item, bool) is False and isinstance(item, int) for item in value):
        return "intArray"
    if all(isinstance(item, bool) is False and isinstance(item, (int, float)) for item in value):
        return "floatArray"
    raise TypeError(
        f"argument {key!r} must be a homogeneous list of ints, floats, or VideoNodes"
    )


def _serialize_list(key: str, value: list[object]) -> object:
    if len(value) > _MAX_ARRAY_VALUES:
        raise Error(f"argument {key!r} has more than {_MAX_ARRAY_VALUES} values")
    kind = _serialize_list_kind(key, value)
    if kind == "nodeArray":
        return [_serialize_node(item) for item in value]
    if kind == "intArray":
        for item in value:
            _require_safe_int(item, key)
        return list(value)
    for item in value:
        number = float(item)
        if not _finite_float(number):
            raise TypeError(f"argument {key!r} must contain only finite floats")
    return [float(item) for item in value]


def _require_name(value: str, name: str) -> None:
    if not isinstance(value, str) or not value or len(value) > _MAX_NAME_LENGTH:
        raise Error(f"{name} must be a non-empty string no longer than {_MAX_NAME_LENGTH} characters")


def _require_safe_int(value: int, name: str) -> None:
    if value < _INT_MIN or value > _INT_MAX:
        raise TypeError(f"{name} must be an integer between {_INT_MIN} and {_INT_MAX}")


def _finite_float(value: float) -> bool:
    return value == value and value not in (float("inf"), float("-inf"))


def _require_output_index(value: object) -> None:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0 or value > _U32_MAX:
        raise TypeError("output index must be a u32")
