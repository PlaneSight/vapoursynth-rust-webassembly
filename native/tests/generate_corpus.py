#!/usr/bin/env python3
"""Generate and verify the pinned native-VS conformance corpus.

Plans are authored here; output bytes and failure messages are produced only by
the native runner. The legacy plan declarations below pass an ignored third
argument to ``emit`` so the operation corpus remains readable without keeping
a second, hand-modeled renderer.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import tomllib

OUT = Path(__file__).resolve().parent / "vectors"
FORMAT_RGB24 = 537395200
R, G, B = 32, 96, 224


def _discarded_golden(*_args):
    return [0] * 256


flat = framed = transpose = stackh = stackv = levels_lut = _discarded_golden


def plan(operations, fixture_name):
    return {
        "version": 1,
        "operations": [
            {"id": i + 1, "namespace": "std", "function": fn, "arguments": args}
            for i, (fn, args) in enumerate(operations)
        ],
        "outputs": [
            {"index": 0, "node": len(operations), "expected": f"{fixture_name}.rgba.bin"}
        ],
    }


def emit(name, operations, _ignored_golden):
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / f"{name}.plan.json").write_text(
        json.dumps(plan(operations, name), indent=2) + "\n",
        encoding="utf-8",
    )




def generate_plans(destination):
    global OUT
    OUT = Path(destination)
    blank_a = [("BlankClip", [
        {"key": "width", "kind": "int", "value": 320},
        {"key": "height", "kind": "int", "value": 180},
        {"key": "format", "kind": "int", "value": FORMAT_RGB24},
        {"key": "length", "kind": "int", "value": 1},
        {"key": "color", "kind": "floatArray", "value": [float(R), float(G), float(B)]},
    ])]
    blank_c = [("BlankClip", [
        {"key": "width", "kind": "int", "value": 320},
        {"key": "height", "kind": "int", "value": 180},
        {"key": "format", "kind": "int", "value": FORMAT_RGB24},
        {"key": "length", "kind": "int", "value": 1},
        {"key": "color", "kind": "floatArray", "value": [224.0, 32.0, 96.0]},
    ])]

    # 1. BlankClip flat fill.
    emit("blankclip-color", blank_a, flat(320, 180, (R, G, B)))

    # 2. Invert.
    emit("invert-color", blank_a + [("Invert", [{"key": "clip", "kind": "node", "value": 1}])],
         flat(320, 180, (255 - R, 255 - G, 255 - B)))

    # 3. Crop to the inner rectangle.
    emit("crop-color", blank_a + [("Crop", [
        {"key": "clip", "kind": "node", "value": 1},
        {"key": "left", "kind": "int", "value": 40},
        {"key": "right", "kind": "int", "value": 40},
        {"key": "top", "kind": "int", "value": 30},
        {"key": "bottom", "kind": "int", "value": 30},
    ])], flat(240, 120, (R, G, B)))

    # 4. Asymmetric AddBorders: 330x194, margins l7 r3 t5 b9 black.
    bordered = framed(320, 180, (R, G, B), 7, 3, 5, 9)
    emit("addborders-asym", blank_a + [("AddBorders", [
        {"key": "clip", "kind": "node", "value": 1},
        {"key": "left", "kind": "int", "value": 7},
        {"key": "right", "kind": "int", "value": 3},
        {"key": "top", "kind": "int", "value": 5},
        {"key": "bottom", "kind": "int", "value": 9},
        {"key": "color", "kind": "floatArray", "value": [0.0, 0.0, 0.0]},
    ])], bordered)

    # 5-7. Flips and Turn180 mirror the asymmetric margins.
    emit("fliph-asym", blank_a + [
        ("AddBorders", [
            {"key": "clip", "kind": "node", "value": 1},
            {"key": "left", "kind": "int", "value": 7},
            {"key": "right", "kind": "int", "value": 3},
            {"key": "top", "kind": "int", "value": 5},
            {"key": "bottom", "kind": "int", "value": 9},
            {"key": "color", "kind": "floatArray", "value": [0.0, 0.0, 0.0]},
        ]),
        ("FlipHorizontal", [{"key": "clip", "kind": "node", "value": 2}]),
    ], framed(320, 180, (R, G, B), 3, 7, 5, 9))

    emit("flipv-asym", blank_a + [
        ("AddBorders", [
            {"key": "clip", "kind": "node", "value": 1},
            {"key": "left", "kind": "int", "value": 7},
            {"key": "right", "kind": "int", "value": 3},
            {"key": "top", "kind": "int", "value": 5},
            {"key": "bottom", "kind": "int", "value": 9},
            {"key": "color", "kind": "floatArray", "value": [0.0, 0.0, 0.0]},
        ]),
        ("FlipVertical", [{"key": "clip", "kind": "node", "value": 2}]),
    ], framed(320, 180, (R, G, B), 7, 3, 9, 5))

    emit("turn180-asym", blank_a + [
        ("AddBorders", [
            {"key": "clip", "kind": "node", "value": 1},
            {"key": "left", "kind": "int", "value": 7},
            {"key": "right", "kind": "int", "value": 3},
            {"key": "top", "kind": "int", "value": 5},
            {"key": "bottom", "kind": "int", "value": 9},
            {"key": "color", "kind": "floatArray", "value": [0.0, 0.0, 0.0]},
        ]),
        ("Turn180", [{"key": "clip", "kind": "node", "value": 2}]),
    ], framed(320, 180, (R, G, B), 3, 7, 9, 5))

    # 8. Transpose swaps 330x194 to 194x330 and reorients the margins.
    emit("transpose-asym", blank_a + [
        ("AddBorders", [
            {"key": "clip", "kind": "node", "value": 1},
            {"key": "left", "kind": "int", "value": 7},
            {"key": "right", "kind": "int", "value": 3},
            {"key": "top", "kind": "int", "value": 5},
            {"key": "bottom", "kind": "int", "value": 9},
            {"key": "color", "kind": "floatArray", "value": [0.0, 0.0, 0.0]},
        ]),
        ("Transpose", [{"key": "clip", "kind": "node", "value": 2}]),
    ], transpose(330, 194, bordered))

    # 9-10. Stacks of two differently colored clips.
    emit("stackh-two", blank_a + blank_c + [
        ("StackHorizontal", [{"key": "clips", "kind": "nodeArray", "value": [1, 2]}]),
    ], stackh([(320, flat(320, 180, (R, G, B))), (320, flat(320, 180, (224, 32, 96)))], 180))

    emit("stackv-two", blank_a + blank_c + [
        ("StackVertical", [{"key": "clips", "kind": "nodeArray", "value": [1, 2]}]),
    ], stackv([(320, flat(320, 180, (R, G, B))), (320, flat(320, 180, (224, 32, 96)))]))

    # 11. Lut(255-x) == Invert through the per-plane table path.
    emit("lut-invert", blank_a + [("Lut", [
        {"key": "clip", "kind": "node", "value": 1},
        {"key": "lut", "kind": "intArray", "value": list(range(255, -1, -1))},
    ])], flat(320, 180, (255 - R, 255 - G, 255 - B)))

    # 12. Expr saturating add on uint8 (scalar interpreter on wasm).
    # The native vector harness carries data arguments as byte arrays.
    emit("expr-add96", blank_a + [("Expr", [
        {"key": "clips", "kind": "nodeArray", "value": [1]},
        {"key": "expr", "kind": "data", "value": list(b"x 96 +")},
    ])], flat(320, 180, (min(R + 96, 255), min(G + 96, 255), min(B + 96, 255))))

    # 13. Levels 16..235 with gamma 1.0.
    lut = levels_lut(0.0, 255.0, 1.0, 16.0, 235.0)
    emit("levels-16-235", blank_a + [("Levels", [
        {"key": "clip", "kind": "node", "value": 1},
        {"key": "min_in", "kind": "floatArray", "value": [0.0]},
        {"key": "max_in", "kind": "floatArray", "value": [255.0]},
        {"key": "gamma", "kind": "floatArray", "value": [1.0]},
        {"key": "min_out", "kind": "floatArray", "value": [16.0]},
        {"key": "max_out", "kind": "floatArray", "value": [235.0]},
    ])], flat(320, 180, (lut[R], lut[G], lut[B])))

    # 14-16. Neighborhood statistics on a flat frame are the identity.
    for name, fn in (("median-flat", "Median"), ("minimum-flat", "Minimum"), ("maximum-flat", "Maximum")):
        emit(name, blank_a + [(fn, [
            {"key": "clip", "kind": "node", "value": 1},
            {"key": "planes", "kind": "intArray", "value": [0, 1, 2]},
        ])], flat(320, 180, (R, G, B)))

    # 17. ShufflePlanes plane passthrough with cfRGB.
    emit("shuffleplanes-rgb", blank_a + [("ShufflePlanes", [
        {"key": "clips", "kind": "nodeArray", "value": [1]},
        {"key": "planes", "kind": "intArray", "value": [0, 1, 2]},
        {"key": "colorfamily", "kind": "int", "value": 2},
    ])], flat(320, 180, (R, G, B)))


def lock_provenance():
    lock = tomllib.loads((Path(__file__).resolve().parents[2] / "third_party" / "lock.toml").read_text(encoding="utf-8"))
    dependency = lock["dependencies"]["vapoursynth"]
    return {
        "repository": dependency["remote"],
        "commit": dependency["commit"],
        "nativePatches": [],
        "browserPatches": dependency["patches"],
        "nativeMesonOptions": ["enable_x86_asm=false", "enable_arm_asm=false"],
    }


def failure_plans():
    return {
        "unknown-function": plan(
            [("DefinitelyNotAFunction", [])],
            "unknown-function",
        ),
        "invert-without-clip": plan([("Invert", [])], "invert-without-clip"),
    }


def canonical_json(value):
    return (json.dumps(value, indent=2, ensure_ascii=True) + "\n").encode("utf-8")


def run_oracle(runner, plan_path, output_dir):
    result = subprocess.run(
        [str(runner), "--oracle", str(plan_path), str(output_dir)],
        check=False,
        capture_output=True,
        text=True,
    )
    try:
        document = json.loads(result.stdout)
    except json.JSONDecodeError as error:
        raise RuntimeError(
            f"native oracle produced invalid JSON for {plan_path}: {error}; stderr={result.stderr.strip()}"
        ) from error
    return result.returncode, document


def build_artifacts(runner, workspace):
    plans_dir = workspace / "vectors"
    output_dir = workspace / "oracle"
    plans_dir.mkdir()
    output_dir.mkdir()
    generate_plans(plans_dir)
    for name, document in failure_plans().items():
        (plans_dir / f"{name}.plan.json").write_bytes(canonical_json(document))

    cases = []
    for plan_path in sorted(plans_dir.glob("*.plan.json")):
        name = plan_path.stem
        return_code, oracle = run_oracle(runner, plan_path, output_dir)
        if oracle.get("outcome") == "error":
            if return_code == 0:
                raise RuntimeError(f"native oracle accepted unexpected error for {plan_path}")
            error = oracle.get("error")
            if not isinstance(error, dict):
                raise RuntimeError(f"native oracle error envelope is malformed for {plan_path}")
            plan_document = json.loads(plan_path.read_text(encoding="utf-8"))
            plan_document["expectedFailure"] = error
            plan_path.write_bytes(canonical_json(plan_document))
            return_code, verified = run_oracle(runner, plan_path, output_dir)
            if return_code != 0 or verified != oracle:
                raise RuntimeError(f"native oracle could not reproduce expected failure for {plan_path}")
            cases.append({"name": name, "plan": plan_path.name, "outcome": "error", "error": error})
            continue
        if return_code != 0 or oracle.get("outcome") != "frame":
            raise RuntimeError(f"native oracle failed for {plan_path}: {oracle}")
        outputs = oracle.get("outputs")
        if not isinstance(outputs, list) or not outputs:
            raise RuntimeError(f"native oracle returned no outputs for {plan_path}")
        manifest_outputs = []
        for output in outputs:
            rgba_name = output.get("rgba")
            rgba_path = output_dir / rgba_name
            if not isinstance(rgba_name, str) or not rgba_path.is_file():
                raise RuntimeError(f"native oracle did not write {rgba_name} for {plan_path}")
            digest = hashlib.sha256(rgba_path.read_bytes()).hexdigest()
            shutil.copyfile(rgba_path, plans_dir / rgba_name)
            manifest_outputs.append({
                "index": output["index"],
                "format": output["format"],
                "width": output["width"],
                "height": output["height"],
                "strides": output["strides"],
                "rgba": rgba_name,
                "sha256": digest,
            })
        cases.append({"name": name, "plan": plan_path.name, "outcome": "frame", "outputs": manifest_outputs})

    manifest = {
        "schemaVersion": 1,
        "upstream": lock_provenance(),
        "cases": sorted(cases, key=lambda case: case["name"]),
    }
    (plans_dir / "conformance.json").write_bytes(canonical_json(manifest))
    return plans_dir


def compare_artifacts(generated):
    expected = {
        path.name: path.read_bytes()
        for path in generated.iterdir()
        if path.is_file() and (path.name.endswith(".plan.json") or path.name.endswith(".rgba.bin") or path.name == "conformance.json")
    }
    actual = {
        path.name: path.read_bytes()
        for path in OUT.iterdir()
        if path.is_file() and (path.name.endswith(".plan.json") or path.name.endswith(".rgba.bin") or path.name == "conformance.json")
    }
    differences = sorted(set(expected) ^ set(actual))
    differences.extend(sorted(name for name in set(expected) & set(actual) if expected[name] != actual[name]))
    if differences:
        raise RuntimeError("conformance artifacts are stale: " + ", ".join(differences))


def refresh_artifacts(generated):
    OUT.mkdir(parents=True, exist_ok=True)
    generated_names = {path.name for path in generated.iterdir() if path.is_file()}
    for path in OUT.iterdir():
        if path.is_file() and (
            path.name.endswith(".plan.json") or path.name.endswith(".rgba.bin") or path.name == "conformance.json"
        ) and path.name not in generated_names:
            path.unlink()
    for path in generated.iterdir():
        if path.is_file():
            os.replace(path, OUT / path.name)


def main():
    global OUT
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runner", required=True)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--refresh", action="store_true")
    mode.add_argument("--check", action="store_true")
    arguments = parser.parse_args()
    source_out = OUT
    with tempfile.TemporaryDirectory(prefix="native-conformance-", dir=OUT.parent) as temporary:
        generated = build_artifacts(Path(arguments.runner), Path(temporary))
        OUT = source_out
        if arguments.refresh:
            refresh_artifacts(generated)
        else:
            compare_artifacts(generated)
if __name__ == "__main__":
    main()
