export class PyodideWorkerClient {
  #worker;
  #nextRequestId = 1;
  #pending = new Map();
  #onDiagnostic;
  #ready;
  #resolveReady;
  #rejectReady;
  #startupTimer;
  #readyState = "pending";
  #terminalError;

  constructor(worker, { onDiagnostic = () => {}, startupTimeoutMs = 60_000 } = {}) {
    if (!worker || typeof worker.postMessage !== "function") {
      throw new TypeError("worker must provide postMessage()");
    }
    if (typeof onDiagnostic !== "function") {
      throw new TypeError("onDiagnostic must be a function");
    }
    if (!Number.isFinite(startupTimeoutMs) || startupTimeoutMs <= 0) {
      throw new TypeError("startupTimeoutMs must be a positive number");
    }

    this.#worker = worker;
    this.#onDiagnostic = onDiagnostic;
    this.#ready = new Promise((resolve, reject) => {
      this.#resolveReady = resolve;
      this.#rejectReady = reject;
    });
    this.#ready.catch(() => {});
    this.#startupTimer = setTimeout(() => {
      this.#failAll(new Error(`Pyodide worker did not become ready within ${startupTimeoutMs} ms`));
      this.#worker.terminate?.();
    }, startupTimeoutMs);
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
    if (this.#readyState === "closed") {
      return;
    }
    this.#diagnostic("info", "worker", "Closing Pyodide worker client");
    this.#failAll(new Error("Pyodide worker client closed"));
    this.#readyState = "closed";
    this.#worker.terminate?.();
  }

  #request(type, payload = {}) {
    if (this.#terminalError) {
      return Promise.reject(this.#terminalError);
    }
    const requestId = this.#allocateRequestId();
    const startedAt = performance.now?.() ?? Date.now();
    if (this.#readyState === "pending") {
      this.#diagnostic("info", "request", `Queued ${type} #${requestId} until the worker is ready`);
    }
    return this.#ready.then(() => {
      if (this.#terminalError) {
        throw this.#terminalError;
      }
      const promise = new Promise((resolve, reject) => {
        this.#pending.set(requestId, { resolve, reject, type, startedAt });
      });
      this.#diagnostic("info", "request", `→ ${type} #${requestId}`);
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
    if (message?.schemaVersion === 1 && message.type === "diagnostic") {
      const diagnostic = message.diagnostic;
      if (diagnostic && typeof diagnostic.message === "string") {
        this.#diagnostic(
          diagnostic.level ?? "info",
          diagnostic.source ?? "worker-bootstrap",
          diagnostic.message,
          diagnostic.detail,
        );
      }
      return;
    }
    if (message?.schemaVersion === 1 && message.type === "ready") {
      this.#markReady();
      return;
    }
    if (message?.schemaVersion === 1 && message.type === "bootstrap-error") {
      const error = new Error(message.error?.message ?? "Pyodide worker bootstrap failed");
      error.code = message.error?.code ?? "worker-bootstrap-error";
      this.#diagnostic("error", "worker-bootstrap", error.message, message.error);
      this.#failAll(error);
      return;
    }

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

  #diagnostic(level, source, message, detail) {
    try {
      this.#onDiagnostic({ level, source, message, detail, timestamp: new Date().toISOString() });
    } catch {
      // Diagnostics must never interfere with worker protocol handling.
    }
  }

  #markReady() {
    if (this.#readyState !== "pending") {
      return;
    }
    clearTimeout(this.#startupTimer);
    this.#readyState = "ready";
    this.#diagnostic("info", "worker", "Pyodide worker ready");
    this.#resolveReady();
  }
}
