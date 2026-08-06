import assert from "node:assert/strict";
import test from "node:test";

import { AuthoringSession } from "../../runtime/vapoursynth/session.mjs";
import { createWorkerHandler } from "../../protocol/vapoursynth.mjs";

const RGB24_FORMAT_ID = 2_000_010;

const PLAN = {
  version: 1,
  operations: [
    {
      id: 1,
      namespace: "std",
      function: "BlankClip",
      arguments: [
        { key: "width", kind: "int", value: 320 },
        { key: "height", kind: "int", value: 180 },
        { key: "format", kind: "int", value: RGB24_FORMAT_ID },
        { key: "color", kind: "intArray", value: [32, 96, 224] },
      ],
    },
    {
      id: 2,
      namespace: "std",
      function: "Invert",
      arguments: [{ key: "clip", kind: "node", value: 1 }],
    },
  ],
  outputs: [{ index: 0, node: 2 }],
};

function fakeSession(overrides = {}) {
  return {
    status() {
      return JSON.stringify({
        schemaVersion: 1,
        upstreamLinked: false,
        workerProtocol: true,
      });
    },
    execute_graph(_requestId, plan) {
      return { outputs: plan.outputs.map((output) => ({ index: output.index, width: 320, height: 180 })) };
    },
    render_output(_requestId, index, frame) {
      return {
        width: index + 1,
        height: frame + 1,
        rgba: new Uint8Array((index + 1) * (frame + 1) * 4).fill(255),
      };
    },
    reset_graph() {},
    ...overrides,
  };
}

function emulatedSession() {
  const runtime = {
    status() {
      return JSON.stringify({ schemaVersion: 1, upstreamLinked: true });
    },
    core_create() {
      return { slot: 1, generation: 1 };
    },
    core_release() {},
    invoke() {
      return { slot: 10, generation: 1 };
    },
    node_get_frame() {
      return { slot: 20, generation: 1 };
    },
    node_release() {},
    frame_dimensions() {
      return { width: 320, height: 180 };
    },
    frame_rgba8_size() {
      return 320 * 180 * 4;
    },
    frame_copy_rgba8() {
      return new Uint8Array(320 * 180 * 4).fill(223);
    },
    frame_release() {},
    free() {},
  };
  return new AuthoringSession(runtime);
}

test("reports worker capabilities with request correlation", async () => {
  const handle = createWorkerHandler(fakeSession());
  const response = await handle({ requestId: 7, type: "status" });

  assert.deepEqual(response, {
    message: {
      schemaVersion: 1,
      requestId: 7,
      ok: true,
      type: "status",
      payload: {
        schemaVersion: 1,
        upstreamLinked: false,
        workerProtocol: true,
      },
    },
    transfer: [],
  });
});

test("executes a graph plan and returns output metadata", async () => {
  const handle = createWorkerHandler(fakeSession());
  const response = await handle({ requestId: 9, type: "executeGraph", plan: PLAN });

  assert.deepEqual(response, {
    message: {
      schemaVersion: 1,
      requestId: 9,
      ok: true,
      type: "outputs",
      payload: { outputs: [{ index: 0, width: 320, height: 180 }] },
    },
    transfer: [],
  });
});

test("rejects malformed plan envelopes before calling the runtime", async () => {
  let called = false;
  const handle = createWorkerHandler(fakeSession({
    execute_graph() {
      called = true;
      return { outputs: [] };
    },
  }));

  for (const plan of [null, undefined, 7, "plan", []]) {
    await assert.rejects(
      () => handle({ requestId: 11, type: "executeGraph", plan }),
      (error) => error.code === "invalid-plan",
    );
  }
  assert.equal(called, false);
});

test("deeply validates plans through the emulated session", async () => {
  const handle = createWorkerHandler(emulatedSession());
  const badPlan = {
    version: 1,
    operations: [{ id: 1, namespace: "std", function: "Invert", arguments: [{ key: "clip", kind: "node", value: 99 }] }],
    outputs: [],
  };

  const response = await handle({ requestId: 12, type: "executeGraph", plan: badPlan });
  assert.deepEqual(response.message, {
    schemaVersion: 1,
    requestId: 12,
    ok: false,
    error: { code: "unknown-node", message: "node reference 99 is unknown" },
  });
  assert.deepEqual(response.transfer, []);
});

test("returns frame bytes as a transferable ArrayBuffer", async () => {
  const handle = createWorkerHandler(emulatedSession());
  await handle({ requestId: 9, type: "executeGraph", plan: PLAN });
  const response = await handle({ requestId: 13, type: "renderOutput", index: 0, frame: 0 });

  assert.equal(response.message.ok, true);
  assert.equal(response.message.type, "frame");
  assert.equal(response.message.payload.width, 320);
  assert.equal(response.message.payload.height, 180);
  assert.ok(response.message.payload.rgba instanceof ArrayBuffer);
  assert.equal(response.message.payload.rgba.byteLength, 320 * 180 * 4);
  assert.deepEqual(response.transfer, [response.message.payload.rgba]);
});

test("normalizes structured wasm errors", async () => {
  const handle = createWorkerHandler(fakeSession({
    render_output() {
      throw JSON.stringify({
        schemaVersion: 1,
        requestId: 11,
        ok: false,
        error: {
          code: "runtime-unavailable",
          message: "the Emscripten runtime is not attached",
        },
      });
    },
  }));

  const response = await handle({
    requestId: 11,
    type: "renderOutput",
    index: 0,
    frame: 0,
  });

  assert.deepEqual(response, {
    message: {
      schemaVersion: 1,
      requestId: 11,
      ok: false,
      error: {
        code: "runtime-unavailable",
        message: "the Emscripten runtime is not attached",
      },
    },
    transfer: [],
  });
});

test("rejects unsupported request types deterministically", async () => {
  const handle = createWorkerHandler(fakeSession());
  const response = await handle({ requestId: 15, type: "openVideo" });

  assert.deepEqual(response.message, {
    schemaVersion: 1,
    requestId: 15,
    ok: false,
    error: {
      code: "unsupported-request",
      message: "unsupported request type: openVideo",
    },
  });
});

test("rejects stale bespoke RPC request types", async () => {
  const handle = createWorkerHandler(fakeSession());

  for (const type of ["createBlankClip", "invert", "setOutput", "listOutputs", "releaseNode", "renderBlankFrame"]) {
    const response = await handle({ requestId: 16, type, width: 1, height: 1, nodeId: 1, index: 0 });
    assert.equal(response.message.ok, false, `expected ${type} to be rejected`);
    assert.equal(response.message.error.code, "unsupported-request");
  }
});

test("resets the worker graph through the protocol", async () => {
  let reset = 0;
  const handle = createWorkerHandler(fakeSession({
    reset_graph() {
      reset += 1;
    },
  }));

  const response = await handle({ requestId: 17, type: "resetGraph" });
  assert.deepEqual(response.message, {
    schemaVersion: 1,
    requestId: 17,
    ok: true,
    type: "reset",
    payload: {},
  });
  assert.equal(reset, 1);
});
