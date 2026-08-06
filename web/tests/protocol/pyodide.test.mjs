import assert from "node:assert/strict";
import test from "node:test";

import {
  createPyodideWorkerHandler,
  MAX_PLAN_ARGUMENTS,
  MAX_PLAN_ARRAY_LENGTH,
  MAX_PLAN_OPERATIONS,
  MAX_PLAN_OUTPUTS,
  validateDrainedPlan,
} from "../../protocol/pyodide.mjs";

function recordingSession() {
  const calls = [];
  return {
    calls,
    async status() {
      calls.push(["status"]);
      return { schemaVersion: 1, pyodide: { initialized: true } };
    },
    async runScript(source, filename) {
      calls.push(["runScript", source, filename]);
      return {
        outputs: [{ index: 0, width: 2, height: 3, format: "RGB24", length: 1 }],
      };
    },
    async renderOutput(index, frame) {
      calls.push(["renderOutput", index, frame]);
      return {
        width: 4,
        height: 5,
        rgba: new Uint8Array(80).fill(9),
      };
    },
  };
}

test("maps Python worker requests onto session operations", async () => {
  const handle = createPyodideWorkerHandler(recordingSession());

  const status = await handle({ schemaVersion: 1, requestId: 1, type: "status" });
  assert.equal(status.message.ok, true);
  assert.equal(status.message.type, "status");
  assert.deepEqual(status.message.payload, {
    schemaVersion: 1,
    pyodide: { initialized: true },
  });
  assert.deepEqual(status.transfer, []);

  const outputs = await handle({
    schemaVersion: 1,
    requestId: 2,
    type: "runScript",
    source: "x = 1",
    filename: "author.vpy",
  });
  assert.equal(outputs.message.ok, true);
  assert.deepEqual(outputs.message.payload.outputs, [
    { index: 0, width: 2, height: 3, format: "RGB24", length: 1 },
  ]);
  assert.deepEqual(outputs.transfer, []);

  const frame = await handle({
    schemaVersion: 1,
    requestId: 3,
    type: "renderOutput",
    index: 0,
    frame: 1,
  });
  assert.equal(frame.message.ok, true);
  assert.equal(frame.message.payload.width, 4);
  assert.equal(frame.message.payload.height, 5);
  assert.equal(frame.message.payload.rgba.byteLength, 80);
  assert.equal(frame.transfer.length, 1);
  assert.equal(frame.transfer[0], frame.message.payload.rgba);
});

test("rejects malformed session responses with a stable protocol code", async () => {
  const handle = createPyodideWorkerHandler({
    async status() {
      return null;
    },
    async runScript() {
      return { outputs: "not-an-array" };
    },
    async renderOutput() {
      return { width: 4, height: 5 };
    },
  });

  const status = await handle({ schemaVersion: 1, requestId: 1, type: "status" });
  assert.equal(status.message.ok, false);
  assert.equal(status.message.error.code, "runtime-protocol");

  const outputs = await handle({
    schemaVersion: 1,
    requestId: 2,
    type: "runScript",
    source: "x = 1",
    filename: "author.vpy",
  });
  assert.equal(outputs.message.ok, false);
  assert.equal(outputs.message.error.code, "runtime-protocol");

  const frame = await handle({
    schemaVersion: 1,
    requestId: 3,
    type: "renderOutput",
    index: 0,
    frame: 1,
  });
  assert.equal(frame.message.ok, false);
  assert.equal(frame.message.error.code, "runtime-protocol");
});

test("rejects unknown request types before touching the session", async () => {
  const session = recordingSession();
  const handle = createPyodideWorkerHandler(session);

  const response = await handle({ schemaVersion: 1, requestId: 1, type: "reticulate" });
  assert.equal(response.message.ok, false);
  assert.equal(response.message.error.code, "unsupported-request");
  assert.deepEqual(session.calls, []);
});

test("accepts a conforming drained plan unchanged", () => {
  const plan = {
    version: 1,
    operations: [
      {
        id: 1,
        namespace: "std",
        function: "BlankClip",
        arguments: [
          { key: "width", kind: "int", value: 320 },
          { key: "height", kind: "int", value: 180 },
          { key: "color", kind: "floatArray", value: [32.0, 96.0, 224.0] },
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

  assert.equal(validateDrainedPlan(plan), plan);
});

test("accepts plans at the exact budget boundaries", () => {
  const argumentList = Array.from({ length: MAX_PLAN_ARGUMENTS }, (_, i) => ({
    key: `k${i}`,
    kind: "int",
    value: i,
  }));
  const operations = Array.from({ length: MAX_PLAN_OPERATIONS }, (_, i) => ({
    id: i + 1,
    namespace: "std",
    function: "BlankClip",
    arguments: i === 0 ? argumentList : [],
  }));
  const outputs = Array.from({ length: MAX_PLAN_OUTPUTS }, (_, i) => ({
    index: i,
    node: 1,
  }));
  const plan = { version: 1, operations, outputs };

  assert.equal(validateDrainedPlan(plan), plan);
});

test("rejects drained plans over the operation, argument, array, and output budgets", () => {
  const operations = Array.from({ length: MAX_PLAN_OPERATIONS + 1 }, (_, i) => ({
    id: i + 1,
    namespace: "std",
    function: "BlankClip",
    arguments: [],
  }));
  assert.throws(
    () => validateDrainedPlan({ version: 1, operations, outputs: [] }),
    (error) => error.code === "plan-limit",
  );

  const argumentList = Array.from({ length: MAX_PLAN_ARGUMENTS + 1 }, (_, i) => ({
    key: `k${i}`,
    kind: "int",
    value: i,
  }));
  assert.throws(
    () =>
      validateDrainedPlan({
        version: 1,
        operations: [{ id: 1, namespace: "std", function: "BlankClip", arguments: argumentList }],
        outputs: [],
      }),
    (error) => error.code === "plan-limit",
  );

  assert.throws(
    () =>
      validateDrainedPlan({
        version: 1,
        operations: [
          {
            id: 1,
            namespace: "std",
            function: "BlankClip",
            arguments: [
              { key: "color", kind: "floatArray", value: new Array(MAX_PLAN_ARRAY_LENGTH + 1).fill(1.5) },
            ],
          },
        ],
        outputs: [],
      }),
    (error) => error.code === "plan-limit",
  );

  const outputs = Array.from({ length: MAX_PLAN_OUTPUTS + 1 }, (_, i) => ({
    index: i,
    node: 1,
  }));
  assert.throws(
    () =>
      validateDrainedPlan({
        version: 1,
        operations: [{ id: 1, namespace: "std", function: "BlankClip", arguments: [] }],
        outputs,
      }),
    (error) => error.code === "plan-limit",
  );
});

test("rejects malformed drained plans with a stable protocol code", () => {
  const baseOperation = { id: 1, namespace: "std", function: "BlankClip", arguments: [] };
  const invalidPlans = [
    null,
    [],
    { version: 2, operations: [], outputs: [] },
    { version: 1, operations: "not-an-array", outputs: [] },
    { version: 1, operations: [{ ...baseOperation, id: 0 }], outputs: [] },
    {
      version: 1,
      operations: [
        baseOperation,
        { id: 1, namespace: "std", function: "Invert", arguments: [] },
      ],
      outputs: [],
    },
    { version: 1, operations: [{ ...baseOperation, namespace: "" }], outputs: [] },
    {
      version: 1,
      operations: [
        { ...baseOperation, arguments: [{ key: "", kind: "int", value: 1 }] },
      ],
      outputs: [],
    },
    {
      version: 1,
      operations: [
        { ...baseOperation, arguments: [{ key: "width", kind: "int", value: 1.5 }] },
      ],
      outputs: [],
    },
    {
      version: 1,
      operations: [
        { ...baseOperation, arguments: [{ key: "clip", kind: "node", value: 2 }] },
        { id: 2, namespace: "std", function: "Invert", arguments: [] },
      ],
      outputs: [],
    },
    {
      version: 1,
      operations: [
        {
          ...baseOperation,
          arguments: [{ key: "clips", kind: "nodeArray", value: [2] }],
        },
        { id: 2, namespace: "std", function: "Invert", arguments: [] },
      ],
      outputs: [],
    },
    { version: 1, operations: [baseOperation], outputs: [{ index: -1, node: 1 }] },
    { version: 1, operations: [baseOperation], outputs: [{ index: 0, node: 7 }] },
  ];

  for (const plan of invalidPlans) {
    assert.throws(
      () => validateDrainedPlan(plan),
      (error) => error.code === "invalid-plan",
      JSON.stringify(plan),
    );
  }
});
