const SCHEMA_VERSION = 1;

export function createWorkerHandler(session) {
  if (!session || typeof session.status !== "function" || typeof session.execute_graph !== "function" || typeof session.render_output !== "function") {
    throw new TypeError("session must provide status(), execute_graph(), and render_output()");
  }

  return async function handleWorkerMessage(message) {
    const request = validateRequest(message);

    try {
      switch (request.type) {
        case "status":
          return success(request.requestId, "status", parseJson(session.status()));
        case "executeGraph":
          return success(
            request.requestId,
            "outputs",
            await callSession(session, "execute_graph", request),
          );
        case "renderOutput": {
          const frame = await callSession(session, "render_output", request);
          const rgba = normalizeBytes(frame?.rgba);
          const response = success(request.requestId, "frame", {
            width: requireDimension(frame?.width, request.requestId, "runtime frame width"),
            height: requireDimension(frame?.height, request.requestId, "runtime frame height"),
            rgba: rgba.buffer,
          });
          response.transfer.push(rgba.buffer);
          return response;
        }
        case "resetGraph":
          await callSession(session, "reset_graph", request);
          return success(request.requestId, "reset", {});
        default:
          throw protocolError(request.requestId, "unsupported-request", `unsupported request type: ${request.type}`);
      }
    } catch (error) {
      return failure(request.requestId, normalizeError(error));
    }
  };
}

function validateRequest(message) {
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    throw protocolError(0, "invalid-request", "worker request must be an object");
  }

  const requestId = message.requestId;
  if (!Number.isInteger(requestId) || requestId <= 0 || requestId > 0xffff_ffff) {
    throw protocolError(0, "invalid-request", "requestId must be a non-zero u32");
  }

  if (typeof message.type !== "string" || message.type.length === 0) {
    throw protocolError(requestId, "invalid-request", "type must be a non-empty string");
  }

  switch (message.type) {
    case "executeGraph":
      return {
        requestId,
        type: message.type,
        plan: requirePlan(message.plan, requestId),
      };
    case "renderOutput":
      return {
        requestId,
        type: message.type,
        index: requireOutputIndex(message.index, requestId),
        frame: requireOutputIndex(message.frame, requestId),
      };
    default:
      return { requestId, type: message.type };
  }
}

function requirePlan(value, requestId) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw protocolError(requestId, "invalid-plan", "plan must be an object");
  }
  return value;
}

function requireOutputIndex(value, requestId) {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw protocolError(requestId, "invalid-output", "output index must be a u32");
  }
  return value;
}

function requireDimension(value, requestId, name) {
  if (!Number.isInteger(value) || value <= 0 || value > 0xffff_ffff) {
    throw protocolError(requestId, "runtime-protocol", `${name} must be a non-zero u32`);
  }
  return value;
}

async function callSession(session, methodName, request) {
  const method = session[methodName];
  if (typeof method !== "function") {
    throw protocolError(
      request.requestId,
      "unsupported-request",
      `the worker runtime does not implement ${request.type}`,
    );
  }

  switch (request.type) {
    case "executeGraph":
      return method.call(session, request.requestId, request.plan);
    case "renderOutput":
      return method.call(session, request.requestId, request.index, request.frame);
    case "resetGraph":
      return method.call(session, request.requestId);
    default:
      throw protocolError(request.requestId, "unsupported-request", `unsupported request type: ${request.type}`);
  }
}

function normalizeBytes(value) {
  if (value instanceof Uint8Array) {
    if (value.byteOffset === 0 && value.byteLength === value.buffer.byteLength) {
      return value;
    }
    return value.slice();
  }

  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }

  throw protocolError(0, "runtime-protocol", "runtime returned a non-byte frame payload");
}

function success(requestId, type, payload) {
  return {
    message: {
      schemaVersion: SCHEMA_VERSION,
      requestId,
      ok: true,
      type,
      payload,
    },
    transfer: [],
  };
}

function failure(requestId, error) {
  return {
    message: {
      schemaVersion: SCHEMA_VERSION,
      requestId,
      ok: false,
      error,
    },
    transfer: [],
  };
}

function protocolError(requestId, code, message) {
  return { requestId, code, message };
}

function normalizeError(error) {
  if (error && typeof error === "object") {
    if (typeof error.code === "string" && typeof error.message === "string") {
      return { code: error.code, message: error.message };
    }

    if (typeof error.message === "string") {
      const parsed = tryParseJson(error.message);
      if (parsed?.error?.code && parsed?.error?.message) {
        return {
          code: parsed.error.code,
          message: parsed.error.message,
        };
      }
      return { code: "runtime-error", message: error.message };
    }
  }

  if (typeof error === "string") {
    const parsed = tryParseJson(error);
    if (parsed?.error?.code && parsed?.error?.message) {
      return {
        code: parsed.error.code,
        message: parsed.error.message,
      };
    }
    return { code: "runtime-error", message: error };
  }

  return { code: "runtime-error", message: "unknown worker runtime failure" };
}

function parseJson(value) {
  const parsed = tryParseJson(value);
  if (parsed === undefined) {
    throw protocolError(0, "runtime-protocol", "runtime returned invalid JSON status");
  }
  return parsed;
}

function tryParseJson(value) {
  if (typeof value !== "string") {
    return undefined;
  }

  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}
