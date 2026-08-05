import assert from "node:assert/strict";
import test from "node:test";

import { PyodideSession } from "../../runtime/pyodide/session.mjs";

function fakePyodide() {
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
      if (source === "raise RuntimeError('broken')") {
        throw new Error("broken");
      }
    },
  };
}

function fakeWorkerClient() {
  return {
    calls: [],
    async status() {
      this.calls.push(["status"]);
      return { schemaVersion: 1, upstreamLinked: true };
    },
    async createBlankClip() {
      this.calls.push(["createBlankClip"]);
      return { nodeId: 1 };
    },
    async invert() {
      this.calls.push(["invert"]);
      return { nodeId: 2 };
    },
    async setOutput() {
      this.calls.push(["setOutput"]);
    },
    async releaseNode() {
      this.calls.push(["releaseNode"]);
    },
    async resetGraph() {
      this.calls.push(["resetGraph"]);
    },
    async listOutputs() {
      this.calls.push(["listOutputs"]);
      return { outputs: [{ index: 0, width: 3, height: 2, format: "RGB24", length: 1 }] };
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

test("installs the Python package and executes a fresh async .vpy namespace", async () => {
  const pyodide = fakePyodide();
  const workerClient = fakeWorkerClient();
  const session = new PyodideSession({
    pyodide,
    workerClient,
    packageSource: "import _vapoursynth_rpc as _rpc",
  });

  await session.initialize();
  const result = await session.runScript("import vapoursynth as vs\nawait vs.set_output(0, await vs.core.std.BlankClip())", "example.vpy");

  assert.equal(pyodide.registered.has("_vapoursynth_rpc"), true);
  assert.match(pyodide.calls[0].source, /exec\(/);
  assert.equal(pyodide.calls[1].source, "import vapoursynth as vs\nawait vs.set_output(0, await vs.core.std.BlankClip())");
  assert.equal(pyodide.calls[1].options.globals.values.get("__name__"), "__vpy__");
  assert.equal(pyodide.calls[1].options.globals.values.get("__file__"), "example.vpy");
  assert.equal(pyodide.calls[1].options.globals.destroyed, true);
  assert.deepEqual(result, {
    outputs: [{ index: 0, width: 3, height: 2, format: "RGB24", length: 1 }],
  });
  assert.deepEqual(workerClient.calls, [["resetGraph"], ["listOutputs"]]);
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

  assert.deepEqual(workerClient.calls, [["resetGraph"]]);
  assert.equal(pyodide.calls.length, 2);
  assert.equal(pyodide.calls.at(-1).source, "first");

  releaseFirstScript();
  await Promise.all([first, second]);
  assert.deepEqual(workerClient.calls, [
    ["resetGraph"],
    ["listOutputs"],
    ["resetGraph"],
    ["listOutputs"],
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
