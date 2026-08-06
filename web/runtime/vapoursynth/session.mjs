const U32_MAX = 0xffff_ffff;

const MAX_OPERATIONS = 256;
const MAX_OUTPUTS = 64;
const MAX_ARGUMENTS = 64;
const MAX_ARRAY_VALUES = 4096;
const MAX_NAME_LENGTH = 64;
const MAX_DATA_LENGTH = 65_536;

export const BROWSER_AUTHORING_CAPABILITIES = Object.freeze({
  planVersion: 1,
  format: "RGB24",
});

const RESULT_KEY = "clip";
const RESULT_INDEX = 0;

/**
 * Owns the worker side of graph-plan authoring: strict plan validation, then
 * one generic native invocation per operation through the Emscripten session.
 * Node tokens are opaque native leases, never VapourSynth pointers, and every
 * lease is released on reset, failure, or shutdown.
 */
export class AuthoringSession {
  #runtime;
  #closed = false;
  #core = null;
  #nodes = new Map();
  #outputs = new Map();

  constructor(runtime) {
    const required = [
      "status",
      "core_create",
      "core_release",
      "invoke",
      "node_get_frame",
      "node_release",
      "frame_dimensions",
      "frame_rgba8_size",
      "frame_copy_rgba8",
      "frame_release",
    ];
    if (!runtime || typeof runtime !== "object") {
      throw new TypeError("runtime is required");
    }
    for (const methodName of required) {
      if (typeof runtime[methodName] !== "function") {
        throw new TypeError(`runtime must provide ${methodName}()`);
      }
    }
    this.#runtime = runtime;
  }

  status() {
    const rawStatus = this.#runtime.status();
    const parsedStatus = tryParseObject(rawStatus);
    if (!parsedStatus) {
      return rawStatus;
    }

    return JSON.stringify({
      ...parsedStatus,
      authoring: {
        available: !this.#closed,
        ...BROWSER_AUTHORING_CAPABILITIES,
      },
    });
  }

  /** Validates and executes one graph plan, retaining all native leases. */
  execute_graph(requestId, plan) {
    this.#assertOpen(requestId);
    validatePlan(plan, requestId);
    if (this.#core) {
      throw sessionError(requestId, "graph-active", "a graph is already active; reset the graph before executing another");
    }

    const core = this.#runtime.core_create(requestId);
    this.#core = core;
    try {
      for (const op of plan.operations) {
        const resolvedArguments = op.arguments.map((argument) => {
          if (argument.kind === "node") {
            return { ...argument, value: this.#requireNode(requestId, argument.value) };
          }
          if (argument.kind === "nodeArray") {
            return {
              ...argument,
              value: argument.value.map((value) => this.#requireNode(requestId, value)),
            };
          }
          return argument;
        });
        const token = this.#runtime.invoke(
          requestId,
          core,
          op.namespace,
          op.function,
          resolvedArguments,
          RESULT_KEY,
          RESULT_INDEX,
        );
        this.#nodes.set(op.id, token);
      }

      const outputs = [];
      for (const output of plan.outputs) {
        const nodeToken = this.#requireNode(requestId, output.node);
        const frameToken = this.#runtime.node_get_frame(requestId, nodeToken, 0);
        let width;
        let height;
        try {
          ({ width, height } = this.#runtime.frame_dimensions(requestId, frameToken));
        } finally {
          this.#runtime.frame_release(requestId, frameToken);
        }
        this.#outputs.set(output.index, { node: output.node, width, height });
        outputs.push({ index: output.index, width, height });
      }
      return { outputs };
    } catch (error) {
      this.#releaseGraph(requestId);
      throw error;
    }
  }

  render_output(requestId, index, frame) {
    this.#assertOpen(requestId);
    requireOutputIndex(index, requestId);
    requireFrameIndex(frame, requestId);
    const output = this.#outputs.get(index);
    if (!output) {
      throw sessionError(requestId, "missing-output", `no output is registered at index ${index}`);
    }

    const nodeToken = this.#requireNode(requestId, output.node);
    const frameToken = this.#runtime.node_get_frame(requestId, nodeToken, frame);
    try {
      const { width, height } = this.#runtime.frame_dimensions(requestId, frameToken);
      const rgba = this.#runtime.frame_copy_rgba8(requestId, frameToken);
      return { width, height, rgba };
    } finally {
      this.#runtime.frame_release(requestId, frameToken);
    }
  }

  reset_graph(requestId) {
    this.#assertOpen(requestId);
    this.#releaseGraph(requestId);
  }

  free() {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    this.#releaseGraph(0);
    this.#runtime.free?.();
  }

  #requireNode(requestId, opId) {
    const token = this.#nodes.get(opId);
    if (!token) {
      throw sessionError(requestId, "stale-node", `node ${opId} is no longer live`);
    }
    return token;
  }

  #releaseGraph(requestId) {
    for (const token of this.#nodes.values()) {
      try {
        this.#runtime.node_release(requestId, token);
      } catch {
        // Releases are best-effort cleanup; the core lease still owns state.
      }
    }
    this.#nodes.clear();
    this.#outputs.clear();

    if (this.#core) {
      try {
        this.#runtime.core_release(requestId, this.#core);
      } catch {
        // The core lease is freed by the runtime on shutdown regardless.
      }
      this.#core = null;
    }
  }

  #assertOpen(requestId) {
    if (this.#closed) {
      throw sessionError(requestId, "runtime-closed", "the VapourSynth authoring runtime is closed");
    }
  }
}

function validatePlan(plan, requestId) {
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) {
    throw sessionError(requestId, "invalid-plan", "plan must be an object");
  }
  if (plan.version !== 1) {
    throw sessionError(requestId, "invalid-plan", `unsupported graph plan version: ${String(plan.version)}`);
  }
  if (!Array.isArray(plan.operations)) {
    throw sessionError(requestId, "invalid-plan", "plan.operations must be an array");
  }
  if (!Array.isArray(plan.outputs)) {
    throw sessionError(requestId, "invalid-plan", "plan.outputs must be an array");
  }
  if (plan.operations.length > MAX_OPERATIONS) {
    throw sessionError(requestId, "plan-too-large", `a graph plan may contain at most ${MAX_OPERATIONS} operations`);
  }
  if (plan.outputs.length > MAX_OUTPUTS) {
    throw sessionError(requestId, "plan-too-large", `a graph plan may register at most ${MAX_OUTPUTS} outputs`);
  }

  const definedIds = new Set();
  for (const op of plan.operations) {
    validateOperation(op, requestId);
    if (definedIds.has(op.id)) {
      throw sessionError(requestId, "invalid-operation", `operation id ${op.id} is duplicated`);
    }
    definedIds.add(op.id);
  }

  const priorIds = new Set();
  for (const op of plan.operations) {
    for (const argument of op.arguments) {
      if (argument.kind === "node") {
        requirePriorNode(argument.value, priorIds, definedIds, requestId);
      } else if (argument.kind === "nodeArray") {
        for (const value of argument.value) {
          requirePriorNode(value, priorIds, definedIds, requestId);
        }
      }
    }
    priorIds.add(op.id);
  }

  const outputIndexes = new Set();
  for (const output of plan.outputs) {
    validateOutput(output, requestId);
    if (outputIndexes.has(output.index)) {
      throw sessionError(requestId, "invalid-output", `output index ${output.index} is duplicated`);
    }
    outputIndexes.add(output.index);
    if (!definedIds.has(output.node)) {
      throw sessionError(requestId, "unknown-node", `output node reference ${output.node} is unknown`);
    }
  }
}

function validateOperation(op, requestId) {
  if (!op || typeof op !== "object" || Array.isArray(op)) {
    throw sessionError(requestId, "invalid-operation", "each operation must be an object");
  }
  if (!Number.isInteger(op.id) || op.id <= 0 || op.id > U32_MAX) {
    throw sessionError(requestId, "invalid-operation", "operation id must be a non-zero u32");
  }
  requireName(op.namespace, requestId, "namespace");
  requireName(op.function, requestId, "function");
  if (!Array.isArray(op.arguments)) {
    throw sessionError(requestId, "invalid-operation", "operation arguments must be an array");
  }
  if (op.arguments.length > MAX_ARGUMENTS) {
    throw sessionError(requestId, "invalid-operation", `an operation may take at most ${MAX_ARGUMENTS} arguments`);
  }
  for (const argument of op.arguments) {
    validateArgument(argument, requestId);
  }
}

function validateArgument(argument, requestId) {
  if (!argument || typeof argument !== "object" || Array.isArray(argument)) {
    throw sessionError(requestId, "invalid-argument", "each argument must be an object");
  }
  requireName(argument.key, requestId, "argument key");

  switch (argument.kind) {
    case "int":
      requireSafeInt(argument.value, requestId);
      return;
    case "float":
      requireFiniteNumber(argument.value, requestId);
      return;
    case "data":
      requireData(argument.value, requestId);
      return;
    case "node":
      requireNodeValue(argument.value, requestId);
      return;
    case "intArray":
      requireValueArray(argument.value, requestId, "int", requireSafeInt);
      return;
    case "floatArray":
      requireValueArray(argument.value, requestId, "float", requireFiniteNumber);
      return;
    case "nodeArray":
      requireValueArray(argument.value, requestId, "node", requireNodeValue);
      return;
    default:
      throw sessionError(requestId, "invalid-argument", `unsupported argument kind: ${String(argument.kind)}`);
  }
}

function validateOutput(output, requestId) {
  if (!output || typeof output !== "object" || Array.isArray(output)) {
    throw sessionError(requestId, "invalid-output", "each output must be an object");
  }
  requireOutputIndex(output.index, requestId);
  requireNodeValue(output.node, requestId);
}

function requirePriorNode(value, priorIds, definedIds, requestId) {
  if (priorIds.has(value)) {
    return;
  }
  if (definedIds.has(value)) {
    throw sessionError(
      requestId,
      "forward-node",
      `node reference ${value} must precede its use (operations are topological)`,
    );
  }
  throw sessionError(requestId, "unknown-node", `node reference ${value} is unknown`);
}

function requireName(value, requestId, label) {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_NAME_LENGTH) {
    throw sessionError(
      requestId,
      "invalid-name",
      `${label} must be a non-empty string no longer than ${MAX_NAME_LENGTH} characters`,
    );
  }
}

function requireData(value, requestId) {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_DATA_LENGTH) {
    throw sessionError(
      requestId,
      "invalid-argument",
      `data arguments must be non-empty strings no longer than ${MAX_DATA_LENGTH} characters`,
    );
  }
}

function requireSafeInt(value, requestId) {
  if (!Number.isSafeInteger(value)) {
    throw sessionError(requestId, "invalid-argument", "int argument values must be safe integers");
  }
}

function requireFiniteNumber(value, requestId) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw sessionError(requestId, "invalid-argument", "float argument values must be finite numbers");
  }
}

function requireNodeValue(value, requestId) {
  if (!Number.isInteger(value) || value <= 0 || value > U32_MAX) {
    throw sessionError(requestId, "invalid-argument", "node references must be non-zero u32 operation ids");
  }
}

function requireValueArray(value, requestId, label, requireElement) {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_ARRAY_VALUES) {
    throw sessionError(
      requestId,
      "invalid-argument",
      `${label}Array arguments must hold between 1 and ${MAX_ARRAY_VALUES} values`,
    );
  }
  for (const element of value) {
    requireElement(element, requestId);
  }
}

function requireOutputIndex(value, requestId) {
  if (!Number.isInteger(value) || value < 0 || value > U32_MAX) {
    throw sessionError(requestId, "invalid-output", "output index must be a u32");
  }
}

function requireFrameIndex(value, requestId) {
  if (!Number.isInteger(value) || value < 0 || value > U32_MAX) {
    throw sessionError(requestId, "invalid-frame", "frame index must be a u32");
  }
}

function sessionError(requestId, code, message) {
  const error = new Error(message);
  error.requestId = requestId;
  error.code = code;
  return error;
}

function tryParseObject(value) {
  if (typeof value !== "string") {
    return undefined;
  }

  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}
