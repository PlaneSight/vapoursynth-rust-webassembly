export class WorkerClient {
  #worker;
  #nextRequestId = 1;
  #pending = new Map();

  constructor(worker) {
    if (!worker || typeof worker.postMessage !== "function") {
      throw new TypeError("worker must provide postMessage()");
    }

    this.#worker = worker;
    worker.onmessage = ({ data }) => this.#settle(data);
    worker.onerror = (event) => this.#failAll(new Error(event?.message ?? "worker failed"));
  }

  status() {
    return this.#request("status");
  }

  renderBlankFrame(width, height) {
    return this.#request("renderBlankFrame", { width, height });
  }

  close() {
    this.#failAll(new Error("worker client closed"));
    this.#worker.terminate?.();
  }

  #request(type, payload = {}) {
    const requestId = this.#allocateRequestId();
    const promise = new Promise((resolve, reject) => {
      this.#pending.set(requestId, { resolve, reject });
    });

    this.#worker.postMessage({ schemaVersion: 1, requestId, type, ...payload });
    return promise;
  }

  #allocateRequestId() {
    const requestId = this.#nextRequestId;
    this.#nextRequestId = this.#nextRequestId === 0xffff_ffff ? 1 : this.#nextRequestId + 1;
    return requestId;
  }

  #settle(message) {
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
    for (const pending of this.#pending.values()) {
      pending.reject(error);
    }
    this.#pending.clear();
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
