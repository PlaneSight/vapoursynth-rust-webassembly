import assert from "node:assert/strict";
import test from "node:test";

import { AuthoringSession } from "../../runtime/vapoursynth/session.mjs";
import { createWorkerHandler } from "../../protocol/vapoursynth.mjs";

function fakeSession(overrides = {}) {
  return {
    status() {
      return JSON.stringify({
        schemaVersion: 1,
        upstreamLinked: false,
        workerProtocol: true,
      });
    },
    render_blank_frame(_requestId, width, height) {
      return new Uint8Array(width * height * 4).fill(255);
    },
    ...overrides,
  };
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

test("returns frame bytes as a transferable ArrayBuffer", async () => {
  const handle = createWorkerHandler(fakeSession());
  const response = await handle({
    requestId: 9,
    type: "renderBlankFrame",
    width: 3,
    height: 2,
  });

  assert.equal(response.message.ok, true);
  assert.equal(response.message.type, "frame");
  assert.equal(response.message.payload.width, 3);
  assert.equal(response.message.payload.height, 2);
  assert.ok(response.message.payload.rgba instanceof ArrayBuffer);
  assert.equal(response.message.payload.rgba.byteLength, 24);
  assert.deepEqual(response.transfer, [response.message.payload.rgba]);
});

test("rejects malformed requests before calling the runtime", async () => {
  let called = false;
  const handle = createWorkerHandler(fakeSession({
    render_blank_frame() {
      called = true;
      return new Uint8Array();
    },
  }));

  await assert.rejects(
    () => handle({ requestId: 0, type: "renderBlankFrame", width: 1, height: 1 }),
    (error) => error.code === "invalid-request",
  );
  assert.equal(called, false);
});

test("normalizes structured wasm errors", async () => {
  const handle = createWorkerHandler(fakeSession({
    render_blank_frame() {
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
    type: "renderBlankFrame",
    width: 1,
    height: 1,
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

test("moves opaque authoring nodes through the worker protocol", async () => {
  const handle = createWorkerHandler(new AuthoringSession(fakeSession()));
  const blank = await handle({
    requestId: 20,
    type: "createBlankClip",
    width: 3,
    height: 2,
    format: "RGB24",
    length: 1,
  });
  const inverted = await handle({
    requestId: 21,
    type: "invert",
    nodeId: blank.message.payload.nodeId,
  });
  const output = await handle({
    requestId: 22,
    type: "setOutput",
    index: 0,
    nodeId: inverted.message.payload.nodeId,
  });
  const frame = await handle({
    requestId: 23,
    type: "renderOutput",
    index: 0,
    frame: 0,
  });

  assert.equal(blank.message.type, "node");
  assert.equal(inverted.message.type, "node");
  assert.deepEqual(output.message.payload, {
    index: 0,
    width: 3,
    height: 2,
    format: "RGB24",
    length: 1,
  });
  assert.equal(frame.message.type, "frame");
  assert.equal(frame.message.payload.rgba.byteLength, 24);
  assert.deepEqual(frame.transfer, [frame.message.payload.rgba]);
});
