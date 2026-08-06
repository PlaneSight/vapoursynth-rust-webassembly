const SCHEMA_VERSION = 1;
const MAX_SOURCE_LENGTH = 1_000_000;
const U32_MAX = 0xffff_ffff;

export const PLAN_SCHEMA_VERSION = 1;
export const MAX_PLAN_OPERATIONS = 64;
export const MAX_PLAN_ARGUMENTS = 64;
export const MAX_PLAN_ARRAY_LENGTH = 4_096;
export const MAX_PLAN_DATA_LENGTH = 65_536;
export const MAX_PLAN_NAME_LENGTH = 64;
export const MAX_PLAN_OUTPUTS = 16;
export const MAX_SCRIPT_DURATION_MS = 30_000;

const PLAN_ARGUMENT_KINDS = new Set(["int", "float", "data", "node", "intArray", "floatArray", "nodeArray"]);

/**
 * Validates a plan drained from the Python authoring module before it is
 * forwarded to the VapourSynth worker. Count and array-length violations
 * reject with "plan-limit"; structural violations reject with "invalid-plan".
 * The validated plan is returned unchanged.
 */
export function validateDrainedPlan(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw planError("invalid-plan", "drained plan must be an object");
  }
  if (value.version !== PLAN_SCHEMA_VERSION) {
    throw planError("invalid-plan", `drained plan must declare schema version ${PLAN_SCHEMA_VERSION}`);
  }
  if (!Array.isArray(value.operations)) {
    throw planError("invalid-plan", "drained plan operations must be an array");
  }
  if (value.operations.length > MAX_PLAN_OPERATIONS) {
    throw planError("plan-limit", `drained plan exceeds the ${MAX_PLAN_OPERATIONS} operation limit`);
  }

  const operationIds = new Set();
  for (const operation of value.operations) {
    validatePlanOperation(operation, operationIds);
  }

  if (!Array.isArray(value.outputs)) {
    throw planError("invalid-plan", "drained plan outputs must be an array");
  }
  if (value.outputs.length > MAX_PLAN_OUTPUTS) {
    throw planError("plan-limit", `drained plan exceeds the ${MAX_PLAN_OUTPUTS} output limit`);
  }
  for (const output of value.outputs) {
    validatePlanOutput(output, operationIds);
  }

  return value;
}

function validatePlanOperation(operation, operationIds) {
  if (!operation || typeof operation !== "object" || Array.isArray(operation)) {
    throw planError("invalid-plan", "drained plan operation must be an object");
  }
  if (!Number.isInteger(operation.id) || operation.id <= 0 || operation.id > U32_MAX) {
    throw planError("invalid-plan", "drained plan operation id must be a non-zero u32");
  }
  if (operationIds.has(operation.id)) {
    throw planError("invalid-plan", `drained plan repeats operation id ${operation.id}`);
  }
  if (typeof operation.namespace !== "string" || operation.namespace.length === 0 || operation.namespace.length > MAX_PLAN_NAME_LENGTH) {
    throw planError("invalid-plan", "drained plan operation namespace must be a non-empty string");
  }
  if (typeof operation.function !== "string" || operation.function.length === 0 || operation.function.length > MAX_PLAN_NAME_LENGTH) {
    throw planError("invalid-plan", "drained plan operation function must be a non-empty string");
  }
  if (!Array.isArray(operation.arguments)) {
    throw planError("invalid-plan", "drained plan operation arguments must be an array");
  }
  if (operation.arguments.length > MAX_PLAN_ARGUMENTS) {
    throw planError("plan-limit", `drained plan operation exceeds the ${MAX_PLAN_ARGUMENTS} argument limit`);
  }

  for (const argument of operation.arguments) {
    validatePlanArgument(argument, operationIds);
  }
  operationIds.add(operation.id);
}

function validatePlanArgument(argument, operationIds) {
  if (!argument || typeof argument !== "object" || Array.isArray(argument)) {
    throw planError("invalid-plan", "drained plan argument must be an object");
  }
  if (typeof argument.key !== "string" || argument.key.length === 0 || argument.key.length > MAX_PLAN_NAME_LENGTH) {
    throw planError("invalid-plan", "drained plan argument key must be a non-empty string");
  }
  if (!PLAN_ARGUMENT_KINDS.has(argument.kind)) {
    throw planError("invalid-plan", `drained plan argument kind ${JSON.stringify(argument.kind)} is unsupported`);
  }

  switch (argument.kind) {
    case "int":
      if (!Number.isSafeInteger(argument.value)) {
        throw planError("invalid-plan", `drained plan argument "${argument.key}" must be an int`);
      }
      break;
    case "float":
      if (typeof argument.value !== "number" || !Number.isFinite(argument.value)) {
        throw planError("invalid-plan", `drained plan argument "${argument.key}" must be a float`);
      }
      break;
    case "data":
      if (typeof argument.value !== "string" || argument.value.length === 0 || argument.value.length > MAX_PLAN_DATA_LENGTH) {
        throw planError("invalid-plan", `drained plan argument "${argument.key}" must be a data string`);
      }
      break;
    case "node":
      requirePlanNodeReference(argument.value, operationIds, `drained plan argument "${argument.key}"`);
      break;
    case "intArray":
      requirePlanArray(
        argument.value,
        `drained plan argument "${argument.key}"`,
        (item) => Number.isInteger(item),
        "int",
      );
      break;
    case "floatArray":
      requirePlanArray(
        argument.value,
        `drained plan argument "${argument.key}"`,
        (item) => typeof item === "number" && Number.isFinite(item),
        "float",
      );
      break;
    case "nodeArray":
      requirePlanArray(
        argument.value,
        `drained plan argument "${argument.key}"`,
        (item) => operationIds.has(item),
        "prior operation reference",
      );
      break;
  }
}

function requirePlanArray(value, label, isValid, itemKind) {
  if (!Array.isArray(value) || value.length === 0) {
    throw planError("invalid-plan", `${label} must be a non-empty array`);
  }
  if (value.length > MAX_PLAN_ARRAY_LENGTH) {
    throw planError("plan-limit", `${label} exceeds the ${MAX_PLAN_ARRAY_LENGTH} element limit`);
  }
  for (const item of value) {
    if (!isValid(item)) {
      throw planError("invalid-plan", `${label} items must be ${itemKind}s`);
    }
  }
}

function requirePlanNodeReference(value, operationIds, label) {
  if (!Number.isInteger(value) || !operationIds.has(value)) {
    throw planError("invalid-plan", `${label} must reference a prior planned operation`);
  }
}

function validatePlanOutput(output, operationIds) {
  if (!output || typeof output !== "object" || Array.isArray(output)) {
    throw planError("invalid-plan", "drained plan output must be an object");
  }
  if (!Number.isInteger(output.index) || output.index < 0 || output.index > U32_MAX) {
    throw planError("invalid-plan", "drained plan output index must be a u32");
  }
  if (!Number.isInteger(output.node) || !operationIds.has(output.node)) {
    throw planError("invalid-plan", "drained plan output node must reference a planned operation");
  }
}

function planError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

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

/**
 * The JS module name the Python package installer imports. The forwarding RPC
 * bridge was removed when graph plans moved to Python-side recording; the
 * name stays importable because the installer imports it unconditionally
 * (see web/runtime/pyodide/package.mjs).
 */
export const PYODIDE_RPC_MODULE = "_vapoursynth_rpc";
