import assert from "node:assert/strict";
import test from "node:test";

import { WorkerClient } from "../../runtime/vapoursynth/client.mjs";
import { startVapourSynthWorker } from "../../runtime/vapoursynth/bootstrap.mjs";
import { installWorkerRuntime, startWorkerRuntime } from "../../runtime/vapoursynth/worker.mjs";
const PLAN = {
  version: 1,
  operations: [
    { id: 1, namespace: "std", function: "BlankClip", arguments: [{ key: "width", kind: "int", value: 3 }] },
  ],
  outputs: [{ index: 0, node: 1 }],
};

function session() {
  return {
    status() {
      return JSON.stringify({ schemaVersion: 1, upstreamLinked: false });
    },
    execute_graph(_requestId, plan) {
      return { outputs: plan.outputs.map((output) => ({ index: output.index, width: 3, height: 2 })) };
    },
    render_output(_requestId, index, frame) {
      return {
        width: index + 1,
        height: frame + 1,
        rgba: new Uint8Array((index + 1) * (frame + 1) * 4).fill(255),
      };
    },
    reset_graph() {},
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
  installWorkerRuntime(workerScope, session());
  return main;
}

test("boots a host module into a worker-owned session", async () => {
  const scope = { postMessage() {} };
  let constructed = 0;
  await startWorkerRuntime({
    scope,
    loadHost: async () => ({
      WorkerSession: class {
        constructor() {
          constructed += 1;
        }
        status() {
          return "{}";
        }
        execute_graph() {
          return { outputs: [] };
        }
        render_output() {
          return { width: 1, height: 1, rgba: new Uint8Array(4) };
        }
        reset_graph() {}
      },
    }),
  });

  assert.equal(constructed, 1);
  assert.equal(typeof scope.onmessage, "function");
});

test("correlates concurrent status and graph requests", async () => {
  const client = new WorkerClient(linkedWorker());
  const [status, outputs] = await Promise.all([
    client.status(),
    client.executeGraph(PLAN),
  ]);

  assert.equal(status.upstreamLinked, false);
  assert.deepEqual(outputs.outputs, [{ index: 0, width: 3, height: 2 }]);
  client.close();
});

test("executes a graph and renders the requested frame round-trip", async () => {
  const client = new WorkerClient(linkedWorker());
  const outputs = await client.executeGraph(PLAN);
  const frame = await client.renderOutput(outputs.outputs[0].index, 1);

  assert.equal(frame.width, 1);
  assert.equal(frame.height, 2);
  assert.equal(frame.rgba.byteLength, 8);
  client.close();
});

test("holds requests until the worker readiness handshake", async () => {
  const posted = [];
  const worker = {
    postMessage(message) {
      posted.push(message);
    },
    terminate() {},
  };
  const client = new WorkerClient(worker);
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

test("rejects non-object plans client-side instead of hanging", async () => {
  const client = new WorkerClient(linkedWorker());

  await assert.rejects(
    () => client.executeGraph(null),
    (error) => error.code === "invalid-plan",
  );
  client.close();
});

test("correlates malformed client requests so they reject instead of hanging", async () => {
  const client = new WorkerClient(linkedWorker());

  await assert.rejects(
    () => client.renderOutput(0, -1),
    (error) => error.code === "invalid-output",
  );
  client.close();
});

test("releases the worker-owned session during shutdown", () => {
  let freed = false;
  let closed = false;
  const scope = {
    postMessage() {},
    close() {
      closed = true;
    },
  };
  const stop = installWorkerRuntime(scope, {
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

test("reports unavailable threaded startup without creating the pthread module", async () => {
  const posted = [];
  let moduleLoaded = false;
  const scope = {
    postMessage(message) {
      posted.push(message);
    },
  };

  await startVapourSynthWorker({
    scope,
    compiledMode: "threaded",
    crossOriginIsolated: false,
    sharedArrayBufferAvailable: true,
    loadModule: async () => {
      moduleLoaded = true;
      throw new Error("shared WebAssembly memory should not be created");
    },
  });

  assert.equal(moduleLoaded, false);
  assert.deepEqual(posted.shift(), { schemaVersion: 1, type: "ready" });
  await scope.onmessage({
    data: { schemaVersion: 1, requestId: 1, type: "status" },
  });

  const response = posted.shift();
  assert.equal(response.ok, true);
  assert.equal(response.payload.threading.active, "unavailable");
  assert.equal(response.payload.threading.reason, "cross-origin-isolation-required");
});
