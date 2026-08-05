"""Contract tests for the Pyodide-installed vapoursynth Python module."""

from __future__ import annotations

import importlib.util
import pathlib
import sys
import unittest


MODULE_PATH = pathlib.Path(__file__).with_name("vapoursynth.py")


class FakeRpc:
    def __init__(self) -> None:
        self.calls: list[tuple[object, ...]] = []
        self.next_node_id = 1

    async def create_blank_clip(self, width: int, height: int, format_name: str, length: int) -> int:
        self.calls.append(("create_blank_clip", width, height, format_name, length))
        return self._allocate_node_id()

    async def invert(self, node_id: int) -> int:
        self.calls.append(("invert", node_id))
        return self._allocate_node_id()

    async def set_output(self, index: int, node_id: int) -> None:
        self.calls.append(("set_output", index, node_id))

    async def release_node(self, node_id: int) -> None:
        self.calls.append(("release_node", node_id))

    def release_node_later(self, node_id: int) -> None:
        self.calls.append(("release_node_later", node_id))

    def _allocate_node_id(self) -> int:
        node_id = self.next_node_id
        self.next_node_id += 1
        return node_id


class VapourSynthModuleTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self.rpc = FakeRpc()
        self.previous_rpc = sys.modules.get("_vapoursynth_rpc")
        self.previous_vs = sys.modules.get("vapoursynth")
        sys.modules["_vapoursynth_rpc"] = self.rpc  # type: ignore[assignment]
        sys.modules.pop("vapoursynth", None)

        spec = importlib.util.spec_from_file_location("vapoursynth", MODULE_PATH)
        assert spec is not None
        assert spec.loader is not None
        self.vs = importlib.util.module_from_spec(spec)
        sys.modules["vapoursynth"] = self.vs
        spec.loader.exec_module(self.vs)

    def tearDown(self) -> None:
        if self.previous_rpc is None:
            sys.modules.pop("_vapoursynth_rpc", None)
        else:
            sys.modules["_vapoursynth_rpc"] = self.previous_rpc

        if self.previous_vs is None:
            sys.modules.pop("vapoursynth", None)
        else:
            sys.modules["vapoursynth"] = self.previous_vs

    async def test_builds_and_exports_the_supported_graph(self) -> None:
        blank = await self.vs.core.std.BlankClip(width=3, height=2)
        inverted = await self.vs.core.std.Invert(blank)
        await self.vs.set_output(0, inverted)

        self.assertIs(blank.__class__, self.vs.VideoNode)
        self.assertEqual(repr(inverted), "VideoNode(opaque)")
        self.assertEqual(
            self.rpc.calls,
            [
                ("create_blank_clip", 3, 2, "RGB24", 1),
                ("invert", 1),
                ("set_output", 0, 2),
            ],
        )

    async def test_releases_public_tokens_explicitly(self) -> None:
        node = await self.vs.core.std.BlankClip(width=1, height=1)
        await node.close()

        self.assertEqual(self.rpc.calls[-1], ("release_node", 1))
        with self.assertRaisesRegex(self.vs.Error, "already been released"):
            await node.close()

    async def test_rejects_unsupported_apis_before_the_rpc_boundary(self) -> None:
        with self.assertRaisesRegex(self.vs.UnsupportedApiError, "format"):
            await self.vs.core.std.BlankClip(format=self.vs.VideoFormat("YUV420P8", self.vs.RGB, self.vs.INTEGER, 8, 3))
        with self.assertRaisesRegex(self.vs.UnsupportedApiError, "core.resize"):
            _ = self.vs.core.resize
        with self.assertRaisesRegex(self.vs.UnsupportedApiError, "core.std.Trim"):
            _ = self.vs.core.std.Trim
        with self.assertRaisesRegex(self.vs.UnsupportedApiError, "vapoursynth.YUV420P8"):
            _ = self.vs.YUV420P8

        self.assertEqual(self.rpc.calls, [])
