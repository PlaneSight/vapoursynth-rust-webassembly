export class PyodideWorkerClient {
  #worker;
  #nextRequestId = 1;
  #pending = new Map();

  constructor(worker) {
    if (!worker || typeof worker.postMessage !== "function") {
      throw new TypeError("worker must provide postMessage()");
    }

    this.#worker = worker;
    worker.onmessage = ({ data }) => this.#settle(data);
    worker.onerror = (event) => this.#failAll(new Error(event?.message ?? "Pyodide worker failed"));
  }

  status() {
    return this.#request("status");
  }

  runScript(source, filename = "script.vpy") {
    return this.#request("runScript", { source, filename });
  }

  renderOutput(index, frame = 0) {
    return this.#request("renderOutput", { index, frame });
  }

  close() {
    this.#failAll(new Error("Pyodide worker client closed"));
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
      this.#failAll(new Error("Pyodide worker returned an invalid response envelope"));
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

    const error = new Error(message.error?.message ?? "Pyodide worker request failed");
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
