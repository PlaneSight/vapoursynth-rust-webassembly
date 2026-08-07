"""Contract tests for the Pyodide-installed vapoursynth Python module.

The module records a synchronous graph plan locally and drains it as JSON;
nothing crosses an RPC boundary during authoring.
"""

from __future__ import annotations

import importlib.util
import json
import pathlib
import sys
import unittest


MODULE_PATH = pathlib.Path(__file__).with_name("vapoursynth.py")
RGB24_FORMAT_ID = 537_395_200


class VapourSynthModuleTest(unittest.TestCase):
    def setUp(self) -> None:
        self.previous_vs = sys.modules.get("vapoursynth")
        sys.modules.pop("vapoursynth", None)

        spec = importlib.util.spec_from_file_location("vapoursynth", MODULE_PATH)
        assert spec is not None
        assert spec.loader is not None
        self.vs = importlib.util.module_from_spec(spec)
        sys.modules["vapoursynth"] = self.vs
        spec.loader.exec_module(self.vs)

    def tearDown(self) -> None:
        if self.previous_vs is None:
            sys.modules.pop("vapoursynth", None)
        else:
            sys.modules["vapoursynth"] = self.previous_vs

    def drain(self) -> dict[str, object]:
        return json.loads(self.vs._drain_plan())

    def test_builds_and_exports_the_supported_graph(self) -> None:
        blank = self.vs.core.std.BlankClip(width=3, height=2)
        inverted = self.vs.core.std.Invert(blank)
        inverted.set_output(0)

        self.assertIs(blank.__class__, self.vs.VideoNode)
        self.assertEqual(repr(inverted), "VideoNode(opaque)")
        self.assertEqual(
            self.drain(),
            {
                "version": 1,
                "operations": [
                    {
                        "id": 1,
                        "namespace": "std",
                        "function": "BlankClip",
                        "arguments": [
                            {"key": "width", "kind": "int", "value": 3},
                            {"key": "height", "kind": "int", "value": 2},
                        ],
                    },
                    {
                        "id": 2,
                        "namespace": "std",
                        "function": "Invert",
                        "arguments": [{"key": "clip", "kind": "node", "value": 1}],
                    },
                ],
                "outputs": [{"index": 0, "node": 2}],
            },
        )

    def test_default_app_script_path_with_color_inversion(self) -> None:
        clip = self.vs.core.std.BlankClip(
            width=320, height=180, format=self.vs.RGB24, color=[32, 96, 224]
        )
        clip = self.vs.core.std.Invert(clip)
        clip.set_output()

        plan = self.drain()
        blank = plan["operations"][0]
        self.assertEqual(blank["namespace"], "std")
        self.assertEqual(blank["function"], "BlankClip")
        self.assertEqual(
            blank["arguments"],
            [
                {"key": "width", "kind": "int", "value": 320},
                {"key": "height", "kind": "int", "value": 180},
                {"key": "format", "kind": "int", "value": RGB24_FORMAT_ID},
                {"key": "color", "kind": "intArray", "value": [32, 96, 224]},
            ],
        )
        self.assertEqual(
            plan["operations"][1],
            {
                "id": 2,
                "namespace": "std",
                "function": "Invert",
                "arguments": [{"key": "clip", "kind": "node", "value": 1}],
            },
        )
        self.assertEqual(plan["outputs"], [{"index": 0, "node": 2}])

    def test_module_set_output_is_synchronous_compatibility(self) -> None:
        node = self.vs.core.std.BlankClip(width=1, height=1)
        self.assertIsNone(self.vs.set_output(0, node))

        self.assertEqual(self.drain()["outputs"], [{"index": 0, "node": 1}])

    def test_positional_single_node_maps_to_clip_and_sequence_to_clips(self) -> None:
        first = self.vs.core.std.BlankClip(width=1, height=1)
        second = self.vs.core.std.BlankClip(width=1, height=1)
        result = self.vs.core.std.Splice(first, second)
        result.set_output()

        operations = self.drain()["operations"]
        self.assertEqual(
            operations[-1],
            {
                "id": 3,
                "namespace": "std",
                "function": "Splice",
                "arguments": [{"key": "clips", "kind": "nodeArray", "value": [1, 2]}],
            },
        )

        node = self.vs.core.std.BlankClip(width=1, height=1)
        inverted = self.vs.core.std.Invert(node)
        self.assertEqual(
            self.drain()["operations"][-1]["arguments"],
            [{"key": "clip", "kind": "node", "value": 1}],
        )

    def test_rejects_positional_non_node_arguments(self) -> None:
        with self.assertRaisesRegex(TypeError, "positional arguments"):
            self.vs.core.std.BlankClip(320)

    def test_serializes_typed_arrays_and_data(self) -> None:
        node = self.vs.core.std.BlankClip(width=1, height=1)
        self.vs.core.std.Expr(node, expr="x 2 *", format=self.vs.RGB24)

        operation = self.drain()["operations"][-1]
        self.assertEqual(operation["function"], "Expr")
        self.assertEqual(
            operation["arguments"],
            [
                {"key": "clip", "kind": "node", "value": 1},
                {"key": "expr", "kind": "data", "value": "x 2 *"},
                {"key": "format", "kind": "int", "value": RGB24_FORMAT_ID},
            ],
        )

        # Lists of strings have no wire kind and are rejected deterministically.
        fresh = self.vs.core.std.BlankClip(width=1, height=1)
        with self.assertRaisesRegex(TypeError, "homogeneous list"):
            self.vs.core.std.Expr(fresh, expr=["x 2 *", "x"])

    def test_rejects_unsupported_argument_types_before_any_worker_roundtrip(self) -> None:
        with self.assertRaisesRegex(TypeError, "unsupported type dict"):
            self.vs.core.std.BlankClip(width={})
        with self.assertRaisesRegex(TypeError, "unsupported type NoneType"):
            self.vs.core.std.BlankClip(width=None)
        with self.assertRaisesRegex(TypeError, "unsupported type bytes"):
            self.vs.core.std.BlankClip(width=b"1")
        with self.assertRaisesRegex(TypeError, "must not be a bool"):
            self.vs.core.std.BlankClip(width=True)
        with self.assertRaisesRegex(TypeError, "non-empty string"):
            self.vs.core.std.BlankClip(width="")
        with self.assertRaisesRegex(TypeError, "non-empty list"):
            self.vs.core.std.BlankClip(color=[])
        with self.assertRaisesRegex(TypeError, "homogeneous list"):
            self.vs.core.std.BlankClip(color=[32, "x"])
        with self.assertRaisesRegex(TypeError, "must be an integer between"):
            self.vs.core.std.BlankClip(width=2**53)

        self.assertEqual(self.vs._drain_plan(), '{"version":1,"operations":[],"outputs":[]}')

    def test_rejects_unsupported_formats_and_unknown_module_apis(self) -> None:
        with self.assertRaisesRegex(self.vs.UnsupportedApiError, "format YUV420P8"):
            self.vs.core.std.BlankClip(
                format=self.vs.VideoFormat("YUV420P8", self.vs.RGB, self.vs.INTEGER, 8, 3)
            )
        with self.assertRaisesRegex(self.vs.UnsupportedApiError, "vapoursynth.YUV420P8"):
            _ = self.vs.YUV420P8

        self.assertEqual(self.vs._drain_plan(), '{"version":1,"operations":[],"outputs":[]}')

    def test_stale_nodes_are_rejected_after_drain_or_reset(self) -> None:
        node = self.vs.core.std.BlankClip(width=1, height=1)
        self.drain()

        with self.assertRaisesRegex(self.vs.Error, "previous graph plan"):
            self.vs.core.std.Invert(node)
        with self.assertRaisesRegex(self.vs.Error, "previous graph plan"):
            node.set_output(0)

        node = self.vs.core.std.BlankClip(width=1, height=1)
        self.vs._reset_plan()
        with self.assertRaisesRegex(self.vs.Error, "previous graph plan"):
            node.set_output()

    def test_released_nodes_are_rejected(self) -> None:
        node = self.vs.core.std.BlankClip(width=1, height=1)
        node.close()

        with self.assertRaisesRegex(self.vs.Error, "already been released"):
            node.set_output(0)
        with self.assertRaisesRegex(self.vs.Error, "already been released"):
            self.vs.core.std.Invert(node)
        with self.assertRaisesRegex(self.vs.Error, "already been released"):
            node.close()

    def test_rejects_invalid_outputs(self) -> None:
        node = self.vs.core.std.BlankClip(width=1, height=1)
        with self.assertRaisesRegex(TypeError, "output index must be a u32"):
            node.set_output(-1)
        with self.assertRaisesRegex(TypeError, "output index must be a u32"):
            node.set_output(True)

        node.set_output(0)
        with self.assertRaisesRegex(self.vs.Error, "already registered"):
            node.set_output(0)

        other = self.vs.core.std.BlankClip(width=1, height=1)
        with self.assertRaisesRegex(self.vs.Error, "already registered"):
            other.set_output(0)

    def test_plan_limits_are_enforced_deterministically(self) -> None:
        for _ in range(64):
            self.vs.core.std.BlankClip(width=1, height=1)
        with self.assertRaisesRegex(self.vs.Error, "at most 64 operations"):
            self.vs.core.std.BlankClip(width=1, height=1)

        self.vs._reset_plan()
        node = self.vs.core.std.BlankClip(width=1, height=1)
        with self.assertRaisesRegex(self.vs.Error, "at most 64 arguments"):
            self.vs.core.std.BlankClip(width=1, height=1, **{f"key{i}": i for i in range(64)})
        with self.assertRaisesRegex(self.vs.Error, "more than 4096 values"):
            self.vs.core.std.BlankClip(width=1, height=1, color=list(range(4097)))

        self.vs._reset_plan()
        node = self.vs.core.std.BlankClip(width=1, height=1)
        for index in range(16):
            node.set_output(index)
        with self.assertRaisesRegex(self.vs.Error, "at most 16 outputs"):
            node.set_output(16)

    def test_rejects_unsupported_apis_consistently(self) -> None:
        with self.assertRaisesRegex(self.vs.UnsupportedApiError, "VideoNode.width"):
            _ = self.vs.core.std.BlankClip(width=1, height=1).width
        with self.assertRaises(AttributeError):
            _ = self.vs.core._private_namespace
        with self.assertRaises(AttributeError):
            _ = self.vs.core.std._private_function

        # Dynamic namespaces/functions are callable without raising at lookup.
        self.assertIsInstance(self.vs.core.resize, self.vs._Namespace)
        self.assertIsInstance(self.vs.core.std.Trim, self.vs._Function)

        self.vs._reset_plan()
        self.assertEqual(self.vs._drain_plan(), '{"version":1,"operations":[],"outputs":[]}')
