import assert from "node:assert/strict";
import test from "node:test";

import { createPackageInstaller, loadVapourSynthPackageSource } from "../../runtime/pyodide/package.mjs";
import { DEFAULT_PYODIDE_INDEX_URL, loadBrowserPyodide, PYODIDE_VERSION } from "../../runtime/pyodide/loader.mjs";

test("loads the checked-in Python package through an injectable fetch boundary", async () => {
  let requestedUrl;
  const source = await loadVapourSynthPackageSource(async (url) => {
    requestedUrl = url;
    return {
      ok: true,
      async text() {
        return "import _vapoursynth_rpc";
      },
    };
  });

  assert.equal(requestedUrl.pathname.endsWith("/web/python/vapoursynth.py"), true);
  assert.equal(source, "import _vapoursynth_rpc");
});

test("installs the Python package atomically after importing the RPC bridge", () => {
  const installer = createPackageInstaller("import _vapoursynth_rpc\ncore = object()");

  assert.match(installer, /__import__\(_vs_rpc_module_name\)/);
  assert.match(installer, /sys\.modules/);
  assert.match(installer, /exec\(/);
});

test("pins a Pyodide distribution and rejects an empty hosting URL", async () => {
  assert.equal(PYODIDE_VERSION, "0.29.4");
  assert.equal(DEFAULT_PYODIDE_INDEX_URL, "https://cdn.jsdelivr.net/pyodide/v0.29.4/full/");
  await assert.rejects(() => loadBrowserPyodide({ indexURL: "" }), TypeError);
});
