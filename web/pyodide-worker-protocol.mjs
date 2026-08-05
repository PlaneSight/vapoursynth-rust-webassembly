const SCHEMA_VERSION = 1;
const MAX_SOURCE_LENGTH = 1_000_000;

export function createPyodideWorkerHandler(session) {
  if (!session || typeof session.status !== "function" || typeof session.runScript !== "function" || typeof session.renderOutput !== "function") {
    throw new TypeError("session must provide status(), runScript(), and renderOutput()");
  }

  return async function handlePyodideWorkerMessage(message) {
    const request = validateRequest(message);

    try {
      switch (request.type) {
        case "status":
          return success(request.requestId, "status", await requireObject(session.status(), request.requestId, "status"));
        case "runScript": {
          const result = await session.runScript(request.source, request.filename);
          if (!result || !Array.isArray(result.outputs)) {
            throw protocolError(request.requestId, "runtime-protocol", "Python runtime returned invalid output metadata");
          }
          return success(request.requestId, "outputs", result);
        }
        case "renderOutput": {
          const frame = await session.renderOutput(request.index, request.frame);
          const rgba = normalizeBytes(frame?.rgba);
          const response = success(request.requestId, "frame", {
            width: requireDimension(frame?.width, request.requestId, "runtime frame width"),
            height: requireDimension(frame?.height, request.requestId, "runtime frame height"),
            rgba: rgba.buffer,
          });
          response.transfer.push(rgba.buffer);
          return response;
        }
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
    throw protocolError(0, "invalid-request", "Python worker request must be an object");
  }

  const requestId = message.requestId;
  if (!Number.isInteger(requestId) || requestId <= 0 || requestId > 0xffff_ffff) {
    throw protocolError(0, "invalid-request", "requestId must be a non-zero u32");
  }
  if (typeof message.type !== "string" || message.type.length === 0) {
    throw protocolError(requestId, "invalid-request", "type must be a non-empty string");
  }

  switch (message.type) {
    case "status":
      return { requestId, type: message.type };
    case "runScript":
      return {
        requestId,
        type: message.type,
        source: requireSource(message.source, requestId),
        filename: requireFilename(message.filename, requestId),
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

function requireSource(value, requestId) {
  if (typeof value !== "string" || value.length > MAX_SOURCE_LENGTH) {
    throw protocolError(requestId, "invalid-script", `source must be a string no longer than ${MAX_SOURCE_LENGTH} characters`);
  }
  return value;
}

function requireFilename(value, requestId) {
  if (typeof value !== "string" || value.length === 0 || value.length > 256) {
    throw protocolError(requestId, "invalid-script", "filename must be a non-empty string no longer than 256 characters");
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

async function requireObject(value, requestId, name) {
  const resolved = await value;
  if (!resolved || typeof resolved !== "object" || Array.isArray(resolved)) {
    throw protocolError(requestId, "runtime-protocol", `Python runtime returned invalid ${name} metadata`);
  }
  return resolved;
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
  throw protocolError(0, "runtime-protocol", "Python runtime returned a non-byte frame payload");
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
  if (error && typeof error === "object" && typeof error.code === "string" && typeof error.message === "string") {
    return { code: error.code, message: error.message };
  }
  if (error && typeof error === "object" && typeof error.message === "string") {
    return { code: "runtime-error", message: error.message };
  }
  if (typeof error === "string") {
    return { code: "runtime-error", message: error };
  }
  return { code: "runtime-error", message: "unknown Python worker runtime failure" };
}
