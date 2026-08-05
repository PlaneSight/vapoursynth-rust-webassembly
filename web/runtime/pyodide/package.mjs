import { PYODIDE_RPC_MODULE } from "../../protocol/pyodide.mjs";

export const VAPOURSYNTH_MODULE_NAME = "vapoursynth";

const PACKAGE_SOURCE_URL = new URL("../../python/vapoursynth.py", import.meta.url);

export async function loadVapourSynthPackageSource(fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== "function") {
    throw new TypeError("fetchImpl must be a function");
  }

  const response = await fetchImpl(PACKAGE_SOURCE_URL);
  if (!response?.ok) {
    throw new Error(`could not load ${VAPOURSYNTH_MODULE_NAME} package source (${response?.status ?? "network error"})`);
  }

  const source = await response.text();
  if (typeof source !== "string" || source.trim().length === 0) {
    throw new Error(`${VAPOURSYNTH_MODULE_NAME} package source is empty`);
  }
  return source;
}

export function createPackageInstaller(source) {
  if (typeof source !== "string" || source.trim().length === 0) {
    throw new TypeError("package source must be a non-empty string");
  }

  return [
    "import sys as _vs_sys",
    "from types import ModuleType as _VsModuleType",
    `_vs_module_name = ${JSON.stringify(VAPOURSYNTH_MODULE_NAME)}`,
    `_vs_rpc_module_name = ${JSON.stringify(PYODIDE_RPC_MODULE)}`,
    "__import__(_vs_rpc_module_name)",
    "_vs_module = _VsModuleType(_vs_module_name)",
    "_vs_module.__file__ = '<vapoursynth browser package>'",
    "_vs_sys.modules[_vs_module_name] = _vs_module",
    "try:",
    `    exec(${JSON.stringify(source)}, _vs_module.__dict__)`,
    "except BaseException:",
    "    del _vs_sys.modules[_vs_module_name]",
    "    raise",
  ].join("\n");
}
