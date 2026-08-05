import { createWorkerHandler } from "./worker-protocol.mjs";

export function installWorkerRuntime(scope, session) {
  if (!scope || typeof scope.postMessage !== "function") {
    throw new TypeError("scope must provide postMessage()");
  }

  const handle = createWorkerHandler(session);

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
            message: error?.message ?? "invalid worker request",
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

export async function startWorkerRuntime({ scope = globalThis, loadHost }) {
  if (typeof loadHost !== "function") {
    throw new TypeError("loadHost must be a function");
  }

  const host = await loadHost();
  if (!host || typeof host.WorkerSession !== "function") {
    throw new TypeError("host module must export WorkerSession");
  }

  const session = new host.WorkerSession();
  return installWorkerRuntime(scope, session);
}
