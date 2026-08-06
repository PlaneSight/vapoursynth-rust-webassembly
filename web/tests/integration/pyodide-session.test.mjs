import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { loadPyodide } from "pyodide";

import { PyodideSession } from "../../runtime/pyodide/session.mjs";

test("installs and executes the browser vapoursynth package in real Pyodide", { timeout: 120_000 }, async () => {
  const calls = [];
  const workerClient = {
    async status() {
      return { schemaVersion: 1, upstreamLinked: true };
    },
    async resetGraph() {
      calls.push(["resetGraph"]);
    },
    async executeGraph(plan) {
      calls.push(["executeGraph", plan]);
      return { outputs: [{ index: 0, width: 3, height: 2 }] };
    },
    async renderOutput() {
      return { width: 3, height: 2, rgba: new ArrayBuffer(24) };
    },
  };
  const packageSource = await readFile(new URL("../../python/vapoursynth.py", import.meta.url), "utf8");
  const pyodide = await loadPyodide();
  const session = new PyodideSession({ pyodide, workerClient, packageSource });
  await session.initialize();

  const result = await session.runScript(
    [
      "import vapoursynth as vs",
      "blank = vs.core.std.BlankClip(width=3, height=2)",
      "inverted = vs.core.std.Invert(blank)",
      "inverted.set_output(0)",
    ].join("\n"),
    "authoring.vpy",
  );

  assert.deepEqual(result, {
    outputs: [{ index: 0, width: 3, height: 2 }],
  });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], ["resetGraph"]);
  assert.equal(calls[1][0], "executeGraph");
  const plan = calls[1][1];
  assert.equal(plan.version, 1);
  assert.equal(plan.operations.length, 2);
  const [blank, invert] = plan.operations;
  assert.equal(blank.namespace, "std");
  assert.equal(blank.function, "BlankClip");
  assert.deepEqual(
    blank.arguments.filter(({ key }) => key === "width" || key === "height"),
    [
      { key: "width", kind: "int", value: 3 },
      { key: "height", kind: "int", value: 2 },
    ],
  );
  assert.equal(invert.namespace, "std");
  assert.equal(invert.function, "Invert");
  assert.deepEqual(invert.arguments, [{ key: "clip", kind: "node", value: blank.id }]);
  assert.deepEqual(plan.outputs, [{ index: 0, node: invert.id }]);
  session.free();
});
