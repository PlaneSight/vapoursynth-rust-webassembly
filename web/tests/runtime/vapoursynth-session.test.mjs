import assert from "node:assert/strict";
import test from "node:test";

import { AuthoringSession } from "../../runtime/vapoursynth/session.mjs";
const RGB24_FORMAT_ID = 537_395_200;

const DEFAULT_PLAN = {
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

/** Emulates the generic Emscripten session surface consumed by the session. */
function fakeRuntime(overrides = {}) {
  const calls = [];
  let nextSlot = 100;
  const runtime = {
    calls,
    status() {
      return JSON.stringify({ schemaVersion: 1, upstreamLinked: true });
    },
    core_create(requestId) {
      calls.push(["core_create", requestId]);
      return { slot: 1, generation: 1 };
    },
    core_release(requestId, token) {
      calls.push(["core_release", requestId, token]);
    },
    invoke(requestId, coreToken, namespace, functionName, args, resultKey, resultIndex) {
      calls.push(["invoke", requestId, namespace, functionName, args, resultKey, resultIndex]);
      const slot = nextSlot;
      nextSlot += 1;
      return { slot, generation: 1 };
    },
    node_get_frame(requestId, nodeToken, frameNumber) {
      calls.push(["node_get_frame", requestId, nodeToken, frameNumber]);
      return { slot: nodeToken.slot + 1000, generation: 2 };
    },
    node_release(requestId, nodeToken) {
      calls.push(["node_release", requestId, nodeToken]);
    },
    frame_dimensions(requestId, frameToken) {
      calls.push(["frame_dimensions", requestId, frameToken]);
      return { width: 320, height: 180 };
    },
    frame_rgba8_size(requestId, frameToken) {
      calls.push(["frame_rgba8_size", requestId, frameToken]);
      return 320 * 180 * 4;
    },
    frame_copy_rgba8(requestId, frameToken) {
      calls.push(["frame_copy_rgba8", requestId, frameToken]);
      return new Uint8Array(320 * 180 * 4).fill(223);
    },
    frame_release(requestId, frameToken) {
      calls.push(["frame_release", requestId, frameToken]);
    },
    free() {
      calls.push(["free"]);
    },
    ...overrides,
  };
  return runtime;
}

test("executes a generic graph through retained native leases", () => {
  const runtime = fakeRuntime();
  const session = new AuthoringSession(runtime);
  const result = session.execute_graph(1, DEFAULT_PLAN);

  assert.deepEqual(result, { outputs: [{ index: 0, width: 320, height: 180 }] });
  const invokes = runtime.calls.filter(([name]) => name === "invoke");
  assert.deepEqual(
    invokes.map(([, , namespace, functionName, args, resultKey, resultIndex]) => [
      namespace,
      functionName,
      args,
      resultKey,
      resultIndex,
    ]),
    [
      ["std", "BlankClip", DEFAULT_PLAN.operations[0].arguments, "clip", 0],
      // The plan's op-id node reference resolves to the retained first-op token.
      ["std", "Invert", [{ key: "clip", kind: "node", value: { slot: 100, generation: 1 } }], "clip", 0],
    ],
  );
  // Output metadata comes from a real requested frame 0, then the frame is released.
  assert.deepEqual(runtime.calls.filter(([name]) => name === "node_get_frame"), [
    ["node_get_frame", 1, { slot: 101, generation: 1 }, 0],
  ]);
  assert.deepEqual(runtime.calls.filter(([name]) => name === "frame_release"), [
    ["frame_release", 1, { slot: 1101, generation: 2 }],
  ]);
  // Leases stay alive for later rendering.
  assert.equal(runtime.calls.some(([name]) => name === "node_release"), false);
  assert.equal(runtime.calls.some(([name]) => name === "core_release"), false);
});

test("renders the requested frame number through the retained output node", () => {
  const runtime = fakeRuntime();
  const session = new AuthoringSession(runtime);
  session.execute_graph(1, DEFAULT_PLAN);

  const frame = session.render_output(2, 0, 5);
  assert.deepEqual(frame, {
    width: 320,
    height: 180,
    rgba: new Uint8Array(320 * 180 * 4).fill(223),
  });
  assert.deepEqual(runtime.calls.filter(([name]) => name === "node_get_frame"), [
    ["node_get_frame", 1, { slot: 101, generation: 1 }, 0],
    ["node_get_frame", 2, { slot: 101, generation: 1 }, 5],
  ]);
  assert.deepEqual(runtime.calls.filter(([name]) => name === "frame_release"), [
    ["frame_release", 1, { slot: 1101, generation: 2 }],
    ["frame_release", 2, { slot: 1101, generation: 2 }],
  ]);
});

test("releases every lease on reset and rejects stale rendering afterwards", () => {
  const runtime = fakeRuntime();
  const session = new AuthoringSession(runtime);
  session.execute_graph(1, DEFAULT_PLAN);

  session.reset_graph(2);
  assert.deepEqual(runtime.calls.filter(([name]) => name === "node_release"), [
    ["node_release", 2, { slot: 100, generation: 1 }],
    ["node_release", 2, { slot: 101, generation: 1 }],
  ]);
  assert.deepEqual(runtime.calls.filter(([name]) => name === "core_release"), [
    ["core_release", 2, { slot: 1, generation: 1 }],
  ]);

  assert.throws(
    () => session.render_output(3, 0, 0),
    (error) => error.code === "missing-output",
  );
});

test("rejects a second graph until the previous one is reset", () => {
  const session = new AuthoringSession(fakeRuntime());
  session.execute_graph(1, DEFAULT_PLAN);

  assert.throws(
    () => session.execute_graph(2, DEFAULT_PLAN),
    (error) => error.code === "graph-active",
  );

  session.reset_graph(3);
  assert.deepEqual(session.execute_graph(4, DEFAULT_PLAN).outputs, [
    { index: 0, width: 320, height: 180 },
  ]);
});

test("rejects malformed plans before touching the runtime", () => {
  const runtime = fakeRuntime();
  const session = new AuthoringSession(runtime);

  const cases = [
    [null, "invalid-plan"],
    [{ version: 2, operations: [], outputs: [] }, "invalid-plan"],
    [{ version: 1, operations: {}, outputs: [] }, "invalid-plan"],
    [{ version: 1, operations: [], outputs: {} }, "invalid-plan"],
    [{ version: 1, operations: [{}], outputs: [] }, "invalid-operation"],
    [{ version: 1, operations: [{ id: 0, namespace: "std", function: "BlankClip", arguments: [] }], outputs: [] }, "invalid-operation"],
    [
      {
        version: 1,
        operations: [
          { id: 1, namespace: "std", function: "BlankClip", arguments: [] },
          { id: 1, namespace: "std", function: "Invert", arguments: [] },
        ],
        outputs: [],
      },
      "invalid-operation",
    ],
    [{ version: 1, operations: [{ id: 1, namespace: 7, function: "BlankClip", arguments: [] }], outputs: [] }, "invalid-name"],
    [{ version: 1, operations: [{ id: 1, namespace: "std", function: "", arguments: [] }], outputs: [] }, "invalid-name"],
    [{ version: 1, operations: [{ id: 1, namespace: "std", function: "F", arguments: [{ key: "x", kind: "strange", value: 1 }] }], outputs: [] }, "invalid-argument"],
    [{ version: 1, operations: [{ id: 1, namespace: "std", function: "F", arguments: [{ key: "x", kind: "int", value: 1.5 }] }], outputs: [] }, "invalid-argument"],
    [{ version: 1, operations: [{ id: 1, namespace: "std", function: "F", arguments: [{ key: "x", kind: "int", value: 2 ** 53 }] }], outputs: [] }, "invalid-argument"],
    [{ version: 1, operations: [{ id: 1, namespace: "std", function: "F", arguments: [{ key: "x", kind: "float", value: Infinity }] }], outputs: [] }, "invalid-argument"],
    [{ version: 1, operations: [{ id: 1, namespace: "std", function: "F", arguments: [{ key: "x", kind: "data", value: "" }] }], outputs: [] }, "invalid-argument"],
    [{ version: 1, operations: [{ id: 1, namespace: "std", function: "F", arguments: [{ key: "x", kind: "intArray", value: [] }] }], outputs: [] }, "invalid-argument"],
    [{ version: 1, operations: [{ id: 1, namespace: "std", function: "F", arguments: [{ key: "x", kind: "node", value: 0 }] }], outputs: [] }, "invalid-argument"],
    [
      {
        version: 1,
        operations: [
          { id: 1, namespace: "std", function: "F", arguments: [{ key: "x", kind: "node", value: 2 }] },
          { id: 2, namespace: "std", function: "F", arguments: [] },
        ],
        outputs: [],
      },
      "forward-node",
    ],
    [{ version: 1, operations: [{ id: 1, namespace: "std", function: "F", arguments: [{ key: "x", kind: "node", value: 9 }] }], outputs: [] }, "unknown-node"],
    [{ version: 1, operations: [], outputs: [{ index: 0, node: 1 }] }, "unknown-node"],
    [{ version: 1, operations: [], outputs: [{ index: -1, node: 1 }] }, "invalid-output"],
    [
      {
        version: 1,
        operations: [{ id: 1, namespace: "std", function: "F", arguments: [] }],
        outputs: [{ index: 0, node: 1 }, { index: 0, node: 1 }],
      },
      "invalid-output",
    ],
  ];

  for (const [plan, code] of cases) {
    assert.throws(
      () => session.execute_graph(1, plan),
      (error) => error.code === code,
      `expected ${code} for ${JSON.stringify(plan).slice(0, 80)}`,
    );
  }

  const oversized = {
    version: 1,
    operations: Array.from({ length: 257 }, (_, index) => ({
      id: index + 1,
      namespace: "std",
      function: "F",
      arguments: [],
    })),
    outputs: [],
  };
  assert.throws(
    () => session.execute_graph(1, oversized),
    (error) => error.code === "plan-too-large",
  );

  assert.deepEqual(runtime.calls, []);
});

test("releases every lease when an upstream invocation fails mid-plan", () => {
  const runtime = fakeRuntime({
    invoke(_requestId, _coreToken, _namespace, functionName) {
      if (functionName === "Invert") {
        throw Object.assign(new Error("upstream rejected Invert"), { code: "invocation-failed" });
      }
      return { slot: 100, generation: 1 };
    },
  });
  const session = new AuthoringSession(runtime);

  assert.throws(
    () => session.execute_graph(1, DEFAULT_PLAN),
    (error) => error.code === "invocation-failed",
  );
  // The first node lease and the core are released after the failure.
  assert.deepEqual(runtime.calls.filter(([name]) => name === "node_release"), [
    ["node_release", 1, { slot: 100, generation: 1 }],
  ]);
  assert.deepEqual(runtime.calls.filter(([name]) => name === "core_release"), [
    ["core_release", 1, { slot: 1, generation: 1 }],
  ]);
});

test("reports missing and stale output rendering deterministically", () => {
  const session = new AuthoringSession(fakeRuntime());
  session.execute_graph(1, DEFAULT_PLAN);

  assert.throws(
    () => session.render_output(2, 7, 0),
    (error) => error.code === "missing-output",
  );
  assert.throws(
    () => session.render_output(2, 0, -1),
    (error) => error.code === "invalid-frame",
  );
  assert.throws(
    () => session.render_output(2, -1, 0),
    (error) => error.code === "invalid-output",
  );
});

test("status advertises the plan authoring subset", () => {
  const session = new AuthoringSession(fakeRuntime());
  const status = JSON.parse(session.status());

  assert.equal(status.upstreamLinked, true);
  assert.deepEqual(status.authoring, {
    available: true,
    planVersion: 1,
    format: "RGB24",
  });
});

test("frees the runtime and releases every lease on shutdown", () => {
  const runtime = fakeRuntime();
  const session = new AuthoringSession(runtime);
  session.execute_graph(1, DEFAULT_PLAN);

  session.free();
  assert.deepEqual(runtime.calls.filter(([name]) => name === "node_release"), [
    ["node_release", 0, { slot: 100, generation: 1 }],
    ["node_release", 0, { slot: 101, generation: 1 }],
  ]);
  assert.deepEqual(runtime.calls.filter(([name]) => name === "core_release"), [
    ["core_release", 0, { slot: 1, generation: 1 }],
  ]);
  assert.deepEqual(runtime.calls.filter(([name]) => name === "free"), [["free"]]);

  assert.throws(
    () => session.execute_graph(2, DEFAULT_PLAN),
    (error) => error.code === "runtime-closed",
  );
});
