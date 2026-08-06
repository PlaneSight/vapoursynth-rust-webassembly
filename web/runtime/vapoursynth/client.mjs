export class WorkerClient {
  #worker;
  #nextRequestId = 1;
  #pending = new Map();
  #ready;
  #resolveReady;
  #rejectReady;
  #startupTimer;
  #readyState = "pending";
  #terminalError;

  constructor(worker, { startupTimeoutMs = 60_000 } = {}) {
    if (!worker || typeof worker.postMessage !== "function") {
      throw new TypeError("worker must provide postMessage()");
    }
    if (!Number.isFinite(startupTimeoutMs) || startupTimeoutMs <= 0) {
      throw new TypeError("startupTimeoutMs must be a positive number");
    }

    this.#worker = worker;
    this.#ready = new Promise((resolve, reject) => {
      this.#resolveReady = resolve;
      this.#rejectReady = reject;
    });
    this.#ready.catch(() => {});
    this.#startupTimer = setTimeout(() => {
      this.#failAll(new Error(`VapourSynth worker did not become ready within ${startupTimeoutMs} ms`));
      this.#worker.terminate?.();
    }, startupTimeoutMs);
    worker.onmessage = ({ data }) => this.#settle(data);
    worker.onerror = (event) => this.#failAll(new Error(event?.message ?? "worker failed"));
  }

  status() {
    return this.#request("status");
  }

  /** Executes one graph plan; resolves with output metadata. */
  executeGraph(plan) {
    if (!plan || typeof plan !== "object" || Array.isArray(plan)) {
      return Promise.reject(Object.assign(new Error("plan must be an object"), { code: "invalid-plan" }));
    }
    return this.#request("executeGraph", { plan });
  }

  renderOutput(index, frame = 0) {
    return this.#request("renderOutput", { index, frame });
  }

  /** Releases every retained node and the active core. */
  resetGraph() {
    return this.#request("resetGraph");
  }

  close() {
    if (this.#readyState === "closed") {
      return;
    }
    this.#failAll(new Error("worker client closed"));
    this.#readyState = "closed";
    this.#worker.terminate?.();
  }

  #request(type, payload = {}) {
    if (this.#terminalError) {
      return Promise.reject(this.#terminalError);
    }
    const requestId = this.#allocateRequestId();
    return this.#ready.then(() => {
      if (this.#terminalError) {
        throw this.#terminalError;
      }
      const promise = new Promise((resolve, reject) => {
        this.#pending.set(requestId, { resolve, reject });
      });

      this.#worker.postMessage({ schemaVersion: 1, requestId, type, ...payload });
      return promise;
    });
  }

  #allocateRequestId() {
    const requestId = this.#nextRequestId;
    this.#nextRequestId = this.#nextRequestId === 0xffff_ffff ? 1 : this.#nextRequestId + 1;
    return requestId;
  }

  #settle(message) {
    if (message?.schemaVersion === 1 && message.type === "ready") {
      this.#markReady();
      return;
    }
    if (message?.schemaVersion === 1 && message.type === "bootstrap-error") {
      const error = new Error(message.error?.message ?? "VapourSynth worker bootstrap failed");
      error.code = message.error?.code ?? "worker-bootstrap-error";
      this.#failAll(error);
      return;
    }

    if (!message || message.schemaVersion !== 1 || !Number.isInteger(message.requestId)) {
      this.#failAll(new Error("worker returned an invalid response envelope"));
      return;
    }

    const pending = this.#pending.get(message.requestId);
    if (!pending) {
      return;
    }

    this.#pending.delete(message.requestId);
    if (message.ok) {
      pending.resolve(message.payload);
      return;
    }

    const error = new Error(message.error?.message ?? "worker request failed");
    error.code = message.error?.code ?? "worker-error";
    pending.reject(error);
  }

  #failAll(error) {
    clearTimeout(this.#startupTimer);
    this.#terminalError = error;
    if (this.#readyState === "pending") {
      this.#rejectReady(error);
    }
    if (this.#readyState !== "closed") {
      this.#readyState = "failed";
    }
    for (const pending of this.#pending.values()) {
      pending.reject(error);
    }
    this.#pending.clear();
  }

  #markReady() {
    if (this.#readyState !== "pending") {
      return;
    }
    clearTimeout(this.#startupTimer);
    this.#readyState = "ready";
    this.#resolveReady();
  }
}

export function drawRgbaFrame(canvas, frame) {
  if (!(frame?.rgba instanceof ArrayBuffer)) {
    throw new TypeError("frame.rgba must be an ArrayBuffer");
  }

  const context = canvas?.getContext?.("2d");
  if (!context) {
    throw new TypeError("canvas must provide a 2D context");
  }

  canvas.width = frame.width;
  canvas.height = frame.height;
  const pixels = new Uint8ClampedArray(frame.rgba);
  context.putImageData(new ImageData(pixels, frame.width, frame.height), 0, 0);
}
