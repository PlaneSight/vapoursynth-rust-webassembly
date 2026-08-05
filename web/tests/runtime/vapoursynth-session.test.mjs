import assert from "node:assert/strict";
import test from "node:test";

import { AuthoringSession } from "../../runtime/vapoursynth/session.mjs";

function runtime() {
  return {
    status() {
      return JSON.stringify({ schemaVersion: 1, upstreamLinked: true });
    },
    render_blank_frame(_requestId, width, height) {
      return new Uint8Array(width * height * 4).fill(255);
    },
  };
}

test("retains an authoring graph after its public node tokens are released", async () => {
  const session = new AuthoringSession(runtime());
  const blank = session.create_blank_clip(1, 3, 2, "RGB24", 1);
  const inverted = session.invert(2, blank.nodeId);

  assert.deepEqual(session.set_output(3, 0, inverted.nodeId), {
    index: 0,
    width: 3,
    height: 2,
    format: "RGB24",
    length: 1,
  });
  session.release_node(4, blank.nodeId);
  session.release_node(5, inverted.nodeId);

  const frame = await session.render_output(6, 0, 0);
  assert.equal(frame.width, 3);
  assert.equal(frame.height, 2);
  assert.deepEqual(frame.rgba, new Uint8Array(24).fill(255));
});

test("rejects unsupported browser graphs and format claims explicitly", () => {
  const session = new AuthoringSession(runtime());

  assert.throws(
    () => session.create_blank_clip(1, 1, 1, "YUV420P8", 1),
    (error) => error.code === "unsupported-format",
  );

  const blank = session.create_blank_clip(2, 1, 1, "RGB24", 1);
  const inverted = session.invert(3, blank.nodeId);
  assert.throws(
    () => session.invert(4, inverted.nodeId),
    (error) => error.code === "unsupported-graph",
  );

  session.set_output(5, 0, blank.nodeId);
  assert.rejects(
    () => session.render_output(6, 0, 0),
    (error) => error.code === "unsupported-graph",
  );
});

test("status advertises the exact authoring subset", () => {
  const session = new AuthoringSession(runtime());
  const status = JSON.parse(session.status());

  assert.deepEqual(status.authoring, {
    available: true,
    format: "RGB24",
    functions: ["std.BlankClip", "std.Invert"],
    singleFrameOnly: true,
  });
});
