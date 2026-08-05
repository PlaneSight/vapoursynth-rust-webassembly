import createModule from "../build/browser/native/vapoursynth-browser-module.js";
import { EmscriptenSession } from "./emscripten-session.mjs";
import { installWorkerRuntime } from "./worker-runtime.mjs";

const module = await createModule();
installWorkerRuntime(globalThis, new EmscriptenSession(module));
