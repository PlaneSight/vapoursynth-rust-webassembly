import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { loadPyodide } from "pyodide";

import { PyodideSession } from "./pyodide-session.mjs";

test("installs and executes the browser vapoursynth package in real Pyodide", { timeout: 120_000 }, async () => {
  const calls = [];
  let nextNodeId = 1;
  const workerClient = {
    async status() {
      return { schemaVersion: 1, upstreamLinked: true };
    },
    async createBlankClip(width, height, format, length) {
      calls.push(["createBlankClip", width, height, format, length]);
      return { nodeId: nextNodeId++ };
    },
    async invert(nodeId) {
      calls.push(["invert", nodeId]);
      return { nodeId: nextNodeId++ };
    },
    async setOutput(index, nodeId) {
      calls.push(["setOutput", index, nodeId]);
    },
    async releaseNode(nodeId) {
      calls.push(["releaseNode", nodeId]);
    },
    async resetGraph() {
      calls.push(["resetGraph"]);
    },
    async listOutputs() {
      calls.push(["listOutputs"]);
      return { outputs: [{ index: 0, width: 3, height: 2, format: "RGB24", length: 1 }] };
    },
    async renderOutput() {
      return { width: 3, height: 2, rgba: new ArrayBuffer(24) };
    },
  };
  const packageSource = await readFile(new URL("./python/vapoursynth.py", import.meta.url), "utf8");
  const pyodide = await loadPyodide();
  const session = new PyodideSession({ pyodide, workerClient, packageSource });
  await session.initialize();

  const result = await session.runScript(
    [
      "import vapoursynth as vs",
      "blank = await vs.core.std.BlankClip(width=3, height=2)",
      "inverted = await vs.core.std.Invert(blank)",
      "await vs.set_output(0, inverted)",
    ].join("\n"),
    "authoring.vpy",
  );

  assert.deepEqual(result, {
    outputs: [{ index: 0, width: 3, height: 2, format: "RGB24", length: 1 }],
  });
  assert.deepEqual(calls.slice(0, 5), [
    ["resetGraph"],
    ["createBlankClip", 3, 2, "RGB24", 1],
    ["invert", 1],
    ["setOutput", 0, 2],
    ["listOutputs"],
  ]);
  session.free();
});
