import assert from "node:assert/strict";
import test from "node:test";

import { PyodideSession } from "../../runtime/pyodide/session.mjs";

const RESET_PLAN_SNIPPET = "import vapoursynth as _vs\n_vs._reset_plan()";
const DRAIN_PLAN_SNIPPET = "import vapoursynth as _vs\n_vs._drain_plan()";

const EMPTY_PLAN = { version: 1, operations: [], outputs: [] };
const EXAMPLE_PLAN = {
  version: 1,
  operations: [
    {
      id: 1,
      namespace: "std",
      function: "BlankClip",
      arguments: [
        { key: "width", kind: "int", value: 3 },
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

function fakePyodide({ drainResponse = JSON.stringify(EMPTY_PLAN) } = {}) {
  const proxies = [];
  const dictFactory = () => {
    const proxy = {
      values: new Map(),
      destroyed: false,
      set(key, value) {
        this.values.set(key, value);
      },
      destroy() {
        this.destroyed = true;
      },
    };
    proxies.push(proxy);
    return proxy;
  };
  dictFactory.destroy = () => {};

  return {
    calls: [],
    registered: new Map(),
    unregistered: [],
    proxies,
    drainResponse,
    globals: {
      get(name) {
        assert.equal(name, "dict");
        return dictFactory;
      },
    },
    registerJsModule(name, value) {
      this.registered.set(name, value);
    },
    unregisterJsModule(name) {
      this.unregistered.push(name);
      this.registered.delete(name);
    },
    async runPythonAsync(source, options) {
      this.calls.push({ source, options });
      if (source === RESET_PLAN_SNIPPET) {
        return undefined;
      }
      if (source === DRAIN_PLAN_SNIPPET) {
        return this.drainResponse;
      }
      if (source === "raise RuntimeError('broken')") {
        throw new Error("broken");
      }
    },
  };
}

function fakeWorkerClient() {
  return {
    calls: [],
    executeGraphError: null,
    async status() {
      this.calls.push(["status"]);
      return { schemaVersion: 1, upstreamLinked: true };
    },
    async resetGraph() {
      this.calls.push(["resetGraph"]);
    },
    async executeGraph(plan) {
      this.calls.push(["executeGraph", plan]);
      if (this.executeGraphError) {
        throw this.executeGraphError;
      }
      return { outputs: [{ index: 0, width: 3, height: 2 }] };
    },
    async renderOutput(index, frame) {
      this.calls.push(["renderOutput", index, frame]);
      return { width: 3, height: 2, rgba: new ArrayBuffer(24) };
    },
    close() {
      this.calls.push(["close"]);
    },
  };
}

test("installs the Python package and executes a fresh .vpy namespace", async () => {
  const pyodide = fakePyodide();
  const workerClient = fakeWorkerClient();
  const session = new PyodideSession({
    pyodide,
    workerClient,
    packageSource: "import _vapoursynth_rpc as _rpc",
  });

  await session.initialize();
  const result = await session.runScript(
    "import vapoursynth as vs\nblank = vs.core.std.BlankClip(width=3)\nblank.set_output(0)",
    "example.vpy",
  );

  assert.equal(pyodide.registered.has("_vapoursynth_rpc"), true);
  assert.match(pyodide.calls[0].source, /exec\(/);
  assert.equal(pyodide.calls[1].source, RESET_PLAN_SNIPPET);
  assert.equal(pyodide.calls[2].source, "import vapoursynth as vs\nblank = vs.core.std.BlankClip(width=3)\nblank.set_output(0)");
  assert.equal(pyodide.calls[2].options.globals.values.get("__name__"), "__vpy__");
  assert.equal(pyodide.calls[2].options.globals.values.get("__file__"), "example.vpy");
  assert.equal(pyodide.calls[2].options.globals.destroyed, true);
  assert.equal(pyodide.calls[3].source, DRAIN_PLAN_SNIPPET);
  assert.deepEqual(result, {
    outputs: [{ index: 0, width: 3, height: 2 }],
  });
  assert.deepEqual(workerClient.calls, [
    ["resetGraph"],
    ["executeGraph", EMPTY_PLAN],
  ]);
});

test("forwards a validated drained plan to the worker before listing outputs", async () => {
  const pyodide = fakePyodide({ drainResponse: JSON.stringify(EXAMPLE_PLAN) });
  const workerClient = fakeWorkerClient();
  const session = new PyodideSession({
    pyodide,
    workerClient,
    packageSource: "import _vapoursynth_rpc as _rpc",
  });
  await session.initialize();

  const result = await session.runScript("x = 1", "plan.vpy");

  assert.deepEqual(result, {
    outputs: [{ index: 0, width: 3, height: 2 }],
  });
  assert.deepEqual(workerClient.calls, [
    ["resetGraph"],
    ["executeGraph", EXAMPLE_PLAN],
  ]);
});

test("cleans partial graphs and reports Python failures structurally", async () => {
  const pyodide = fakePyodide();
  const workerClient = fakeWorkerClient();
  const session = new PyodideSession({
    pyodide,
    workerClient,
    packageSource: "import _vapoursynth_rpc as _rpc",
  });
  await session.initialize();

  await assert.rejects(
    () => session.runScript("raise RuntimeError('broken')"),
    (error) => error.code === "python-error" && error.message.includes("broken"),
  );
  assert.deepEqual(workerClient.calls, [["resetGraph"], ["resetGraph"]]);
});

test("serializes .vpy evaluations around one Pyodide interpreter and graph state", async () => {
  const pyodide = fakePyodide();
  let releaseFirstScript;
  const firstScript = new Promise((resolve) => {
    releaseFirstScript = resolve;
  });
  pyodide.runPythonAsync = async function runPythonAsync(source, options) {
    this.calls.push({ source, options });
    if (source === RESET_PLAN_SNIPPET) {
      return undefined;
    }
    if (source === DRAIN_PLAN_SNIPPET) {
      return JSON.stringify(EMPTY_PLAN);
    }
    if (source === "first") {
      await firstScript;
    }
  };

  const workerClient = fakeWorkerClient();
  const session = new PyodideSession({
    pyodide,
    workerClient,
    packageSource: "import _vapoursynth_rpc as _rpc",
  });
  await session.initialize();

  const first = session.runScript("first");
  const second = session.runScript("second");
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(workerClient.calls, [["resetGraph"]]);
  assert.equal(pyodide.calls.length, 3);
  assert.equal(pyodide.calls.at(-1).source, "first");

  releaseFirstScript();
  await Promise.all([first, second]);
  assert.deepEqual(workerClient.calls, [
    ["resetGraph"],
    ["executeGraph", EMPTY_PLAN],
    ["resetGraph"],
    ["executeGraph", EMPTY_PLAN],
  ]);
});

test("surfaces backend status and releases both worker layers on shutdown", async () => {
  const pyodide = fakePyodide();
  const workerClient = fakeWorkerClient();
  const session = new PyodideSession({
    pyodide,
    workerClient,
    packageSource: "import _vapoursynth_rpc as _rpc",
  });
  await session.initialize();

  const status = await session.status();
  assert.deepEqual(status.pyodide, {
    initialized: true,
    authoringModule: "vapoursynth",
    rpcModule: "_vapoursynth_rpc",
  });

  session.free();
  assert.deepEqual(pyodide.unregistered, ["_vapoursynth_rpc"]);
  assert.deepEqual(workerClient.calls, [["status"], ["close"]]);
});

test("rejects over-long sources and filenames before any worker RPC", async () => {
  const pyodide = fakePyodide();
  const workerClient = fakeWorkerClient();
  const session = new PyodideSession({
    pyodide,
    workerClient,
    packageSource: "import _vapoursynth_rpc as _rpc",
  });
  await session.initialize();

  await assert.rejects(
    () => session.runScript("x".repeat(1_000_001)),
    (error) => error.code === "invalid-script",
  );
  await assert.rejects(
    () => session.runScript("x = 1", "x".repeat(257)),
    (error) => error.code === "invalid-script",
  );
  assert.deepEqual(workerClient.calls, []);
});

test("times out callers without allowing late scripts to race the interpreter queue", async () => {
  let releaseSlowScript;
  const slowScript = new Promise((resolve) => {
    releaseSlowScript = resolve;
  });
  const pyodide = fakePyodide();
  pyodide.runPythonAsync = async function runPythonAsync(source, options) {
    this.calls.push({ source, options });
    if (source.startsWith("import sys as _vs_sys")) {
      return undefined; // package installer
    }
    if (source === RESET_PLAN_SNIPPET) {
      return undefined;
    }
    if (source === DRAIN_PLAN_SNIPPET) {
      return JSON.stringify(EMPTY_PLAN);
    }
    if (source === "slow") {
      await slowScript;
    }
    return undefined;
  };
  const workerClient = fakeWorkerClient();
  const session = new PyodideSession({
    pyodide,
    workerClient,
    packageSource: "import _vapoursynth_rpc as _rpc",
    scriptTimeoutMs: 20,
  });
  await session.initialize();

  await assert.rejects(
    () => session.runScript("slow"),
    (error) => error.code === "script-timeout" && error.message.includes("20 ms"),
  );
  assert.deepEqual(workerClient.calls, [["resetGraph"]]);

  const next = session.runScript("x = 1");
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(pyodide.calls.some(({ source }) => source === "x = 1"), false);

  releaseSlowScript();
  await next;
  assert.deepEqual(workerClient.calls, [
    ["resetGraph"],
    ["resetGraph"],
    ["resetGraph"],
    ["executeGraph", EMPTY_PLAN],
  ]);
});

test("rejects drained plans that exceed the operation budget", async () => {
  const operations = Array.from({ length: 65 }, (_, i) => ({
    id: i + 1,
    namespace: "std",
    function: "BlankClip",
    arguments: [{ key: "width", kind: "int", value: 1 }],
  }));
  const pyodide = fakePyodide({
    drainResponse: JSON.stringify({ version: 1, operations, outputs: [] }),
  });
  const workerClient = fakeWorkerClient();
  const session = new PyodideSession({
    pyodide,
    workerClient,
    packageSource: "import _vapoursynth_rpc as _rpc",
  });
  await session.initialize();

  await assert.rejects(
    () => session.runScript("x = 1"),
    (error) => error.code === "plan-limit",
  );
  assert.deepEqual(workerClient.calls, [["resetGraph"], ["resetGraph"]]);
});

test("rejects drained plans that exceed the argument, array, and output budgets", async () => {
  const argumentHeavy = {
    version: 1,
    operations: [
      {
        id: 1,
        namespace: "std",
        function: "BlankClip",
        arguments: Array.from({ length: 65 }, (_, i) => ({ key: `k${i}`, kind: "int", value: i })),
      },
    ],
    outputs: [],
  };
  const arrayHeavy = {
    version: 1,
    operations: [
      {
        id: 1,
        namespace: "std",
        function: "BlankClip",
        arguments: [{ key: "color", kind: "floatArray", value: new Array(4097).fill(1.5) }],
      },
    ],
    outputs: [],
  };
  const outputHeavy = {
    version: 1,
    operations: [{ id: 1, namespace: "std", function: "BlankClip", arguments: [] }],
    outputs: Array.from({ length: 17 }, (_, i) => ({ index: i, node: 1 })),
  };

  for (const drainedPlan of [argumentHeavy, arrayHeavy, outputHeavy]) {
    const pyodide = fakePyodide({ drainResponse: JSON.stringify(drainedPlan) });
    const workerClient = fakeWorkerClient();
    const session = new PyodideSession({
      pyodide,
      workerClient,
      packageSource: "import _vapoursynth_rpc as _rpc",
    });
    await session.initialize();

    await assert.rejects(
      () => session.runScript("x = 1"),
      (error) => error.code === "plan-limit",
    );
    assert.deepEqual(workerClient.calls, [["resetGraph"], ["resetGraph"]]);
  }
});

test("rejects malformed drained plans before forwarding", async () => {
  const baseOperation = { id: 1, namespace: "std", function: "BlankClip", arguments: [] };
  const invalidPlans = [
    { version: 2, operations: [], outputs: [] },
    { version: 1, operations: "not-an-array", outputs: [] },
    {
      version: 1,
      operations: [{ ...baseOperation, id: 0 }],
      outputs: [],
    },
    {
      version: 1,
      operations: [
        {
          id: 1,
          namespace: "std",
          function: "BlankClip",
          arguments: [{ key: "clip", kind: "node", value: 2 }],
        },
        { id: 2, namespace: "std", function: "Invert", arguments: [] },
      ],
      outputs: [],
    },
    {
      version: 1,
      operations: [
        { ...baseOperation, arguments: [{ key: "x", kind: "blob", value: 1 }] },
      ],
      outputs: [],
    },
    {
      version: 1,
      operations: [baseOperation],
      outputs: [{ index: 0, node: 9 }],
    },
  ];

  for (const drainedPlan of invalidPlans) {
    const pyodide = fakePyodide({ drainResponse: JSON.stringify(drainedPlan) });
    const workerClient = fakeWorkerClient();
    const session = new PyodideSession({
      pyodide,
      workerClient,
      packageSource: "import _vapoursynth_rpc as _rpc",
    });
    await session.initialize();

    await assert.rejects(
      () => session.runScript("x = 1"),
      (error) => error.code === "invalid-plan",
      JSON.stringify(drainedPlan),
    );
    assert.deepEqual(workerClient.calls, [["resetGraph"], ["resetGraph"]]);
  }
});

test("rejects a drain that does not serialize the recorded plan", async () => {
  const pyodide = fakePyodide({ drainResponse: 42 });
  const workerClient = fakeWorkerClient();
  const session = new PyodideSession({
    pyodide,
    workerClient,
    packageSource: "import _vapoursynth_rpc as _rpc",
  });
  await session.initialize();

  await assert.rejects(
    () => session.runScript("x = 1"),
    (error) => error.code === "runtime-protocol",
  );
  assert.deepEqual(workerClient.calls, [["resetGraph"], ["resetGraph"]]);
});

test("forwards structured worker errors from plan execution", async () => {
  const pyodide = fakePyodide();
  const workerClient = fakeWorkerClient();
  const upstreamError = new Error("upstream rejected the graph");
  upstreamError.code = "upstream-error";
  workerClient.executeGraphError = upstreamError;
  const session = new PyodideSession({
    pyodide,
    workerClient,
    packageSource: "import _vapoursynth_rpc as _rpc",
  });
  await session.initialize();

  await assert.rejects(
    () => session.runScript("x = 1"),
    (error) => error.code === "upstream-error",
  );
  assert.deepEqual(workerClient.calls, [
    ["resetGraph"],
    ["executeGraph", EMPTY_PLAN],
    ["resetGraph"],
  ]);
});
