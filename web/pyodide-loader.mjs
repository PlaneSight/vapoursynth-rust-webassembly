export const PYODIDE_VERSION = "0.29.4";
export const DEFAULT_PYODIDE_INDEX_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

/** Loads a pinned Pyodide distribution, or a self-hosted compatible copy. */
export async function loadBrowserPyodide({ indexURL = DEFAULT_PYODIDE_INDEX_URL } = {}) {
  if (typeof indexURL !== "string" || indexURL.length === 0) {
    throw new TypeError("indexURL must be a non-empty string");
  }

  const normalizedIndexUrl = indexURL.endsWith("/") ? indexURL : `${indexURL}/`;
  const moduleUrl = new URL("pyodide.mjs", normalizedIndexUrl).href;
  const { loadPyodide } = await import(moduleUrl);
  return loadPyodide({ indexURL: normalizedIndexUrl });
}
