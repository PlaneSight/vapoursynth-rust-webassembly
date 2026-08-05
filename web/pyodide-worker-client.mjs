export class PyodideWorkerClient {
  #worker;
  #nextRequestId = 1;
  #pending = new Map();
  #onDiagnostic;

  constructor(worker, { onDiagnostic = () => {} } = {}) {
    if (!worker || typeof worker.postMessage !== "function") {
      throw new TypeError("worker must provide postMessage()");
    }
    if (typeof onDiagnostic !== "function") {
      throw new TypeError("onDiagnostic must be a function");
    }

    this.#worker = worker;
    this.#onDiagnostic = onDiagnostic;
    worker.onmessage = ({ data }) => this.#settle(data);
    worker.onerror = (event) => {
      const error = new Error(event?.message ?? "Pyodide worker failed");
      this.#diagnostic("error", "worker", error.message, {
        filename: event?.filename,
        lineno: event?.lineno,
        colno: event?.colno,
      });
      this.#failAll(error);
    };
    worker.onmessageerror = () => {
      const error = new Error("Pyodide worker returned an unreadable message");
      this.#diagnostic("error", "worker", error.message);
      this.#failAll(error);
    };
    this.#diagnostic("info", "worker", "Pyodide worker created");
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
    this.#diagnostic("info", "worker", "Closing Pyodide worker client");
    this.#failAll(new Error("Pyodide worker client closed"));
    this.#worker.terminate?.();
  }

  #request(type, payload = {}) {
    const requestId = this.#allocateRequestId();
    const startedAt = performance.now?.() ?? Date.now();
    const promise = new Promise((resolve, reject) => {
      this.#pending.set(requestId, { resolve, reject, type, startedAt });
    });
    this.#diagnostic("info", "request", `→ ${type} #${requestId}`);
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
      const error = new Error("Pyodide worker returned an invalid response envelope");
      this.#diagnostic("error", "protocol", error.message, message);
      this.#failAll(error);
      return;
    }

    const pending = this.#pending.get(message.requestId);
    if (!pending) {
      this.#diagnostic("warn", "protocol", `Ignoring response for unknown request #${message.requestId}`);
      return;
    }
    this.#pending.delete(message.requestId);
    const elapsed = Math.round((performance.now?.() ?? Date.now()) - pending.startedAt);
    if (message.ok) {
      this.#diagnostic("info", "request", `← ${pending.type} #${message.requestId} (${elapsed} ms)`);
      pending.resolve(message.payload);
      return;
    }

    const error = new Error(message.error?.message ?? "Pyodide worker request failed");
    error.code = message.error?.code ?? "worker-error";
    this.#diagnostic("error", "request", `← ${pending.type} #${message.requestId}: ${error.code}: ${error.message}`, message.error);
    pending.reject(error);
  }

  #failAll(error) {
    for (const pending of this.#pending.values()) {
      pending.reject(error);
    }
    this.#pending.clear();
  }

  #diagnostic(level, source, message, detail) {
    try {
      this.#onDiagnostic({ level, source, message, detail, timestamp: new Date().toISOString() });
    } catch {
      // Diagnostics must never interfere with worker protocol handling.
    }
  }
}
