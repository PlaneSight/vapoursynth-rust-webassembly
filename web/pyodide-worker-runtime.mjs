import { PyodideSession } from "./pyodide-session.mjs";
import { WorkerClient } from "./worker-client.mjs";
import { createPyodideWorkerHandler } from "./pyodide-worker-protocol.mjs";

export function installPyodideWorkerRuntime(scope, session) {
  if (!scope || typeof scope.postMessage !== "function") {
    throw new TypeError("scope must provide postMessage()");
  }

  const handle = createPyodideWorkerHandler(session);
  scope.onmessage = async ({ data }) => {
    let response;
    try {
      response = await handle(data);
    } catch (error) {
      response = {
        message: {
          schemaVersion: 1,
          requestId: error?.requestId ?? 0,
          ok: false,
          error: {
            code: error?.code ?? "invalid-request",
            message: error?.message ?? "invalid Python worker request",
          },
        },
        transfer: [],
      };
    }
    scope.postMessage(response.message, response.transfer);
  };

  return () => {
    scope.onmessage = null;
    session.free?.();
    scope.close?.();
  };
}

/**
 * Starts the two-worker runtime. Pyodide owns scripts and an ordinary
 * WorkerClient; the nested VapourSynth worker alone owns upstream resources.
 */
export async function startPyodideWorkerRuntime({
  scope = globalThis,
  loadPyodide,
  createVapourSynthWorker,
  loadPackageSource,
}) {
  if (typeof loadPyodide !== "function") {
    throw new TypeError("loadPyodide must be a function");
  }
  if (typeof createVapourSynthWorker !== "function") {
    throw new TypeError("createVapourSynthWorker must be a function");
  }
  if (typeof loadPackageSource !== "function") {
    throw new TypeError("loadPackageSource must be a function");
  }

  const worker = createVapourSynthWorker();
  try {
    const [pyodide, packageSource] = await Promise.all([loadPyodide(), loadPackageSource()]);
    const session = new PyodideSession({
      pyodide,
      workerClient: new WorkerClient(worker),
      packageSource,
    });
    await session.initialize();
    return installPyodideWorkerRuntime(scope, session);
  } catch (error) {
    worker?.terminate?.();
    throw error;
  }
}
