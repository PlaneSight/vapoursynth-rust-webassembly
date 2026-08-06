// Runs the shared differential conformance corpus through the Emscripten ES
// module exports and compares every RGBA8 byte against the expected fixture
// the plan names (byte-exact), or prints deterministic statuses and
// dimensions when no fixture is named.
//
// The ES module surface is the Rust-prefixed opaque-handle ABI:
//   _malloc, _free,
//   _vs_rust_core_create, _vs_rust_core_release,
//   _vs_rust_core_invoke, _vs_rust_node_get_frame, _vs_rust_node_release,
//   _vs_rust_frame_dimensions, _vs_rust_frame_rgba8_size,
//   _vs_rust_frame_copy_rgba8, _vs_rust_frame_release

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const [modulePath, planPath] = process.argv.slice(2);
if (!modulePath) {
  throw new Error("expected Emscripten module path");
}
if (!planPath) {
  throw new Error("expected corpus plan path");
}

const { default: createModule } = await import(pathToFileURL(modulePath));
const module = await createModule();

const ARGUMENT_INT = 1;
const ARGUMENT_FLOAT = 2;
const ARGUMENT_DATA = 3;
const ARGUMENT_NODE = 4;

const STATUS = Object.freeze({
  OK: 0,
  INVALID_ARGUMENT: 1,
  OUTPUT_TOO_SMALL: 2,
  API_UNAVAILABLE: 3,
  CORE_UNAVAILABLE: 4,
  STANDARD_PLUGIN_UNAVAILABLE: 5,
  MAP_WRITE_FAILED: 6,
  INVOCATION_FAILED: 7,
  NODE_UNAVAILABLE: 8,
  FRAME_UNAVAILABLE: 9,
  UNEXPECTED_FRAME: 10,
  INTERNAL_FAILURE: 11,
  FRAME_REQUEST_FAILED: 12,
  INVALID_HANDLE: 13,
  HANDLE_KIND_MISMATCH: 14,
  HANDLE_TABLE_EXHAUSTED: 15,
  CORE_ALREADY_ACTIVE: 16,
  ABI_MISMATCH: 17,
  UNKNOWN_FUNCTION: 18,
});

const kindByName = Object.freeze({
  int: ARGUMENT_INT,
  intArray: ARGUMENT_INT,
  float: ARGUMENT_FLOAT,
  floatArray: ARGUMENT_FLOAT,
  data: ARGUMENT_DATA,
  node: ARGUMENT_NODE,
  nodeArray: ARGUMENT_NODE,
});

const plan = JSON.parse(readFileSync(planPath, "utf8"));
assert.equal(plan.version, 1, "plan version must be 1");
assert.ok(Array.isArray(plan.operations) && plan.operations.length > 0, "plan needs operations");
assert.ok(Array.isArray(plan.outputs) && plan.outputs.length > 0, "plan needs outputs");

const planDirectory = dirname(planPath);
const encoder = new TextEncoder();
const allocations = [];

function alloc(bytes) {
  const ptr = module._malloc(bytes);
  assert.notEqual(ptr, 0, "malloc failed");
  allocations.push(ptr);
  return ptr;
}

function allocString(value) {
  const bytes = encoder.encode(value);
  const ptr = alloc(bytes.length);
  module.HEAPU8.set(bytes, ptr);
  return { ptr, length: bytes.length };
}

function allocU32s(values) {
  const ptr = alloc(values.length * 4);
  const view = new DataView(module.HEAPU8.buffer, ptr, values.length * 4);
  values.forEach((value, index) => view.setUint32(index * 4, value, true));
  return ptr;
}

function allocKindValues(kind, values) {
  const elementBytes = kind === ARGUMENT_DATA ? 1 : 8;
  const byteLength = Math.max(values.length * elementBytes, 1);
  const ptr = alloc(byteLength);
  const view = new DataView(module.HEAPU8.buffer, ptr, byteLength);
  if (kind === ARGUMENT_INT) {
    values.forEach((value, index) => view.setBigInt64(index * 8, BigInt(value), true));
  } else if (kind === ARGUMENT_FLOAT) {
    values.forEach((value, index) => view.setFloat64(index * 8, value, true));
  } else if (kind === ARGUMENT_DATA) {
    module.HEAPU8.set(values, ptr);
  } else if (kind === ARGUMENT_NODE) {
    values.forEach(({ slot, generation }, index) => {
      view.setUint32(index * 8, slot, true);
      view.setUint32(index * 8 + 4, generation, true);
    });
  } else {
    throw new Error(`unknown argument kind ${kind}`);
  }
  return { ptr, valueCount: kind === ARGUMENT_DATA ? byteLength : values.length };
}

function readCString(ptr) {
  const heap = module.HEAPU8;
  let length = 0;
  while (heap[ptr + length] !== 0) {
    length += 1;
  }
  return new TextDecoder().decode(heap.slice(ptr, ptr + length));
}

function freeAllocations() {
  while (allocations.length > 0) {
    module._free(allocations.pop());
  }
}

function expectStatus(operation, actual, expected) {
  assert.equal(
    actual,
    expected,
    `${operation} returned ${actual}; expected ${expected}`,
  );
}

function coreCreate() {
  const outSlot = alloc(4);
  const outGeneration = alloc(4);
  const status = module._vs_rust_core_create(outSlot, outGeneration);
  expectStatus("core create", status, STATUS.OK);
  const core = { slot: module.HEAPU32[outSlot >> 2], generation: module.HEAPU32[outGeneration >> 2] };
  assert.notEqual(core.slot, 0, "core token slot must be non-zero");
  assert.notEqual(core.generation, 0, "core token generation must be non-zero");
  return core;
}

function invoke(core, namespace, functionName, rawArguments) {
  const descriptors = [];
  for (const argument of rawArguments) {
    const key = allocString(argument.key);
    const values = allocKindValues(argument.kind, argument.values);
    descriptors.push({
      keyPtr: key.ptr,
      keyLength: key.length,
      kind: argument.kind,
      valuesPtr: values.ptr,
      valueCount: values.valueCount,
    });
  }

  const descriptorBytes = descriptors.length * 20;
  const descriptorPtr = alloc(descriptorBytes);
  const view = new DataView(module.HEAPU8.buffer, descriptorPtr, descriptorBytes);
  descriptors.forEach((descriptor, index) => {
    const offset = index * 20;
    view.setUint32(offset + 0, descriptor.keyPtr, true);
    view.setUint32(offset + 4, descriptor.keyLength, true);
    view.setUint32(offset + 8, descriptor.kind, true);
    view.setUint32(offset + 12, descriptor.valuesPtr, true);
    view.setUint32(offset + 16, descriptor.valueCount, true);
  });

  const namespaceSpan = allocString(namespace);
  const functionSpan = allocString(functionName);
  const resultKeySpan = allocString("clip");
  const error = alloc(1024);
  const outSlot = alloc(4);
  const outGeneration = alloc(4);

  const status = module._vs_rust_core_invoke(
    core.slot,
    core.generation,
    namespaceSpan.ptr,
    namespaceSpan.length,
    functionSpan.ptr,
    functionSpan.length,
    descriptorPtr,
    descriptors.length,
    resultKeySpan.ptr,
    resultKeySpan.length,
    0,
    error,
    1024,
    outSlot,
    outGeneration,
  );

  const errorText = readCString(error);
  const slot = module.HEAPU32[outSlot >> 2];
  const generation = module.HEAPU32[outGeneration >> 2];
  freeAllocations();
  return { status, errorText, slot, generation };
}

function nodeGetFrame(node, frameNumber) {
  const outSlot = alloc(4);
  const outGeneration = alloc(4);
  const status = module._vs_rust_node_get_frame(
    node.slot,
    node.generation,
    frameNumber,
    outSlot,
    outGeneration,
  );
  const slot = module.HEAPU32[outSlot >> 2];
  const generation = module.HEAPU32[outGeneration >> 2];
  freeAllocations();
  return { status, slot, generation };
}

function frameDimensions(frame) {
  const outWidth = alloc(4);
  const outHeight = alloc(4);
  const status = module._vs_rust_frame_dimensions(
    frame.slot,
    frame.generation,
    outWidth,
    outHeight,
  );
  const width = module.HEAPU32[outWidth >> 2];
  const height = module.HEAPU32[outHeight >> 2];
  freeAllocations();
  return { status, width, height };
}

function frameRgba8Size(frame) {
  const outSize = alloc(4);
  const status = module._vs_rust_frame_rgba8_size(frame.slot, frame.generation, outSize);
  const size = module.HEAPU32[outSize >> 2];
  freeAllocations();
  return { status, size };
}

function frameCopyRgba8(frame, size) {
  const output = alloc(size);
  const status = module._vs_rust_frame_copy_rgba8(frame.slot, frame.generation, output, size);
  const rgba = Buffer.from(module.HEAPU8.slice(output, output + size));
  freeAllocations();
  return { status, rgba };
}

const core = coreCreate();
const nodeByOperationId = new Map();
const liveNodes = [];
const liveFrames = [];

try {
  console.log(`plan ${planPath}: ${plan.operations.length} operation(s), ${plan.outputs.length} output(s)`);

  for (const operation of plan.operations) {
    assert.equal(typeof operation.id, "number", "operation id must be an integer");
    assert.equal(typeof operation.namespace, "string", "operation namespace must be a string");
    assert.equal(typeof operation.function, "string", "operation function must be a string");
    assert.ok(Array.isArray(operation.arguments), "operation arguments must be an array");

    const rawArguments = [];
    for (const argument of operation.arguments) {
      const kind = kindByName[argument.kind];
      assert.ok(kind !== undefined, `operation ${operation.id} has unknown argument kind ${argument.kind}`);
      let values;
      if (kind === ARGUMENT_NODE) {
        const references = Array.isArray(argument.value) ? argument.value : [argument.value];
        values = references.map((operationId) => {
          const token = nodeByOperationId.get(operationId);
          assert.ok(token, `operation ${operation.id} references unknown node operation ${operationId}`);
          return token;
        });
      } else if (Array.isArray(argument.value)) {
        values = argument.value;
      } else {
        values = [argument.value];
      }
      rawArguments.push({ key: argument.key, kind, values });
    }

    const result = invoke(core, operation.namespace, operation.function, rawArguments);
    if (result.status !== STATUS.OK) {
      console.log(
        `operation ${operation.id} ${operation.namespace}.${operation.function}: FAILED status=${result.status} error=${result.errorText || "(no error text)"}`,
      );
      throw new Error(
        `operation ${operation.id} ${operation.namespace}.${operation.function} failed with status ${result.status}: ${result.errorText}`,
      );
    }

    console.log(`operation ${operation.id} ${operation.namespace}.${operation.function}: OK`);
    const node = { slot: result.slot, generation: result.generation };
    nodeByOperationId.set(operation.id, node);
    liveNodes.push(node);
  }

  for (const output of plan.outputs) {
    assert.equal(typeof output.index, "number", "output index must be an integer");
    const node = nodeByOperationId.get(output.node);
    assert.ok(node, `output ${output.index} references unknown node operation ${output.node}`);

    const frameResult = nodeGetFrame(node, 0);
    expectStatus(`output ${output.index} frame request`, frameResult.status, STATUS.OK);
    const frame = { slot: frameResult.slot, generation: frameResult.generation };
    liveFrames.push(frame);

    const dimensions = frameDimensions(frame);
    expectStatus(`output ${output.index} dimensions`, dimensions.status, STATUS.OK);

    const sizeResult = frameRgba8Size(frame);
    expectStatus(`output ${output.index} rgba8 size`, sizeResult.status, STATUS.OK);

    const copyResult = frameCopyRgba8(frame, sizeResult.size);
    expectStatus(`output ${output.index} rgba8 copy`, copyResult.status, STATUS.OK);
    assert.equal(copyResult.rgba.length, sizeResult.size, "copied byte count must match reported size");

    if (typeof output.expected !== "string") {
      console.log(
        `output ${output.index}: ${dimensions.width}x${dimensions.height} rgba8=${sizeResult.size} status=OK (no expected fixture named)`,
      );
      continue;
    }

    const fixturePath = join(planDirectory, output.expected);
    const expected = readFileSync(fixturePath);
    assert.equal(
      expected.length,
      copyResult.rgba.length,
      `output ${output.index} size mismatch: produced ${copyResult.rgba.length} bytes, fixture ${fixturePath} has ${expected.length}`,
    );

    let firstDifference = -1;
    for (let index = 0; index < copyResult.rgba.length; index += 1) {
      if (copyResult.rgba[index] !== expected[index]) {
        firstDifference = index;
        break;
      }
    }

    if (firstDifference === -1) {
      console.log(
        `output ${output.index}: ${dimensions.width}x${dimensions.height} rgba8=${sizeResult.size} byte-exact MATCH`,
      );
    } else {
      throw new Error(
        `output ${output.index}: ${dimensions.width}x${dimensions.height} rgba8=${sizeResult.size} MISMATCH at byte ${firstDifference} (produced ${copyResult.rgba[firstDifference]}, fixture ${expected[firstDifference]})`,
      );
    }
  }

  console.log(`plan ${planPath} passed`);
} finally {
  for (const frame of liveFrames) {
    module._vs_rust_frame_release(frame.slot, frame.generation);
  }
  for (const node of liveNodes) {
    module._vs_rust_node_release(node.slot, node.generation);
  }
  module._vs_rust_core_release(core.slot, core.generation);
}
