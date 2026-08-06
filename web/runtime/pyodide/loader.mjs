export const PYODIDE_VERSION = "0.29.4";
export const DEFAULT_PYODIDE_INDEX_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

const INDEX_URL_QUERY_PARAM = "indexURL";

/**
 * Resolves the Pyodide index URL a self-hosted deployment may pin: the
 * `indexURL` query parameter on the bootstrap module URL when present, else
 * the pinned CDN default. A missing, empty, or unparseable override keeps the
 * default, so a bad override can never weaken the pinned distribution.
 */
export function resolvePyodideIndexUrl(moduleUrl, { defaultIndexUrl = DEFAULT_PYODIDE_INDEX_URL } = {}) {
  let url;
  try {
    url = new URL(moduleUrl);
  } catch {
    return defaultIndexUrl;
  }

  const override = url.searchParams.get(INDEX_URL_QUERY_PARAM);
  if (typeof override !== "string" || override.length === 0) {
    return defaultIndexUrl;
  }

  try {
    return new URL(override.endsWith("/") ? override : `${override}/`, url).href;
  } catch {
    return defaultIndexUrl;
  }
}

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
