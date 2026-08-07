import assert from "node:assert/strict";
import test from "node:test";

import { EmscriptenSession } from "../../runtime/emscripten/session.mjs";

const ARGUMENT_DESCRIPTOR_SIZE = 20;
const ARGUMENT_KEY_OFFSET = 0;
const ARGUMENT_KEY_LENGTH_OFFSET = 4;
const ARGUMENT_KIND_OFFSET = 8;
const ARGUMENT_VALUES_OFFSET = 12;
const ARGUMENT_VALUE_COUNT_OFFSET = 16;

const KIND_INT = 1;
const KIND_FLOAT = 2;
const KIND_DATA = 3;
const KIND_NODE = 4;
const RGB24_FORMAT_ID = 537_395_200;

/** Builds an Emscripten-like module whose exports emulate the Rust ABI. */
function fakeModule(overrides = {}) {
  const memory = new Uint8Array(1 << 16);
  const calls = [];
  const freed = [];
  const allocations = new Set();
  let nextPointer = 64;

  function malloc(size) {
    const pointer = nextPointer;
    nextPointer += size;
    allocations.add(pointer);
    calls.push(["malloc", size, pointer]);
    return pointer;
  }

  function free(pointer) {
    if (!allocations.has(pointer)) {
      throw new Error(`double-free or foreign free of ${pointer}`);
    }
    allocations.delete(pointer);
    freed.push(pointer);
  }

  function writeU32(pointer, value) {
    new DataView(memory.buffer, pointer, 4).setUint32(0, value, true);
  }

  function decodeSpan(pointer, length) {
    return new TextDecoder().decode(memory.subarray(pointer, pointer + length));
  }

  function decodeArguments(argsPointer, count) {
    const view = new DataView(memory.buffer);
    const decoded = [];
    for (let index = 0; index < count; index += 1) {
      const offset = argsPointer + index * ARGUMENT_DESCRIPTOR_SIZE;
      const keyPointer = view.getUint32(offset + ARGUMENT_KEY_OFFSET, true);
      const keyLength = view.getUint32(offset + ARGUMENT_KEY_LENGTH_OFFSET, true);
      const kind = view.getUint32(offset + ARGUMENT_KIND_OFFSET, true);
      const valuesPointer = view.getUint32(offset + ARGUMENT_VALUES_OFFSET, true);
      const valueCount = view.getUint32(offset + ARGUMENT_VALUE_COUNT_OFFSET, true);

      let values;
      if (kind === KIND_INT) {
        values = [];
        for (let item = 0; item < valueCount; item += 1) {
          values.push(Number(view.getBigInt64(valuesPointer + item * 8, true)));
        }
      } else if (kind === KIND_FLOAT) {
        values = [];
        for (let item = 0; item < valueCount; item += 1) {
          values.push(view.getFloat64(valuesPointer + item * 8, true));
        }
      } else if (kind === KIND_DATA) {
        values = decodeSpan(valuesPointer, valueCount);
      } else if (kind === KIND_NODE) {
        values = [];
        for (let item = 0; item < valueCount; item += 1) {
          values.push({
            slot: view.getUint32(valuesPointer + item * 8, true),
            generation: view.getUint32(valuesPointer + item * 8 + 4, true),
          });
        }
      } else {
        throw new Error(`fake module saw unexpected argument kind ${kind}`);
      }

      decoded.push({ key: decodeSpan(keyPointer, keyLength), kind, valueCount, values });
    }
    return decoded;
  }

  const module = {
    HEAPU8: memory,
    calls,
    get freed() {
      return freed;
    },
    get liveAllocations() {
      return [...allocations];
    },
    _malloc: malloc,
    _free: free,

    _vs_rust_core_create(outSlot, outGeneration) {
      calls.push(["core_create"]);
      if (overrides.coreCreate !== undefined) {
        return overrides.coreCreate;
      }
      writeU32(outSlot, 7);
      writeU32(outGeneration, 1);
      return 0;
    },
    _vs_rust_core_release(slot, generation) {
      calls.push(["core_release", slot, generation]);
      return overrides.coreRelease ?? 0;
    },
    _vs_rust_core_invoke(
      coreSlot,
      coreGeneration,
      namespacePointer,
      namespaceLength,
      functionPointer,
      functionLength,
      argumentsPointer,
      argumentCount,
      resultKeyPointer,
      resultKeyLength,
      resultIndex,
      errorBuffer,
      errorSize,
      outSlot,
      outGeneration,
    ) {
      const namespace = decodeSpan(namespacePointer, namespaceLength);
      const functionName = decodeSpan(functionPointer, functionLength);
      const resultKey = decodeSpan(resultKeyPointer, resultKeyLength);
      const decodedArguments = decodeArguments(argumentsPointer, argumentCount);
      calls.push(["invoke", { coreSlot, coreGeneration, namespace, functionName, resultKey, resultIndex, arguments: decodedArguments }]);
      if (overrides.invoke !== undefined) {
        if (overrides.invokeMessage !== undefined) {
          const bytes = new TextEncoder().encode(overrides.invokeMessage);
          memory.set(bytes, errorBuffer);
          memory[errorBuffer + bytes.length] = 0;
        }
        return overrides.invoke;
      }
      writeU32(outSlot, 11);
      writeU32(outGeneration, 2);
      return 0;
    },
    _vs_rust_node_get_frame(nodeSlot, nodeGeneration, frameNumber, outSlot, outGeneration) {
      calls.push(["node_get_frame", nodeSlot, nodeGeneration, frameNumber]);
      if (overrides.nodeGetFrame !== undefined) {
        return overrides.nodeGetFrame;
      }
      writeU32(outSlot, 12);
      writeU32(outGeneration, 3);
      return 0;
    },
    _vs_rust_node_release(slot, generation) {
      calls.push(["node_release", slot, generation]);
      return overrides.nodeRelease ?? 0;
    },
    _vs_rust_frame_dimensions(slot, generation, outWidth, outHeight) {
      calls.push(["frame_dimensions", slot, generation]);
      if (overrides.frameDimensions !== undefined) {
        return overrides.frameDimensions;
      }
      writeU32(outWidth, 3);
      writeU32(outHeight, 2);
      return 0;
    },
    _vs_rust_frame_rgba8_size(slot, generation, outSize) {
      calls.push(["frame_rgba8_size", slot, generation]);
      if (overrides.frameRgba8SizeStatus !== undefined) {
        return overrides.frameRgba8SizeStatus;
      }
      writeU32(outSize, overrides.frameRgba8Size ?? 24);
      return 0;
    },
    _vs_rust_frame_copy_rgba8(slot, generation, rgba, rgbaSize) {
      calls.push(["frame_copy_rgba8", slot, generation, rgbaSize]);
      if (overrides.frameCopy !== undefined) {
        return overrides.frameCopy;
      }
      memory.fill(0xab, rgba, rgba + rgbaSize);
      return 0;
    },
    _vs_rust_frame_release(slot, generation) {
      calls.push(["frame_release", slot, generation]);
      return overrides.frameRelease ?? 0;
    },
  };
  return module;
}

test("requires the full generic Rust export surface at construction", () => {
  assert.throws(
    () => new EmscriptenSession({ _malloc() {}, _free() {} }),
    (error) => error instanceof TypeError && /missing required export/.test(error.message),
  );
  assert.throws(
    () => new EmscriptenSession(null),
    (error) => error instanceof TypeError,
  );
});

test("creates and releases one Rust core through opaque tokens", () => {
  const module = fakeModule();
  const session = new EmscriptenSession(module);

  assert.deepEqual(session.core_create(1), { slot: 7, generation: 1 });
  session.core_release(2, { slot: 7, generation: 1 });

  assert.deepEqual(module.calls, [
    ["malloc", 8, 64],
    ["core_create"],
    ["core_release", 7, 1],
  ]);
  assert.deepEqual(module.freed, [64]);
  assert.deepEqual(module.liveAllocations, []);
});

test("encodes typed arguments into the shared descriptor ABI", () => {
  const module = fakeModule();
  const session = new EmscriptenSession(module);

  const token = session.invoke(1, { slot: 7, generation: 1 }, "std", "BlankClip", [
    { key: "width", kind: "int", value: 320 },
    { key: "height", kind: "int", value: 180 },
    { key: "format", kind: "int", value: RGB24_FORMAT_ID },
    { key: "color", kind: "intArray", value: [32, 96, 224] },
    { key: "ratio", kind: "float", value: 1.5 },
    { key: "gain", kind: "floatArray", value: [0.25, 0.5] },
    { key: "expr", kind: "data", value: "x 2 *" },
    { key: "clip", kind: "node", value: { slot: 21, generation: 4 } },
    { key: "clips", kind: "nodeArray", value: [{ slot: 1, generation: 1 }, { slot: 2, generation: 2 }] },
  ]);

  assert.deepEqual(token, { slot: 11, generation: 2 });
  const invoke = module.calls.find(([name]) => name === "invoke")[1];
  assert.equal(invoke.namespace, "std");
  assert.equal(invoke.functionName, "BlankClip");
  assert.equal(invoke.resultKey, "clip");
  assert.equal(invoke.resultIndex, 0);
  assert.equal(invoke.coreSlot, 7);
  assert.equal(invoke.coreGeneration, 1);
  assert.deepEqual(invoke.arguments, [
    { key: "width", kind: KIND_INT, valueCount: 1, values: [320] },
    { key: "height", kind: KIND_INT, valueCount: 1, values: [180] },
    { key: "format", kind: KIND_INT, valueCount: 1, values: [RGB24_FORMAT_ID] },
    { key: "color", kind: KIND_INT, valueCount: 3, values: [32, 96, 224] },
    { key: "ratio", kind: KIND_FLOAT, valueCount: 1, values: [1.5] },
    { key: "gain", kind: KIND_FLOAT, valueCount: 2, values: [0.25, 0.5] },
    { key: "expr", kind: KIND_DATA, valueCount: 5, values: "x 2 *" },
    { key: "clip", kind: KIND_NODE, valueCount: 1, values: [{ slot: 21, generation: 4 }] },
    { key: "clips", kind: KIND_NODE, valueCount: 2, values: [{ slot: 1, generation: 1 }, { slot: 2, generation: 2 }] },
  ]);

  // Every temporary allocation must be returned before invoke resolves.
  assert.deepEqual(module.liveAllocations, []);
});

test("frees partially encoded arguments when a later descriptor is invalid", () => {
  const module = fakeModule();
  const session = new EmscriptenSession(module);

  assert.throws(
    () =>
      session.invoke(1, { slot: 7, generation: 1 }, "std", "BlankClip", [
        { key: "width", kind: "int", value: 320 },
        null,
      ]),
    (error) => error.code === "invalid-argument",
  );
  assert.deepEqual(module.liveAllocations, []);
});

test("requests the requested frame number and copies RGBA out of wasm memory", () => {
  const module = fakeModule();
  const session = new EmscriptenSession(module);

  const nodeToken = session.invoke(1, { slot: 7, generation: 1 }, "std", "Invert", [
    { key: "clip", kind: "node", value: { slot: 11, generation: 2 } },
  ]);
  const frameToken = session.node_get_frame(2, nodeToken, 0);
  assert.deepEqual(frameToken, { slot: 12, generation: 3 });
  assert.deepEqual(session.frame_dimensions(3, frameToken), { width: 3, height: 2 });
  assert.equal(session.frame_rgba8_size(4, frameToken), 24);

  const rgba = session.frame_copy_rgba8(5, frameToken);
  assert.deepEqual(rgba, new Uint8Array(24).fill(0xab));
  assert.deepEqual(module.calls.filter(([name]) => name === "node_get_frame"), [["node_get_frame", 11, 2, 0]]);
  assert.deepEqual(module.calls.filter(([name]) => name === "frame_copy_rgba8"), [["frame_copy_rgba8", 12, 3, 24]]);

  session.frame_release(6, frameToken);
  assert.deepEqual(module.calls.filter(([name]) => name === "frame_release"), [["frame_release", 12, 3]]);
  assert.deepEqual(module.liveAllocations, []);
});

test("releases frames in finally even when the copy fails upstream", () => {
  const module = fakeModule({ frameCopy: 2 });
  const session = new EmscriptenSession(module);

  assert.throws(
    () => session.frame_copy_rgba8(9, { slot: 12, generation: 3 }),
    (error) => error.code === "output-too-small",
  );
  assert.ok(module.calls.some(([name]) => name === "frame_copy_rgba8"));
  assert.deepEqual(module.liveAllocations, []);
});

test("maps upstream status codes and error-buffer text deterministically", () => {
  const module = fakeModule({ invoke: 18, invokeMessage: "no such function: std.Nope" });
  const session = new EmscriptenSession(module);

  assert.throws(
    () => session.invoke(1, { slot: 7, generation: 1 }, "std", "Nope", []),
    (error) =>
      error.code === "unknown-function" && error.message === "no such function: std.Nope" && error.requestId === 1,
  );

  module.calls.length = 0;
  const failing = fakeModule({ invoke: 7 });
  const failingSession = new EmscriptenSession(failing);
  assert.throws(
    () => failingSession.invoke(2, { slot: 7, generation: 1 }, "std", "Broken", []),
    (error) => error.code === "invocation-failed",
  );

  module.calls.length = 0;
  const unknown = fakeModule({ invoke: 99 });
  const unknownSession = new EmscriptenSession(unknown);
  assert.throws(
    () => unknownSession.invoke(3, { slot: 7, generation: 1 }, "std", "Odd", []),
    (error) => error.code === "upstream-error",
  );
});

test("enforces the 16 MiB RGBA8 budget before allocating a frame copy", () => {
  const module = fakeModule({ frameRgba8Size: 17 * 1024 * 1024 });
  const session = new EmscriptenSession(module);

  assert.throws(
    () => session.frame_copy_rgba8(4, { slot: 12, generation: 3 }),
    (error) => error.code === "frame-too-large" && /16 MiB/.test(error.message),
  );
  assert.ok(module.calls.every(([name]) => name !== "frame_copy_rgba8"));
});

test("closes deterministically and rejects work after free", () => {
  const module = fakeModule();
  const session = new EmscriptenSession(module);
  assert.equal(JSON.parse(session.status()).upstreamLinked, true);

  session.free();
  assert.equal(JSON.parse(session.status()).upstreamLinked, false);
  assert.throws(
    () => session.core_create(4),
    (error) => error.code === "runtime-closed",
  );
  assert.throws(
    () => session.invoke(4, { slot: 7, generation: 1 }, "std", "BlankClip", []),
    (error) => error.code === "runtime-closed",
  );
});
