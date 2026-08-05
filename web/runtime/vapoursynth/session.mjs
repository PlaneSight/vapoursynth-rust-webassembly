const U32_MAX = 0xffff_ffff;

export const BROWSER_AUTHORING_CAPABILITIES = Object.freeze({
  format: "RGB24",
  functions: Object.freeze(["std.BlankClip", "std.Invert"]),
  singleFrameOnly: true,
});

/**
 * Owns browser-authoring graph descriptions above the narrow Emscripten render
 * primitive. The descriptions are opaque worker state, never VapourSynth
 * pointers, and an output retains its graph after the Python-facing node token
 * has been released.
 */
export class AuthoringSession {
  #runtime;
  #closed = false;
  #nextNodeId = 1;
  #nodes = new Map();
  #outputs = new Map();

  constructor(runtime) {
    if (!runtime || typeof runtime.status !== "function" || typeof runtime.render_blank_frame !== "function") {
      throw new TypeError("runtime must provide status() and render_blank_frame()");
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

  render_blank_frame(requestId, width, height) {
    this.#assertOpen(requestId);
    return this.#runtime.render_blank_frame(requestId, width, height);
  }

  create_blank_clip(requestId, width, height, format, length) {
    this.#assertOpen(requestId);
    requireDimension(width, requestId, "width");
    requireDimension(height, requestId, "height");
    requireRgb24(format, requestId);
    requireSingleFrame(length, requestId);

    const graph = Object.freeze({
      operation: "blank",
      width,
      height,
      format,
      length,
    });
    const nodeId = this.#allocateNodeId(requestId);
    this.#nodes.set(nodeId, graph);
    return describeNode(nodeId, graph);
  }

  invert(requestId, nodeId) {
    this.#assertOpen(requestId);
    const source = this.#requireNode(requestId, nodeId);
    if (source.operation !== "blank") {
      throw sessionError(
        requestId,
        "unsupported-graph",
        "the browser runtime supports std.Invert only directly after std.BlankClip",
      );
    }

    const graph = Object.freeze({
      operation: "invert",
      source,
      width: source.width,
      height: source.height,
      format: source.format,
      length: source.length,
    });
    const invertedNodeId = this.#allocateNodeId(requestId);
    this.#nodes.set(invertedNodeId, graph);
    return describeNode(invertedNodeId, graph);
  }

  set_output(requestId, index, nodeId) {
    this.#assertOpen(requestId);
    requireOutputIndex(index, requestId);
    const graph = this.#requireNode(requestId, nodeId);
    this.#outputs.set(index, graph);
    return describeOutput(index, graph);
  }

  list_outputs(requestId) {
    this.#assertOpen(requestId);
    return {
      outputs: [...this.#outputs.entries()]
        .sort(([left], [right]) => left - right)
        .map(([index, graph]) => describeOutput(index, graph)),
    };
  }

  async render_output(requestId, index, frame) {
    this.#assertOpen(requestId);
    requireOutputIndex(index, requestId);
    requireFrameIndex(frame, requestId);
    const graph = this.#outputs.get(index);
    if (!graph) {
      throw sessionError(requestId, "missing-output", `no output is registered at index ${index}`);
    }

    if (graph.operation !== "invert" || graph.source.operation !== "blank") {
      throw sessionError(
        requestId,
        "unsupported-graph",
        "the browser runtime can render only std.BlankClip followed by std.Invert",
      );
    }

    return {
      width: graph.width,
      height: graph.height,
      rgba: await this.#runtime.render_blank_frame(requestId, graph.width, graph.height),
    };
  }

  release_node(requestId, nodeId) {
    this.#assertOpen(requestId);
    requireNodeId(nodeId, requestId);
    if (!this.#nodes.delete(nodeId)) {
      throw sessionError(requestId, "stale-node", `node ${nodeId} is no longer live`);
    }
  }

  reset_graph(requestId) {
    this.#assertOpen(requestId);
    this.#nodes.clear();
    this.#outputs.clear();
  }

  free() {
    if (this.#closed) {
      return;
    }

    this.#closed = true;
    this.#nodes.clear();
    this.#outputs.clear();
    this.#runtime.free?.();
  }

  #assertOpen(requestId) {
    if (this.#closed) {
      throw sessionError(requestId, "runtime-closed", "the VapourSynth authoring runtime is closed");
    }
  }

  #allocateNodeId(requestId) {
    if (this.#nextNodeId > U32_MAX) {
      throw sessionError(requestId, "node-id-exhausted", "the authoring node identifier space is exhausted");
    }

    const nodeId = this.#nextNodeId;
    this.#nextNodeId += 1;
    return nodeId;
  }

  #requireNode(requestId, nodeId) {
    requireNodeId(nodeId, requestId);
    const graph = this.#nodes.get(nodeId);
    if (!graph) {
      throw sessionError(requestId, "stale-node", `node ${nodeId} is no longer live`);
    }
    return graph;
  }
}

function describeNode(nodeId, graph) {
  return {
    nodeId,
    width: graph.width,
    height: graph.height,
    format: graph.format,
    length: graph.length,
  };
}

function describeOutput(index, graph) {
  return {
    index,
    width: graph.width,
    height: graph.height,
    format: graph.format,
    length: graph.length,
  };
}

function requireDimension(value, requestId, name) {
  if (!Number.isInteger(value) || value <= 0 || value > U32_MAX) {
    throw sessionError(requestId, "invalid-dimensions", `${name} must be a non-zero u32`);
  }
}

function requireRgb24(value, requestId) {
  if (typeof value !== "string" || value.length === 0) {
    throw sessionError(requestId, "invalid-format", "format must be a non-empty string");
  }
  if (value !== BROWSER_AUTHORING_CAPABILITIES.format) {
    throw sessionError(requestId, "unsupported-format", `unsupported browser format: ${value}`);
  }
}

function requireSingleFrame(value, requestId) {
  if (!Number.isInteger(value) || value <= 0 || value > U32_MAX) {
    throw sessionError(requestId, "invalid-length", "length must be a non-zero u32");
  }
  if (value !== 1) {
    throw sessionError(requestId, "unsupported-length", "the browser runtime supports only length=1");
  }
}

function requireNodeId(value, requestId) {
  if (!Number.isInteger(value) || value <= 0 || value > U32_MAX) {
    throw sessionError(requestId, "invalid-node", "nodeId must be a non-zero u32");
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
  if (value !== 0) {
    throw sessionError(requestId, "unsupported-frame", "the browser runtime supports only frame 0");
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
