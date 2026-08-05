import { AuthoringSession } from "./session.mjs";
import { EmscriptenSession } from "../emscripten/session.mjs";
import { installWorkerRuntime } from "./worker-runtime.mjs";

try {
  const { default: createModule } = await import("../vapoursynth-browser-module.js");
  const module = await createModule();
  installWorkerRuntime(globalThis, new AuthoringSession(new EmscriptenSession(module)));
  globalThis.postMessage({ schemaVersion: 1, type: "ready" });
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
