import assert from "node:assert/strict";
import test from "node:test";

import { PyodideWorkerClient } from "../../runtime/pyodide/client.mjs";
import { installPyodideWorkerRuntime, startPyodideWorkerRuntime } from "../../runtime/pyodide/worker.mjs";

function session() {
  return {
    async status() {
      return { schemaVersion: 1, pyodide: { initialized: true } };
    },
    async runScript(source, filename) {
      return {
        outputs: [{ index: 0, width: source.length, height: filename.length, format: "RGB24", length: 1 }],
      };
    },
    async renderOutput(index, frame) {
      return {
        width: index + 1,
        height: frame + 1,
        rgba: new Uint8Array((index + 1) * (frame + 1) * 4).fill(255),
      };
    },
  };
}

function linkedWorker() {
  let onmessage;
  const main = {
    get onmessage() {
      return onmessage;
    },
    set onmessage(handler) {
      onmessage = handler;
      queueMicrotask(() => handler({ data: { schemaVersion: 1, type: "ready" } }));
    },
  };
  const workerScope = {
    postMessage(data) {
      queueMicrotask(() => main.onmessage?.({ data }));
    },
  };
  main.postMessage = (data) => queueMicrotask(() => workerScope.onmessage?.({ data }));
  main.terminate = () => {};
  installPyodideWorkerRuntime(workerScope, session());
  return main;
}

test("correlates Python script and frame requests through the outer worker", async () => {
  const client = new PyodideWorkerClient(linkedWorker());
  const [status, outputs, frame] = await Promise.all([
    client.status(),
    client.runScript("x = 1", "author.vpy"),
    client.renderOutput(1, 2),
  ]);

  assert.equal(status.pyodide.initialized, true);
  assert.deepEqual(outputs.outputs, [{ index: 0, width: 5, height: 10, format: "RGB24", length: 1 }]);
  assert.equal(frame.width, 2);
  assert.equal(frame.height, 3);
  assert.equal(frame.rgba.byteLength, 24);
  client.close();
});

test("returns structured errors from the Python worker runtime", async () => {
  const client = new PyodideWorkerClient(linkedWorker());

  await assert.rejects(
    () => client.renderOutput(-1, 0),
    (error) => error.code === "invalid-output",
  );
  client.close();
});

test("enforces script source and filename limits at the worker protocol boundary", async () => {
  const client = new PyodideWorkerClient(linkedWorker());

  await assert.rejects(
    () => client.runScript("x".repeat(1_000_001)),
    (error) => error.code === "invalid-script",
  );
  await assert.rejects(
    () => client.runScript("x = 1", "x".repeat(257)),
    (error) => error.code === "invalid-script",
  );
  client.close();
});

test("releases the Pyodide session and worker scope on shutdown", () => {
  let freed = false;
  let closed = false;
  const scope = {
    postMessage() {},
    close() {
      closed = true;
    },
  };
  const stop = installPyodideWorkerRuntime(scope, {
    ...session(),
    free() {
      freed = true;
    },
  });

  stop();
  assert.equal(scope.onmessage, null);
  assert.equal(freed, true);
  assert.equal(closed, true);
});

test("starts the nested VapourSynth worker before installing the Python worker handler", async () => {
  let nestedWorkerTerminated = false;
  let initialized = false;
  const diagnostics = [];
  const scope = { postMessage() {} };
  const stop = await startPyodideWorkerRuntime({
    scope,
    async loadPyodide() {
      return {
        registerJsModule() {},
        unregisterJsModule() {},
        async runPythonAsync() {
          initialized = true;
        },
      };
    },
    createVapourSynthWorker() {
      return {
        postMessage() {},
        terminate() {
          nestedWorkerTerminated = true;
        },
      };
    },
    async loadPackageSource() {
      return "import _vapoursynth_rpc";
    },
    onDiagnostic(message) {
      diagnostics.push(message);
    },
  });

  assert.equal(initialized, true);
  assert.equal(typeof scope.onmessage, "function");
  assert.deepEqual(diagnostics, [
    "Creating nested VapourSynth worker",
    "Pyodide loaded",
    "Python authoring package loaded",
    "Initializing Python authoring session",
    "Python authoring session initialized",
  ]);
  stop();
  assert.equal(nestedWorkerTerminated, true);
});

test("forwards worker bootstrap diagnostics without treating them as responses", () => {
  const diagnostics = [];
  const worker = {
    postMessage() {},
    terminate() {},
  };
  const client = new PyodideWorkerClient(worker, {
    onDiagnostic(diagnostic) {
      diagnostics.push(diagnostic);
    },
  });

  worker.onmessage({
    data: {
      schemaVersion: 1,
      type: "diagnostic",
      diagnostic: {
        level: "info",
        source: "worker-bootstrap",
        message: "Pyodide loaded",
      },
    },
  });

  assert.equal(diagnostics.at(-1).message, "Pyodide loaded");
  assert.equal(diagnostics.at(-1).source, "worker-bootstrap");
  client.close();
});

test("holds Python requests until the outer worker readiness handshake", async () => {
  const posted = [];
  const worker = {
    postMessage(message) {
      posted.push(message);
    },
    terminate() {},
  };
  const client = new PyodideWorkerClient(worker);
  const status = client.status();

  await Promise.resolve();
  assert.equal(posted.length, 0);

  worker.onmessage({ data: { schemaVersion: 1, type: "ready" } });
  await Promise.resolve();
  assert.equal(posted.length, 1);
  worker.onmessage({
    data: {
      schemaVersion: 1,
      requestId: posted[0].requestId,
      ok: true,
      payload: { upstreamLinked: true },
    },
  });

  assert.equal((await status).upstreamLinked, true);
  client.close();
});

test("terminates a CPU-bound Pyodide worker from the parent-side script deadline", async () => {
  const posted = [];
  let terminations = 0;
  const worker = {
    postMessage(message) {
      posted.push(message);
    },
    terminate() {
      terminations += 1;
    },
  };
  const client = new PyodideWorkerClient(worker, { scriptTimeoutMs: 20 });
  worker.onmessage({ data: { schemaVersion: 1, type: "ready" } });

  await assert.rejects(
    () => client.runScript("while True:\n    pass"),
    (error) => error.code === "script-timeout" && error.message.includes("20 ms"),
  );
  assert.equal(posted.length, 1);
  assert.equal(posted[0].type, "runScript");
  assert.equal(terminations, 1);
  await assert.rejects(
    () => client.status(),
    (error) => error.code === "script-timeout",
  );
});
