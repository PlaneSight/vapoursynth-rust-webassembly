import assert from "node:assert/strict";
import test from "node:test";

import { PyodideWorkerClient } from "./pyodide-worker-client.mjs";
import { installPyodideWorkerRuntime, startPyodideWorkerRuntime } from "./pyodide-worker-runtime.mjs";

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
  const main = {};
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
  });

  assert.equal(initialized, true);
  assert.equal(typeof scope.onmessage, "function");
  stop();
  assert.equal(nestedWorkerTerminated, true);
});
