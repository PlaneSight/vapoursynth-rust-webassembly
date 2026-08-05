import assert from "node:assert/strict";
import test from "node:test";

import { createPyodideRpc } from "../../protocol/pyodide.mjs";

test("maps Python-facing RPC calls onto opaque worker-client operations", async () => {
  const calls = [];
  const rpc = createPyodideRpc({
    async createBlankClip(width, height, format, length) {
      calls.push(["createBlankClip", width, height, format, length]);
      return { nodeId: 4 };
    },
    async invert(nodeId) {
      calls.push(["invert", nodeId]);
      return { nodeId: 5 };
    },
    async setOutput(index, nodeId) {
      calls.push(["setOutput", index, nodeId]);
    },
    async releaseNode(nodeId) {
      calls.push(["releaseNode", nodeId]);
    },
  });

  assert.equal(await rpc.create_blank_clip(3, 2, "RGB24", 1), 4);
  assert.equal(await rpc.invert(4), 5);
  await rpc.set_output(0, 5);
  await rpc.release_node(4);
  rpc.release_node_later(5);
  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(calls, [
    ["createBlankClip", 3, 2, "RGB24", 1],
    ["invert", 4],
    ["setOutput", 0, 5],
    ["releaseNode", 4],
    ["releaseNode", 5],
  ]);
});

test("rejects malformed worker token responses", async () => {
  const rpc = createPyodideRpc({
    async createBlankClip() {
      return { nodeId: 0 };
    },
    async invert() {
      return { nodeId: 1 };
    },
    async setOutput() {},
    async releaseNode() {},
  });

  await assert.rejects(
    () => rpc.create_blank_clip(1, 1, "RGB24", 1),
    (error) => error.code === "rpc-protocol",
  );
});
