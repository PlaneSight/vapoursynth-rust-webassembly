import { createPackageInstaller } from "./package.mjs";
import {
  MAX_SCRIPT_DURATION_MS,
  PYODIDE_RPC_MODULE,
  validateDrainedPlan,
} from "../../protocol/pyodide.mjs";

export const MAX_SOURCE_LENGTH = 1_000_000;
export const MAX_FILENAME_LENGTH = 256;
export { MAX_SCRIPT_DURATION_MS };

/** The Python module records the script's graph plan; these snippets drain it. */
const RESET_PLAN_SNIPPET = "import vapoursynth as _vs\n_vs._reset_plan()";
const DRAIN_PLAN_SNIPPET = "import vapoursynth as _vs\n_vs._drain_plan()";

/** Owns one Pyodide interpreter and its dedicated VapourSynth worker client. */
export class PyodideSession {
  #pyodide;
  #workerClient;
  #packageSource;
  #initialized = false;
  #closed = false;
  #operationTail = Promise.resolve();
  #scriptTimeoutMs;

  constructor({ pyodide, workerClient, packageSource, scriptTimeoutMs = MAX_SCRIPT_DURATION_MS }) {
    if (!pyodide || typeof pyodide.registerJsModule !== "function" || typeof pyodide.runPythonAsync !== "function") {
      throw new TypeError("pyodide must provide registerJsModule() and runPythonAsync()");
    }
    if (!workerClient || typeof workerClient.status !== "function" || typeof workerClient.resetGraph !== "function" || typeof workerClient.executeGraph !== "function" || typeof workerClient.renderOutput !== "function") {
      throw new TypeError("workerClient must provide the authoring worker API");
    }
    if (typeof packageSource !== "string" || packageSource.trim().length === 0) {
      throw new TypeError("packageSource must be a non-empty string");
    }
    if (!Number.isFinite(scriptTimeoutMs) || scriptTimeoutMs <= 0) {
      throw new TypeError("scriptTimeoutMs must be a positive number");
    }

    this.#pyodide = pyodide;
    this.#workerClient = workerClient;
    this.#packageSource = packageSource;
    this.#scriptTimeoutMs = scriptTimeoutMs;
  }

  async initialize() {
    this.#assertOpen();
    if (this.#initialized) {
      return;
    }

    // The package installer imports this name unconditionally, so it must
    // stay importable even though the forwarding RPC bridge was removed when
    // graph plans moved to Python-side recording.
    this.#pyodide.registerJsModule(PYODIDE_RPC_MODULE, Object.freeze({}));
    try {
      await this.#pyodide.runPythonAsync(createPackageInstaller(this.#packageSource));
      this.#initialized = true;
    } catch (error) {
      this.#unregisterRpcModule();
      throw sessionError("python-initialization-failed", `could not install the vapoursynth Python package: ${errorMessage(error)}`);
    }
  }

  async status() {
    this.#assertReady();
    const runtime = await this.#workerClient.status();
    if (!runtime || typeof runtime !== "object" || Array.isArray(runtime)) {
      throw sessionError("runtime-protocol", "the VapourSynth worker returned an invalid status payload");
    }

    return {
      ...runtime,
      pyodide: {
        initialized: true,
        authoringModule: "vapoursynth",
        rpcModule: PYODIDE_RPC_MODULE,
      },
    };
  }

  runScript(source, filename = "script.vpy") {
    return this.#enqueue(() => this.#startScript(source, filename));
  }

  renderOutput(index, frame = 0) {
    return this.#enqueue(() => {
      const result = Promise.resolve().then(() => {
        this.#assertReady();
        return this.#workerClient.renderOutput(index, frame);
      });
      return { result, settled: result };
    });
  }

  #startScript(source, filename) {
    this.#assertReady();
    validateSource(source, filename);

    const controller = new AbortController();
    const scriptGlobals = createScriptGlobals(this.#pyodide, filename);
    const execution = (async () => {
      try {
        await this.#workerClient.resetGraph();
        throwIfAborted(controller.signal);
        await this.#pyodide.runPythonAsync(RESET_PLAN_SNIPPET);
        throwIfAborted(controller.signal);
        await this.#pyodide.runPythonAsync(source, { globals: scriptGlobals.value });
        throwIfAborted(controller.signal);
        const drained = await this.#pyodide.runPythonAsync(DRAIN_PLAN_SNIPPET);
        throwIfAborted(controller.signal);
        const plan = parseDrainedPlan(drained);
        validateDrainedPlan(plan);
        const result = await this.#workerClient.executeGraph(plan);
        throwIfAborted(controller.signal);
        if (!result || !Array.isArray(result.outputs)) {
          throw sessionError("runtime-protocol", "the VapourSynth worker returned invalid output metadata");
        }
        return { outputs: result.outputs };
      } catch (error) {
        await this.#workerClient.resetGraph().catch(() => {});
        if (error?.code && error.code !== "python-error") {
          throw error;
        }
        throw sessionError("python-error", `Python script failed: ${errorMessage(error)}`);
      } finally {
        scriptGlobals.dispose();
      }
    })();

    return {
      result: withScriptTimeLimit(execution, this.#scriptTimeoutMs, controller),
      // The caller receives the timeout immediately, but the interpreter queue
      // stays blocked until the underlying Pyodide call actually settles.
      // Abort checks then prevent any late plan drain or worker invocation.
      settled: execution,
    };
  }

  #enqueue(operation) {
    const started = this.#operationTail.then(operation, operation);
    const result = started.then((entry) => entry.result);
    this.#operationTail = started.then((entry) => entry.settled).catch(() => {});
    return result;
  }

  free() {
    if (this.#closed) {
      return;
    }

    this.#closed = true;
    this.#initialized = false;
    this.#unregisterRpcModule();
    this.#workerClient.close?.();
  }

  #assertOpen() {
    if (this.#closed) {
      throw sessionError("runtime-closed", "the Pyodide authoring runtime is closed");
    }
  }

  #assertReady() {
    this.#assertOpen();
    if (!this.#initialized) {
      throw sessionError("runtime-not-ready", "the Pyodide authoring runtime has not been initialized");
    }
  }

  #unregisterRpcModule() {
    try {
      this.#pyodide.unregisterJsModule?.(PYODIDE_RPC_MODULE);
    } catch {
      // A failed interpreter setup may already have removed the bridge.
    }
  }
}

function createScriptGlobals(pyodide, filename) {
  const dictConstructor = pyodide.globals?.get?.("dict");
  if (typeof dictConstructor !== "function") {
    throw sessionError("pyodide-protocol", "Pyodide does not expose the Python dict constructor");
  }

  const globals = dictConstructor();
  if (!globals || typeof globals.set !== "function") {
    dictConstructor.destroy?.();
    throw sessionError("pyodide-protocol", "Pyodide did not return a writable script namespace");
  }

  try {
    globals.set("__name__", "__vpy__");
    globals.set("__file__", filename);
  } catch (error) {
    globals.destroy?.();
    dictConstructor.destroy?.();
    throw sessionError("pyodide-protocol", `could not prepare the Python script namespace: ${errorMessage(error)}`);
  }

  return {
    value: globals,
    dispose() {
      globals.destroy?.();
      dictConstructor.destroy?.();
    },
  };
}

function validateSource(source, filename) {
  if (typeof source !== "string" || source.length > MAX_SOURCE_LENGTH) {
    throw sessionError("invalid-script", `source must be a string no longer than ${MAX_SOURCE_LENGTH} characters`);
  }
  if (typeof filename !== "string" || filename.length === 0 || filename.length > MAX_FILENAME_LENGTH) {
    throw sessionError("invalid-script", `filename must be a non-empty string no longer than ${MAX_FILENAME_LENGTH} characters`);
  }
}

function throwIfAborted(signal) {
  if (signal.aborted) {
    throw signal.reason ?? sessionError("script-timeout", "script execution was aborted");
  }
}

function parseDrainedPlan(value) {
  if (typeof value !== "string" || value.length === 0) {
    throw sessionError("runtime-protocol", "the Python runtime returned an unreadable graph plan");
  }
  try {
    return JSON.parse(value);
  } catch {
    throw sessionError("runtime-protocol", "the Python runtime returned an unreadable graph plan");
  }
}

function withScriptTimeLimit(execution, durationMs, controller) {
  const timeout = sessionError("script-timeout", `script exceeded the ${durationMs} ms wall-clock limit`);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      controller.abort(timeout);
      reject(timeout);
    }, durationMs);
    execution.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function sessionError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function errorMessage(error) {
  if (error && typeof error === "object" && typeof error.message === "string") {
    return error.message;
  }
  return String(error);
}
