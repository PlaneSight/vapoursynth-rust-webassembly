const U32_MAX = 0xffff_ffff;

export const PYODIDE_RPC_MODULE = "_vapoursynth_rpc";

/**
 * Makes the worker client available to Pyodide as a tiny asynchronous module.
 * Python sees promises as awaitables; it never sees the Emscripten module or a
 * native VapourSynth resource.
 */
export function createPyodideRpc(workerClient) {
  assertMethods(workerClient, [
    "createBlankClip",
    "invert",
    "setOutput",
    "releaseNode",
  ]);

  return Object.freeze({
    async create_blank_clip(width, height, format, length) {
      const node = await workerClient.createBlankClip(width, height, format, length);
      return requireNodeId(node?.nodeId);
    },

    async invert(nodeId) {
      const node = await workerClient.invert(nodeId);
      return requireNodeId(node?.nodeId);
    },

    async set_output(index, nodeId) {
      await workerClient.setOutput(index, nodeId);
    },

    async release_node(nodeId) {
      await workerClient.releaseNode(nodeId);
    },

    release_node_later(nodeId) {
      void Promise.resolve()
        .then(() => workerClient.releaseNode(nodeId))
        .catch(() => {});
    },
  });
}

function assertMethods(value, methodNames) {
  if (!value || typeof value !== "object") {
    throw new TypeError("workerClient must be an object");
  }

  for (const methodName of methodNames) {
    if (typeof value[methodName] !== "function") {
      throw new TypeError(`workerClient must provide ${methodName}()`);
    }
  }
}

function requireNodeId(value) {
  if (!Number.isInteger(value) || value <= 0 || value > U32_MAX) {
    const error = new Error("worker returned an invalid opaque VideoNode token");
    error.code = "rpc-protocol";
    throw error;
  }
  return value;
}
