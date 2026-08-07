const STATUS_OK = 0;
const ERROR_BUFFER_SIZE = 512;
const MAX_RGBA_BYTES = 16 * 1024 * 1024;
const U32_MAX = 0xffff_ffff;

const THREADING_SINGLE = "single-thread";
const THREADING_THREADED = "threaded";
const THREADING_UNAVAILABLE = "unavailable";

export const THREADING_MODES = Object.freeze({
  SINGLE: THREADING_SINGLE,
  THREADED: THREADING_THREADED,
  UNAVAILABLE: THREADING_UNAVAILABLE,
});

/**
 * Resolves the build and browser prerequisites that determine the effective
 * scheduler. A threaded artifact is never downgraded to the single-thread
 * artifact after startup; it is reported unavailable instead.
 */
export function resolveThreadingStatus(module, options = {}) {
  if (!module || typeof module !== "object") {
    throw new TypeError("Emscripten module is required");
  }
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("threading options must be an object");
  }

  const compiledOverride = options.compiledMode === undefined
    ? undefined
    : normalizeThreadingMode(options.compiledMode, "compiledMode");
  const discovered = moduleThreadingMode(module, {
    required: compiledOverride === undefined,
  });
  const compiled = normalizeThreadingMode(
    discovered ?? compiledOverride ?? THREADING_SINGLE,
    "compiledMode",
  );
  const requested = normalizeThreadingMode(
    options.requestedMode
      ?? options.mode
      ?? compiledOverride
      ?? compiled,
    "requestedMode",
  );
  const crossOriginIsolated = readBooleanOption(
    options.crossOriginIsolated,
    globalThis.crossOriginIsolated === true,
    "crossOriginIsolated",
  );
  const sharedArrayBuffer = readBooleanOption(
    options.sharedArrayBufferAvailable,
    typeof globalThis.SharedArrayBuffer === "function",
    "sharedArrayBufferAvailable",
  );

  let active = compiled;
  let available = true;
  let reason = compiled === THREADING_THREADED ? "threaded-build" : "single-thread-build";
  let fallback = compiled === THREADING_SINGLE;
  if (
    requested !== compiled
    || (compiledOverride !== undefined && compiledOverride !== compiled)
  ) {
    active = THREADING_UNAVAILABLE;
    available = false;
    fallback = false;
    reason = "threading-artifact-mismatch";
  } else if (compiled === THREADING_THREADED && !crossOriginIsolated) {
    active = THREADING_UNAVAILABLE;
    available = false;
    fallback = false;
    reason = "cross-origin-isolation-required";
  } else if (compiled === THREADING_THREADED && !sharedArrayBuffer) {
    active = THREADING_UNAVAILABLE;
    available = false;
    fallback = false;
    reason = "shared-array-buffer-unavailable";
  }
  return Object.freeze({
    requested,
    compiled,
    active,
    available,
    fallback,
    crossOriginIsolated,
    sharedArrayBuffer,
    reason,
  });
}


function moduleThreadingMode(module, { required = true } = {}) {
  if (typeof module._vs_browser_threading_mode === "function") {
    const mode = module._vs_browser_threading_mode();
    if (mode === 0) return THREADING_SINGLE;
    if (mode === 1) return THREADING_THREADED;
    return mode;
  }

  const explicit = module.vsBrowserThreading
    ?? module.__vsBrowserThreading
    ?? module.threadingMode;
  if (explicit !== undefined) {
    return explicit?.compiled ?? explicit;
  }

  if (!required) {
    return undefined;
  }
  throw new TypeError("Emscripten module is missing required export _vs_browser_threading_mode()");
}

function normalizeThreadingMode(value, label) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : value;
  if (normalized === "single" || normalized === THREADING_SINGLE) {
    return THREADING_SINGLE;
  }
  if (normalized === THREADING_THREADED) {
    return THREADING_THREADED;
  }
  throw new TypeError(`${label} must be "single-thread" or "threaded"`);
}

function readBooleanOption(value, fallback, label) {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== "boolean") {
    throw new TypeError(`${label} must be a boolean`);
  }
  return value;
}
// Native vs_browser_argument descriptor layout (wasm32, 20 bytes, 4-aligned).
const ARGUMENT_DESCRIPTOR_SIZE = 20;
const ARGUMENT_KEY_OFFSET = 0;
const ARGUMENT_KEY_LENGTH_OFFSET = 4;
const ARGUMENT_KIND_OFFSET = 8;
const ARGUMENT_VALUES_OFFSET = 12;
const ARGUMENT_VALUE_COUNT_OFFSET = 16;

const ARGUMENT_KIND_INT = 1;
const ARGUMENT_KIND_FLOAT = 2;
const ARGUMENT_KIND_DATA = 3;
const ARGUMENT_KIND_NODE = 4;

const REQUIRED_EXPORTS = Object.freeze([
  "_malloc",
  "_free",
  "_vs_browser_threading_mode",
  "_vs_rust_core_create",
  "_vs_rust_core_release",
  "_vs_rust_core_invoke",
  "_vs_rust_node_get_frame",
  "_vs_rust_node_release",
  "_vs_rust_frame_dimensions",
  "_vs_rust_frame_rgba8_size",
  "_vs_rust_frame_copy_rgba8",
  "_vs_rust_frame_release",
]);

const STATUS_CODES = Object.freeze({
  1: "invalid-argument",
  2: "output-too-small",
  3: "api-unavailable",
  4: "core-unavailable",
  5: "standard-plugin-unavailable",
  6: "map-write-failed",
  7: "invocation-failed",
  8: "node-unavailable",
  9: "frame-unavailable",
  10: "unexpected-frame",
  11: "internal-failure",
  12: "frame-request-failed",
  13: "invalid-handle",
  14: "handle-kind-mismatch",
  15: "handle-table-exhausted",
  16: "core-already-active",
  17: "abi-mismatch",
  18: "unknown-function",
});

/**
 * Thin synchronous wrapper over the Rust-owned Emscripten exports. The module
 * exposes only generic operations: one core, typed argument descriptors, node
 * and frame leases. All buffers are caller-owned and freed before returning.
 */
export class EmscriptenSession {
  #module;
  #threading;
  #closed = false;

  constructor(module, options = {}) {
    if (!module || typeof module !== "object") {
      throw new TypeError("Emscripten module is required");
    }
    for (const exportName of REQUIRED_EXPORTS) {
      if (typeof module[exportName] !== "function") {
        throw new TypeError(`Emscripten module is missing required export ${exportName}()`);
      }
    }
    this.#module = module;
    this.#threading = resolveThreadingStatus(module, options);
  }

  status() {
    return JSON.stringify({
      schemaVersion: 1,
      upstreamLinked: !this.#closed,
      workerProtocol: true,
      phase: "browser-worker-canvas",
      threading: this.#threading,
    });
  }


  core_create(requestId) {
    this.#assertOpen(requestId);
    const out = this.#malloc(requestId, 8, "core token output");
    try {
      const status = this.#module._vs_rust_core_create(out, out + 4);
      if (status !== STATUS_OK) {
        throw this.#statusError(requestId, status, "creating the VapourSynth core failed");
      }
      return { slot: this.#readU32(out), generation: this.#readU32(out + 4) };
    } finally {
      this.#module._free(out);
    }
  }

  core_release(requestId, token) {
    this.#assertOpen(requestId);
    this.#requireToken(token, requestId);
    const status = this.#module._vs_rust_core_release(token.slot, token.generation);
    if (status !== STATUS_OK) {
      throw this.#statusError(requestId, status, "releasing the VapourSynth core failed");
    }
  }

  /**
   * Invokes one generic namespace.function through the Rust core and returns
   * the resulting opaque node token.
   *
   * @param {object} planArguments - [{key, kind, value}] plan arguments
   * @param {string} [resultKey] - map key of the function result node
   */
  invoke(requestId, coreToken, namespace, functionName, planArguments, resultKey = "clip", resultIndex = 0) {
    this.#assertOpen(requestId);
    this.#requireToken(coreToken, requestId);
    this.#requireName(namespace, requestId, "namespace");
    this.#requireName(functionName, requestId, "function");
    this.#requireName(resultKey, requestId, "result key");

    const allocations = [];
    let descriptors = 0;
    let outToken = 0;
    let errorBuffer = 0;
    try {
      descriptors = this.#encodeArguments(requestId, planArguments, allocations);
      const namespaceBytes = this.#utf8(namespace);
      const functionBytes = this.#utf8(functionName);
      const resultKeyBytes = this.#utf8(resultKey);
      const namespacePtr = this.#storeBytes(requestId, namespaceBytes, allocations);
      const functionPtr = this.#storeBytes(requestId, functionBytes, allocations);
      const resultKeyPtr = this.#storeBytes(requestId, resultKeyBytes, allocations);
      errorBuffer = this.#malloc(requestId, ERROR_BUFFER_SIZE, "invoke error buffer");
      outToken = this.#malloc(requestId, 8, "invoke node token output");
      allocations.push(errorBuffer, outToken);

      const status = this.#module._vs_rust_core_invoke(
        coreToken.slot,
        coreToken.generation,
        namespacePtr,
        namespaceBytes.length,
        functionPtr,
        functionBytes.length,
        descriptors,
        planArguments.length,
        resultKeyPtr,
        resultKeyBytes.length,
        resultIndex,
        errorBuffer,
        ERROR_BUFFER_SIZE,
        outToken,
        outToken + 4,
      );
      if (status !== STATUS_OK) {
        throw this.#statusError(requestId, status, this.#readErrorMessage(errorBuffer));
      }
      return { slot: this.#readU32(outToken), generation: this.#readU32(outToken + 4) };
    } finally {
      for (const pointer of allocations) {
        this.#module._free(pointer);
      }
    }
  }

  node_get_frame(requestId, nodeToken, frameNumber) {
    this.#assertOpen(requestId);
    this.#requireToken(nodeToken, requestId);
    this.#requireFrameNumber(frameNumber, requestId);
    const out = this.#malloc(requestId, 8, "frame token output");
    try {
      const status = this.#module._vs_rust_node_get_frame(
        nodeToken.slot,
        nodeToken.generation,
        frameNumber,
        out,
        out + 4,
      );
      if (status !== STATUS_OK) {
        throw this.#statusError(requestId, status, "requesting an upstream frame failed");
      }
      return { slot: this.#readU32(out), generation: this.#readU32(out + 4) };
    } finally {
      this.#module._free(out);
    }
  }

  node_video_info(requestId, nodeToken) {
    this.#assertOpen(requestId);
    this.#requireToken(nodeToken, requestId);
    const method = this.#module._vs_rust_node_video_info;
    if (typeof method !== "function") {
      return undefined;
    }

    const out = this.#malloc(requestId, 32, "video metadata output");
    try {
      const status = method(
        nodeToken.slot,
        nodeToken.generation,
        out,
        out + 4,
        out + 8,
        out + 16,
        out + 24,
      );
      if (status !== STATUS_OK) {
        throw this.#statusError(requestId, status, "reading the upstream video metadata failed");
      }
      return {
        width: this.#readU32(out),
        height: this.#readU32(out + 4),
        numFrames: this.#readU32(out + 8),
        fpsNum: this.#readI64(out + 16),
        fpsDen: this.#readI64(out + 24),
      };
    } finally {
      this.#module._free(out);
    }
  }

  source_create(requestId, coreToken, width, height, numFrames, fpsNum, fpsDen) {
    this.#assertOpen(requestId);
    this.#requireToken(coreToken, requestId);
    requireU32(width, requestId, "source width");
    requireU32(height, requestId, "source height");
    requireU32(numFrames, requestId, "source frame count");
    requireI64(fpsNum, requestId, "source fps numerator");
    requireI64(fpsDen, requestId, "source fps denominator");
    const method = this.#module._vs_rust_source_create;
    if (typeof method !== "function") {
      throw workerError(requestId, "unsupported-source", "the native runtime does not implement source_create()");
    }

    const out = this.#malloc(requestId, 8, "source node token output");
    try {
      const status = method(
        coreToken.slot,
        coreToken.generation,
        width,
        height,
        numFrames,
        BigInt(fpsNum),
        BigInt(fpsDen),
        out,
        out + 4,
      );
      if (status !== STATUS_OK) {
        throw this.#statusError(requestId, status, "creating the browser source node failed");
      }
      return { slot: this.#readU32(out), generation: this.#readU32(out + 4) };
    } finally {
      this.#module._free(out);
    }
  }

  source_upload_rgba(
    requestId,
    nodeToken,
    frameNumber,
    rgba,
    durationNum = 0,
    durationDen = 0,
    absoluteTime = Number.NaN,
  ) {
    this.#assertOpen(requestId);
    this.#requireToken(nodeToken, requestId);
    this.#requireFrameNumber(frameNumber, requestId);
    requireI64(durationNum, requestId, "frame duration numerator");
    requireI64(durationDen, requestId, "frame duration denominator");
    if (typeof absoluteTime !== "number" || (!Number.isNaN(absoluteTime) && !Number.isFinite(absoluteTime))) {
      throw workerError(requestId, "invalid-timing", "absoluteTime must be finite or NaN");
    }
    const bytes = normalizeUploadBytes(rgba, requestId);
    const pointer = this.#malloc(requestId, bytes.byteLength, "source RGBA8 frame");
    try {
      this.#module.HEAPU8.set(bytes, pointer);
      const method = this.#module._vs_rust_source_upload_rgba;
      if (typeof method !== "function") {
        throw workerError(requestId, "unsupported-source", "the native runtime does not implement source_upload_rgba()");
      }
      const status = method(
        nodeToken.slot,
        nodeToken.generation,
        frameNumber,
        pointer,
        bytes.byteLength,
        BigInt(durationNum),
        BigInt(durationDen),
        absoluteTime,
      );
      if (status !== STATUS_OK) {
        throw this.#statusError(requestId, status, "uploading a browser source frame failed");
      }
    } finally {
      this.#module._free(pointer);
    }
  }

  node_release(requestId, nodeToken) {
    this.#assertOpen(requestId);
    this.#requireToken(nodeToken, requestId);
    const status = this.#module._vs_rust_node_release(nodeToken.slot, nodeToken.generation);
    if (status !== STATUS_OK) {
      throw this.#statusError(requestId, status, "releasing an upstream node failed");
    }
  }

  frame_dimensions(requestId, frameToken) {
    this.#assertOpen(requestId);
    this.#requireToken(frameToken, requestId);
    const out = this.#malloc(requestId, 8, "frame dimensions output");
    try {
      const status = this.#module._vs_rust_frame_dimensions(frameToken.slot, frameToken.generation, out, out + 4);
      if (status !== STATUS_OK) {
        throw this.#statusError(requestId, status, "reading the upstream frame dimensions failed");
      }
      const width = this.#readU32(out);
      const height = this.#readU32(out + 4);
      if (width === 0 || height === 0) {
        throw workerError(requestId, "invalid-frame", "the upstream frame reports zero dimensions");
      }
      return { width, height };
    } finally {
      this.#module._free(out);
    }
  }

  frame_rgba8_size(requestId, frameToken) {
    this.#assertOpen(requestId);
    this.#requireToken(frameToken, requestId);
    const out = this.#malloc(requestId, 4, "frame size output");
    try {
      const status = this.#module._vs_rust_frame_rgba8_size(frameToken.slot, frameToken.generation, out);
      if (status !== STATUS_OK) {
        throw this.#statusError(requestId, status, "reading the upstream frame size failed");
      }
      return this.#readU32(out);
    } finally {
      this.#module._free(out);
    }
  }

  /** Copies one retained frame into a fresh RGBA8 buffer (16 MiB budget). */
  frame_copy_rgba8(requestId, frameToken) {
    this.#assertOpen(requestId);
    this.#requireToken(frameToken, requestId);
    const byteLength = this.frame_rgba8_size(requestId, frameToken);
    if (byteLength === 0) {
      throw workerError(requestId, "invalid-frame", "the upstream frame reports a zero RGBA8 size");
    }
    if (byteLength > MAX_RGBA_BYTES) {
      throw workerError(
        requestId,
        "frame-too-large",
        `RGBA8 frame byte length ${byteLength} exceeds the 16 MiB browser render budget`,
      );
    }

    const output = this.#malloc(requestId, byteLength, "RGBA8 frame buffer");
    try {
      const status = this.#module._vs_rust_frame_copy_rgba8(
        frameToken.slot,
        frameToken.generation,
        output,
        byteLength,
      );
      if (status !== STATUS_OK) {
        throw this.#statusError(requestId, status, "copying the upstream frame failed");
      }
      return this.#module.HEAPU8.slice(output, output + byteLength);
    } finally {
      this.#module._free(output);
    }
  }

  frame_timing(requestId, frameToken) {
    this.#assertOpen(requestId);
    this.#requireToken(frameToken, requestId);
    const method = this.#module._vs_rust_frame_timing;
    if (typeof method !== "function") {
      return undefined;
    }

    const out = this.#malloc(requestId, 32, "frame timing output");
    try {
      const status = method(
        frameToken.slot,
        frameToken.generation,
        out,
        out + 8,
        out + 16,
        out + 24,
      );
      if (status !== STATUS_OK) {
        throw this.#statusError(requestId, status, "reading upstream frame timing failed");
      }
      const flags = this.#readU32(out + 24);
      return {
        durationNum: this.#readI64(out),
        durationDen: this.#readI64(out + 8),
        absoluteTime: this.#readF64(out + 16),
        flags,
      };
    } finally {
      this.#module._free(out);
    }
  }

  frame_release(requestId, frameToken) {
    this.#assertOpen(requestId);
    this.#requireToken(frameToken, requestId);
    const status = this.#module._vs_rust_frame_release(frameToken.slot, frameToken.generation);
    if (status !== STATUS_OK) {
      throw this.#statusError(requestId, status, "releasing an upstream frame failed");
    }
  }

  free() {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    this.#module = null;
  }

  #encodeArguments(requestId, planArguments, allocations) {
    if (!Array.isArray(planArguments)) {
      throw workerError(requestId, "invalid-argument", "arguments must be an array");
    }
    const count = planArguments.length;
    if (count > 0xffff) {
      throw workerError(requestId, "invalid-argument", "too many arguments for the native descriptor table");
    }
    if (count === 0) {
      return 0;
    }

    const descriptors = this.#malloc(requestId, count * ARGUMENT_DESCRIPTOR_SIZE, "argument descriptors");
    allocations.push(descriptors);
    const view = new DataView(this.#module.HEAPU8.buffer, descriptors, count * ARGUMENT_DESCRIPTOR_SIZE);
    for (let index = 0; index < count; index += 1) {
      const argument = planArguments[index];
      if (!argument || typeof argument !== "object" || Array.isArray(argument)) {
        throw workerError(requestId, "invalid-argument", "each argument must be an object");
      }
      const { key, kind, value } = argument;
      if (typeof key !== "string" || key.length === 0) {
        throw workerError(requestId, "invalid-argument", "each argument needs a non-empty key");
      }
      const keyBytes = this.#utf8(key);
      const keyPtr = this.#storeBytes(requestId, keyBytes, allocations);
      const valueEncoding = this.#encodeValues(requestId, kind, value, allocations);

      const offset = index * ARGUMENT_DESCRIPTOR_SIZE;
      view.setUint32(ARGUMENT_KEY_OFFSET + offset, keyPtr, true);
      view.setUint32(ARGUMENT_KEY_LENGTH_OFFSET + offset, keyBytes.length, true);
      view.setUint32(ARGUMENT_KIND_OFFSET + offset, valueEncoding.kind, true);
      view.setUint32(ARGUMENT_VALUES_OFFSET + offset, valueEncoding.pointer, true);
      view.setUint32(ARGUMENT_VALUE_COUNT_OFFSET + offset, valueEncoding.count, true);
    }
    return descriptors;
  }

  #encodeValues(requestId, kind, value, allocations) {
    switch (kind) {
      case "int":
        return this.#encodeInts(requestId, [value], allocations);
      case "intArray":
        return this.#encodeInts(requestId, value, allocations);
      case "float":
        return this.#encodeFloats(requestId, [value], allocations);
      case "floatArray":
        return this.#encodeFloats(requestId, value, allocations);
      case "data":
        return this.#encodeData(requestId, value, allocations);
      case "node":
        return this.#encodeNodes(requestId, [value], allocations);
      case "nodeArray":
        return this.#encodeNodes(requestId, value, allocations);
      default:
        throw workerError(requestId, "invalid-argument", `unsupported argument kind: ${String(kind)}`);
    }
  }

  #encodeInts(requestId, values, allocations) {
    const list = requireNumberArray(values, requestId, "int");
    const pointer = this.#malloc(requestId, list.length * 8, "int argument values");
    allocations.push(pointer);
    const view = new DataView(this.#module.HEAPU8.buffer, pointer, list.length * 8);
    for (let index = 0; index < list.length; index += 1) {
      view.setBigInt64(index * 8, BigInt(list[index]), true);
    }
    return { kind: ARGUMENT_KIND_INT, pointer, count: list.length };
  }

  #encodeFloats(requestId, values, allocations) {
    const list = requireNumberArray(values, requestId, "float");
    const pointer = this.#malloc(requestId, list.length * 8, "float argument values");
    allocations.push(pointer);
    const view = new DataView(this.#module.HEAPU8.buffer, pointer, list.length * 8);
    for (let index = 0; index < list.length; index += 1) {
      view.setFloat64(index * 8, list[index], true);
    }
    return { kind: ARGUMENT_KIND_FLOAT, pointer, count: list.length };
  }

  #encodeData(requestId, value, allocations) {
    if (typeof value !== "string") {
      throw workerError(requestId, "invalid-argument", "data arguments must be strings");
    }
    const bytes = this.#utf8(value);
    const pointer = this.#storeBytes(requestId, bytes, allocations);
    return { kind: ARGUMENT_KIND_DATA, pointer, count: bytes.length };
  }

  #encodeNodes(requestId, values, allocations) {
    const list = requireTokenArray(values, requestId);
    const pointer = this.#malloc(requestId, list.length * 8, "node argument values");
    allocations.push(pointer);
    const view = new DataView(this.#module.HEAPU8.buffer, pointer, list.length * 8);
    for (let index = 0; index < list.length; index += 1) {
      view.setUint32(index * 8, list[index].slot, true);
      view.setUint32(index * 8 + 4, list[index].generation, true);
    }
    return { kind: ARGUMENT_KIND_NODE, pointer, count: list.length };
  }

  #storeBytes(requestId, bytes, allocations) {
    if (bytes.length === 0) {
      throw workerError(requestId, "invalid-argument", "empty byte spans are not accepted by the native ABI");
    }
    const pointer = this.#malloc(requestId, bytes.length, "byte span");
    allocations.push(pointer);
    this.#module.HEAPU8.set(bytes, pointer);
    return pointer;
  }

  #malloc(requestId, byteLength, label) {
    if (!Number.isSafeInteger(byteLength) || byteLength <= 0 || byteLength > 0xffff_ffff) {
      throw workerError(requestId, "invalid-argument", `${label} byte length is out of range`);
    }
    const pointer = this.#module._malloc(byteLength);
    if (pointer === 0) {
      throw workerError(requestId, "allocation-failed", `Emscripten could not allocate ${label}`);
    }
    return pointer;
  }

  #readU32(pointer) {
    return new DataView(this.#module.HEAPU8.buffer, pointer, 4).getUint32(0, true);
  }

  #readI64(pointer) {
    const value = new DataView(this.#module.HEAPU8.buffer, pointer, 8).getBigInt64(0, true);
    const converted = Number(value);
    if (!Number.isSafeInteger(converted)) {
      throw new Error("native i64 metadata exceeds JavaScript safe integer range");
    }
    return converted;
  }

  #readF64(pointer) {
    return new DataView(this.#module.HEAPU8.buffer, pointer, 8).getFloat64(0, true);
  }

  #readErrorMessage(errorBuffer) {
    const head = this.#module.HEAPU8[errorBuffer];
    if (head === 0) {
      return "";
    }
    const view = new DataView(this.#module.HEAPU8.buffer, errorBuffer, ERROR_BUFFER_SIZE);
    let length = 0;
    while (length < ERROR_BUFFER_SIZE && view.getUint8(length) !== 0) {
      length += 1;
    }
    const bytes = new Uint8Array(length);
    bytes.set(this.#module.HEAPU8.subarray(errorBuffer, errorBuffer + length));
    return new TextDecoder().decode(bytes);
  }

  #statusError(requestId, status, fallbackMessage) {
    const code = STATUS_CODES[status] ?? "upstream-error";
    const message = fallbackMessage || `VapourSynth upstream operation failed with status ${status}`;
    return workerError(requestId, code, message);
  }

  #requireToken(token, requestId) {
    if (!token || typeof token !== "object") {
      throw workerError(requestId, "invalid-handle", "an opaque handle token is required");
    }
    if (!isU32(token.slot) || !isU32(token.generation)) {
      throw workerError(requestId, "invalid-handle", "opaque handle tokens are (u32 slot, u32 generation) pairs");
    }
  }

  #requireName(value, requestId, label) {
    if (typeof value !== "string" || value.length === 0 || value.length > 64) {
      throw workerError(requestId, "invalid-argument", `${label} must be a non-empty string no longer than 64 bytes`);
    }
  }

  #requireFrameNumber(value, requestId) {
    if (!Number.isSafeInteger(value) || value < 0 || value > U32_MAX) {
      throw workerError(requestId, "invalid-frame", "frame number must be a u32");
    }
  }

  #assertOpen(requestId) {
    if (this.#closed) {
      throw workerError(requestId, "runtime-closed", "the Emscripten runtime is closed");
    }
    if (!this.#threading.available) {
      throw workerError(
        requestId,
        "threading-unavailable",
        `the ${this.#threading.compiled} runtime is unavailable: ${this.#threading.reason}`,
      );
    }
  }

  #utf8(value) {
    return new TextEncoder().encode(value);
  }
}
/**
 * Status-only runtime used when a threaded artifact cannot be instantiated
 * because the browser lacks its isolation prerequisites.
 */
export class UnavailableEmscriptenSession {
  #threading;
  #closed = false;

  constructor(threading) {
    if (!threading || threading.available !== false || threading.active !== THREADING_UNAVAILABLE) {
      throw new TypeError("an unavailable threading status is required");
    }
    this.#threading = threading;
  }

  status() {
    return JSON.stringify({
      schemaVersion: 1,
      upstreamLinked: false,
      workerProtocol: true,
      phase: "browser-worker-canvas",
      threading: this.#threading,
    });
  }

  core_create(requestId) { this.#reject(requestId); }
  core_release(requestId) { this.#reject(requestId); }
  invoke(requestId) { this.#reject(requestId); }
  node_get_frame(requestId) { this.#reject(requestId); }
  node_video_info(requestId) { this.#reject(requestId); }
  node_release(requestId) { this.#reject(requestId); }
  frame_dimensions(requestId) { this.#reject(requestId); }
  frame_timing(requestId) { this.#reject(requestId); }
  frame_rgba8_size(requestId) { this.#reject(requestId); }
  frame_copy_rgba8(requestId) { this.#reject(requestId); }
  frame_release(requestId) { this.#reject(requestId); }

  free() {
    this.#closed = true;
  }

  #reject(requestId) {
    if (this.#closed) {
      throw workerError(requestId, "runtime-closed", "the Emscripten runtime is closed");
    }
    throw workerError(
      requestId,
      "threading-unavailable",
      `the ${this.#threading.compiled} runtime is unavailable: ${this.#threading.reason}`,
    );
  }
}


function normalizeUploadBytes(value, requestId) {
  let bytes;
  if (value instanceof ArrayBuffer) {
    bytes = new Uint8Array(value);
  } else if (ArrayBuffer.isView(value)) {
    bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  } else {
    throw workerError(requestId, "invalid-frame", "source RGBA8 data must be an ArrayBuffer or typed-array view");
  }
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_RGBA_BYTES) {
    throw workerError(requestId, "invalid-frame", "source RGBA8 data must be between 1 byte and 16 MiB");
  }
  return bytes;
}

function requireU32(value, requestId, label) {
  if (!isU32(value)) {
    throw workerError(requestId, "invalid-argument", `${label} must be a u32`);
  }
  return value;
}

function requireI64(value, requestId, label) {
  if (!Number.isSafeInteger(value)) {
    throw workerError(requestId, "invalid-argument", `${label} must be a safe integer`);
  }
  return value;
}

function requireNumberArray(value, requestId, label) {
  if (!Array.isArray(value) || value.length === 0) {
    throw workerError(requestId, "invalid-argument", `${label} arguments need a non-empty value array`);
  }
  for (const item of value) {
    if (typeof item !== "number" || !Number.isFinite(item)) {
      throw workerError(requestId, "invalid-argument", `${label} argument values must be finite numbers`);
    }
  }
  return value;
}

function requireTokenArray(value, requestId) {
  if (!Array.isArray(value) || value.length === 0) {
    throw workerError(requestId, "invalid-argument", "node arguments need a non-empty value array");
  }
  for (const item of value) {
    if (!item || typeof item !== "object" || !isU32(item.slot) || !isU32(item.generation)) {
      throw workerError(requestId, "invalid-argument", "node argument values must be (u32 slot, u32 generation) tokens");
    }
  }
  return value;
}

function isU32(value) {
  return Number.isInteger(value) && value >= 0 && value <= U32_MAX;
}

function workerError(requestId, code, message) {
  const error = new Error(message);
  error.requestId = requestId;
  error.code = code;
  return error;
}
