import createModule from "./runtime/vapoursynth-browser-module.js";
import { AuthoringSession } from "./authoring-session.mjs";
import { EmscriptenSession } from "./emscripten-session.mjs";
import { installWorkerRuntime } from "./worker-runtime.mjs";

const module = await createModule();
installWorkerRuntime(globalThis, new AuthoringSession(new EmscriptenSession(module)));
