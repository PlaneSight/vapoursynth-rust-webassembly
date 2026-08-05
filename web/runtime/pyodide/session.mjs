import { createPackageInstaller } from "./package.mjs";
import { createPyodideRpc, PYODIDE_RPC_MODULE } from "../../protocol/pyodide.mjs";

const MAX_SOURCE_LENGTH = 1_000_000;
const MAX_FILENAME_LENGTH = 256;

/** Owns one Pyodide interpreter and its dedicated VapourSynth worker client. */
export class PyodideSession {
  #pyodide;
  #workerClient;
  #packageSource;
  #initialized = false;
  #closed = false;
  #operationTail = Promise.resolve();

  constructor({ pyodide, workerClient, packageSource }) {
    if (!pyodide || typeof pyodide.registerJsModule !== "function" || typeof pyodide.runPythonAsync !== "function") {
      throw new TypeError("pyodide must provide registerJsModule() and runPythonAsync()");
    }
    if (!workerClient || typeof workerClient.status !== "function" || typeof workerClient.resetGraph !== "function" || typeof workerClient.listOutputs !== "function" || typeof workerClient.renderOutput !== "function") {
      throw new TypeError("workerClient must provide the authoring worker API");
    }
    if (typeof packageSource !== "string" || packageSource.trim().length === 0) {
      throw new TypeError("packageSource must be a non-empty string");
    }

    this.#pyodide = pyodide;
    this.#workerClient = workerClient;
    this.#packageSource = packageSource;
  }

  async initialize() {
    this.#assertOpen();
    if (this.#initialized) {
      return;
    }

    this.#pyodide.registerJsModule(PYODIDE_RPC_MODULE, createPyodideRpc(this.#workerClient));
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
    return this.#enqueue(() => this.#runScript(source, filename));
  }

  renderOutput(index, frame = 0) {
    return this.#enqueue(async () => {
      this.#assertReady();
      return this.#workerClient.renderOutput(index, frame);
    });
  }

  async #runScript(source, filename) {
    this.#assertReady();
    validateSource(source, filename);
    await this.#workerClient.resetGraph();

    const scriptGlobals = createScriptGlobals(this.#pyodide, filename);
    try {
      await this.#pyodide.runPythonAsync(source, { globals: scriptGlobals.value });
      const result = await this.#workerClient.listOutputs();
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
  }

  #enqueue(operation) {
    const result = this.#operationTail.then(operation, operation);
    this.#operationTail = result.catch(() => {});
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
