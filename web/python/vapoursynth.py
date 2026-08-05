"""Deliberately small VapourSynth authoring API for the browser runtime.

The module runs inside a Pyodide worker. Every graph operation crosses an
asynchronous RPC boundary to the worker that owns the Emscripten VapourSynth
module. ``VideoNode`` instances therefore contain only opaque worker tokens;
they never contain frame buffers or native pointers.

Only ``RGB24``, ``core.std.BlankClip``, ``core.std.Invert``, and
``set_output`` are supported by the current browser runtime. All other API
paths fail explicitly instead of silently approximating desktop VapourSynth.
"""

from __future__ import annotations

import _vapoursynth_rpc as _rpc

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
    """An opaque graph token owned by the VapourSynth worker."""

    __slots__ = ("_node_id", "_released")

    def __init__(self, node_id: int) -> None:
        _require_node_id(node_id)
        self._node_id = node_id
        self._released = False

    async def close(self) -> None:
        """Release this public node token before worker shutdown if desired."""

        self._require_open()
        await _rpc.release_node(self._node_id)
        self._released = True

    async def __aenter__(self) -> VideoNode:
        self._require_open()
        return self

    async def __aexit__(self, _exc_type: object, _exc_value: object, _traceback: object) -> bool:
        await self.close()
        return False

    def __repr__(self) -> str:
        state = "released" if self._released else "opaque"
        return f"VideoNode({state})"

    def __getattr__(self, name: str) -> object:
        raise UnsupportedApiError(f"VideoNode.{name} is unsupported in the browser VapourSynth API")

    def __del__(self) -> None:
        if getattr(self, "_released", True):
            return

        self._released = True
        try:
            _rpc.release_node_later(self._node_id)
        except BaseException:
            # Finalizers are best-effort only. Worker shutdown and graph reset
            # reclaim all remaining state even when Python collection is late.
            pass

    def _require_open(self) -> None:
        if self._released:
            raise Error("VideoNode has already been released")


class _StdNamespace:
    async def BlankClip(
        self,
        clip: VideoNode | None = None,
        *,
        width: int = 640,
        height: int = 480,
        format: VideoFormat = RGB24,
        length: int = 1,
    ) -> VideoNode:
        """Create a one-frame RGB24 blank clip through worker RPC."""

        if clip is not None:
            raise UnsupportedApiError("core.std.BlankClip(clip=...) is unsupported in the browser runtime")
        _require_dimension(width, "width")
        _require_dimension(height, "height")
        _require_rgb24(format)
        if length != 1:
            raise UnsupportedApiError("core.std.BlankClip supports only length=1 in the browser runtime")

        node_id = await _rpc.create_blank_clip(width, height, format.name, length)
        return VideoNode(node_id)

    async def Invert(self, clip: VideoNode, *, planes: object = None) -> VideoNode:
        """Invert a browser ``BlankClip`` through worker RPC."""

        _require_video_node(clip)
        clip._require_open()
        if planes is not None:
            raise UnsupportedApiError("core.std.Invert(planes=...) is unsupported in the browser runtime")

        node_id = await _rpc.invert(clip._node_id)
        return VideoNode(node_id)

    def __getattr__(self, name: str) -> object:
        raise UnsupportedApiError(f"core.std.{name} is unsupported in the browser VapourSynth API")


class Core:
    """The browser subset of the standard VapourSynth core."""

    __slots__ = ("std",)

    def __init__(self) -> None:
        self.std = _StdNamespace()

    def __getattr__(self, name: str) -> object:
        raise UnsupportedApiError(f"core.{name} is unsupported in the browser VapourSynth API")


core = Core()


async def set_output(index: int, clip: VideoNode) -> None:
    """Register a graph output by index through worker RPC."""

    _require_output_index(index)
    _require_video_node(clip)
    clip._require_open()
    await _rpc.set_output(index, clip._node_id)


def __getattr__(name: str) -> object:
    raise UnsupportedApiError(f"vapoursynth.{name} is unsupported in the browser VapourSynth API")


def _require_dimension(value: object, name: str) -> None:
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0 or value > 0xFFFF_FFFF:
        raise TypeError(f"{name} must be a non-zero u32")


def _require_rgb24(value: object) -> None:
    if value is not RGB24:
        if isinstance(value, VideoFormat):
            raise UnsupportedApiError(f"format {value.name} is unsupported in the browser runtime")
        raise TypeError("format must be vapoursynth.RGB24")


def _require_node_id(value: object) -> None:
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0 or value > 0xFFFF_FFFF:
        raise TypeError("worker returned an invalid opaque VideoNode token")


def _require_video_node(value: object) -> None:
    if not isinstance(value, VideoNode):
        raise TypeError("clip must be a vapoursynth.VideoNode")


def _require_output_index(value: object) -> None:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0 or value > 0xFFFF_FFFF:
        raise TypeError("output index must be a u32")
