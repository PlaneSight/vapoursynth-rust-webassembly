const STATUS_OK = 0;

export class EmscriptenSession {
  #module;
  #closed = false;

  constructor(module) {
    if (!module || typeof module._malloc !== "function" || typeof module._free !== "function" || typeof module._vs_rust_render_inverted_blank !== "function") {
      throw new TypeError("Emscripten module is missing required VapourSynth exports");
    }
    this.#module = module;
  }

  status() {
    return JSON.stringify({
      schemaVersion: 1,
      upstreamLinked: !this.#closed,
      workerProtocol: true,
      phase: "browser-worker-canvas",
    });
  }

  render_blank_frame(requestId, width, height) {
    this.#assertOpen(requestId);
    const byteLength = checkedRgbaByteLength(width, height, requestId);
    const output = this.#module._malloc(byteLength);
    if (output === 0) {
      throw workerError(requestId, "allocation-failed", "Emscripten could not allocate the frame buffer");
    }

    try {
      const status = this.#module._vs_rust_render_inverted_blank(width, height, output, byteLength);
      if (status !== STATUS_OK) {
        throw workerError(requestId, "upstream-error", `VapourSynth render failed with status ${status}`);
      }
      return this.#module.HEAPU8.slice(output, output + byteLength);
    } finally {
      this.#module._free(output);
    }
  }

  free() {
    this.#closed = true;
    this.#module = null;
  }

  #assertOpen(requestId) {
    if (this.#closed) {
      throw workerError(requestId, "runtime-closed", "the Emscripten runtime is closed");
    }
  }
}

function checkedRgbaByteLength(width, height, requestId) {
  const bytes = width * height * 4;
  if (!Number.isSafeInteger(bytes) || bytes <= 0 || bytes > 0xffff_ffff) {
    throw workerError(requestId, "invalid-dimensions", "RGBA8 byte length exceeds the worker protocol limit");
  }
  return bytes;
}

function workerError(requestId, code, message) {
  return JSON.stringify({
    schemaVersion: 1,
    requestId,
    ok: false,
    error: { code, message },
  });
}
