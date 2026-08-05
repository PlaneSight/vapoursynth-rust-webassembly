import assert from "node:assert/strict";
import test from "node:test";

import { WorkerClient } from "../../runtime/vapoursynth/client.mjs";
import { installWorkerRuntime, startWorkerRuntime } from "../../runtime/vapoursynth/worker-runtime.mjs";

function session() {
  return {
    status() {
      return JSON.stringify({ schemaVersion: 1, upstreamLinked: false });
    },
    render_blank_frame(_requestId, width, height) {
      return new Uint8Array(width * height * 4).fill(255);
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
        render_blank_frame() {
          return new Uint8Array();
        }
      },
    }),
  });

  assert.equal(constructed, 1);
  assert.equal(typeof scope.onmessage, "function");
});

test("correlates concurrent client requests", async () => {
  const client = new WorkerClient(linkedWorker());
  const [status, frame] = await Promise.all([
    client.status(),
    client.renderBlankFrame(2, 2),
  ]);

  assert.equal(status.upstreamLinked, false);
  assert.equal(frame.width, 2);
  assert.equal(frame.height, 2);
  assert.equal(frame.rgba.byteLength, 16);
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

test("correlates malformed client requests so they reject instead of hanging", async () => {
  const client = new WorkerClient(linkedWorker());

  await assert.rejects(
    () => client.renderBlankFrame(0, 1),
    (error) => error.code === "invalid-dimensions",
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
