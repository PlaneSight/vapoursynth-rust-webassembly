#!/usr/bin/env python3
"""Generates the common-stdlib corpus: plan vectors + hand-derived golden RGBA8.

Every golden fixture is derived from the documented upstream semantics
(vendor/vapoursynth/src/core), NOT from the runtime under test:
  - BlankClip color fill: [r, g, b, 255] per pixel
  - Invert / Lut(255-x): 255 - channel
  - Crop / AddBorders / flips / turns / transpose / stacks: geometry
  - Expr "x 96 +" on uint8: saturating add (clamp_int at store)
  - Levels: lut[v] = u8(clamp(pow(clamp(v,min_in,max_in)-min_in)/(max_in-min_in),
        gamma) * (max_out-min_out) + min_out, 0, 255) + 0.5)
  - Median / Minimum / Maximum on a flat frame: identity
  - ShufflePlanes planes [0,1,2] cfRGB=2: identity
"""

import json
from pathlib import Path

OUT = Path(__file__).resolve().parent / "vectors"
FORMAT_RGB24 = 537395200  # VS_MAKE_VIDEO_ID(cfRGB=2, stInteger=0, 8, 0, 0)
R, G, B = 32, 96, 224
ALPHA = 255


def flat(width, height, color):
    return bytes([*color, ALPHA]) * (width * height)


def framed(width, height, color, left, right, top, bottom, border=(0, 0, 0)):
    """Flat color frame with an asymmetric border of `border`."""
    w = width + left + right
    border_row = bytes([*border, ALPHA]) * w
    middle_row = (
        bytes([*border, ALPHA]) * left
        + bytes([*color, ALPHA]) * width
        + bytes([*border, ALPHA]) * right
    )
    return border_row * top + middle_row * height + border_row * bottom


def transpose(width, height, data):
    """data is width*height RGBA pixels, returns height*width RGBA pixels."""
    out = bytearray(len(data))
    for y in range(height):
        for x in range(width):
            src = (y * width + x) * 4
            dst = (x * height + y) * 4
            out[dst : dst + 4] = data[src : src + 4]
    return bytes(out)


def stackh(parts, height):
    out = bytearray()
    for y in range(height):
        for w, data in parts:
            out += data[y * w * 4 : (y + 1) * w * 4]
    return bytes(out)

def stackv(parts):
    return b"".join(data for _, data in parts)


def levels_lut(min_in, max_in, gamma, min_out, max_out):
    gamma = 1.0 / gamma
    lut = []
    for v in range(256):
        value = max(min(v, max_in) - min_in, 0.0) / (max_in - min_in)
        value = pow(value, gamma) * (max_out - min_out) + min_out
        value = max(min(value, 255.0), 0.0) + 0.5
        lut.append(int(value))
    return lut


def plan(operations, fixture_name):
    return {
        "version": 1,
        "operations": [
            {"id": i + 1, "namespace": "std", "function": fn, "arguments": args}
            for i, (fn, args) in enumerate(operations)
        ],
        "outputs": [
            {
                "index": 0,
                "node": len(operations),
                "expected": f"{fixture_name}.rgba.bin",
            }
        ],
    }


def emit(name, operations, golden):
    generated_plan = plan(operations, name)
    (OUT / f"{name}.plan.json").write_text(
        json.dumps(generated_plan, indent=2) + "\n",
        encoding="utf-8",
    )
    (OUT / f"{name}.rgba.bin").write_bytes(golden)
    print(f"{name}: {len(golden)} bytes")


def main():
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


if __name__ == "__main__":
    main()
