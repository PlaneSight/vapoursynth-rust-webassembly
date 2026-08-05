# Third-party notices

## VapourSynth

The browser compatibility backend uses [VapourSynth](https://github.com/vapoursynth/vapoursynth), pinned in vendor/vapoursynth at 37eed3ddbdb61e92975d9a4b054a488e93fc9a1c.

VapourSynth is licensed under the GNU Lesser General Public License, version 2.1 or later. Its complete source, upstream copyright notices, and this project's browser-specific patch are available through the pinned submodule and patches/vapoursynth/0001-static-browser-runtime.patch.

No browser artifact is distributed by this repository yet. A distributable build must retain this notice, ship the applicable upstream license text, and make the exact modified source available under the LGPL's terms.

## Pyodide

The browser `.vpy` authoring worker loads [Pyodide](https://github.com/pyodide/pyodide) version 0.29.4 from the pinned distribution URL in `third_party/lock.toml`. The Node integration test uses the matching `pyodide` npm package.

Pyodide is licensed under the Mozilla Public License 2.0. A distributable browser deployment must retain the applicable Pyodide notices and license text, including notices for the files it self-hosts or obtains from the configured distribution.
