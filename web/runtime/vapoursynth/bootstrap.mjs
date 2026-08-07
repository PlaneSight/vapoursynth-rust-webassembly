import { AuthoringSession } from "./session.mjs";
import { COMPILED_THREADING_MODE } from "./threading.mjs";
import {
  EmscriptenSession,
  UnavailableEmscriptenSession,
  resolveThreadingStatus,
} from "../emscripten/session.mjs";
import { installWorkerRuntime } from "./worker.mjs";

export async function startVapourSynthWorker({
  scope = globalThis,
  loadModule = loadDefaultModule,
  compiledMode = COMPILED_THREADING_MODE,
  crossOriginIsolated = globalThis.crossOriginIsolated === true,
  sharedArrayBufferAvailable = typeof globalThis.SharedArrayBuffer === "function",
} = {}) {
  if (typeof loadModule !== "function") {
    throw new TypeError("loadModule must be a function");
  }

  // A pthread-enabled Emscripten factory can fail while constructing its
  // shared WebAssembly.Memory. Resolve browser prerequisites first so an
  // unavailable threaded artifact still reaches the status protocol.
  const preflight = resolveThreadingStatus({}, {
    compiledMode,
    requestedMode: compiledMode,
    crossOriginIsolated,
    sharedArrayBufferAvailable,
  });
  const runtime = preflight.available
    ? new EmscriptenSession(await loadModule(), {
      requestedMode: compiledMode,
      crossOriginIsolated,
      sharedArrayBufferAvailable,
    })
    : new UnavailableEmscriptenSession(preflight);

  installWorkerRuntime(scope, new AuthoringSession(runtime));
  scope.postMessage({ schemaVersion: 1, type: "ready" });
}

async function loadDefaultModule() {
  const { default: createModule } = await import("../vapoursynth-browser-module.js");
  return createModule();
}

if (typeof self !== "undefined" && self === globalThis) {
  try {
    await startVapourSynthWorker();
  } catch (error) {
    globalThis.postMessage({
      schemaVersion: 1,
      type: "bootstrap-error",
      error: {
        code: "worker-bootstrap-error",
        message: error?.message ?? "VapourSynth worker bootstrap failed",
      },
    });
    throw error;
  }
}
