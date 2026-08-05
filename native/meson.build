if host_machine.system() != 'emscripten'
    error('The browser render-invert proof must be configured with toolchains/emscripten.ini')
endif

browser_cpp_args = [
    '-DVS_BROWSER_SINGLE_THREAD=1',
    '-DVS_BROWSER_STATIC_PLUGINS=1',
    '-DVS_CORE_EXPORTS',
    '-DVS_GRAPH_API',
    '-DVS_USE_LATEST_API',
    '-fexceptions',
    '-fno-char8_t',
]

upstream_includes = include_directories(
    '../vendor/vapoursynth/include',
    '../vendor/vapoursynth/src/core',
)

upstream_sources = files(
    '../vendor/vapoursynth/src/core/cpufeatures.cpp',
    '../vendor/vapoursynth/src/core/genericfilters.cpp',
    '../vendor/vapoursynth/src/core/internalfilters.cpp',
    '../vendor/vapoursynth/src/core/kernel/cpulevel.cpp',
    '../vendor/vapoursynth/src/core/kernel/generic.cpp',
    '../vendor/vapoursynth/src/core/kernel/merge.cpp',
    '../vendor/vapoursynth/src/core/kernel/planestats.cpp',
    '../vendor/vapoursynth/src/core/kernel/transpose.cpp',
    '../vendor/vapoursynth/src/core/memoryuse.cpp',
    '../vendor/vapoursynth/src/core/simplefilters.cpp',
    '../vendor/vapoursynth/src/core/vsapi.cpp',
    '../vendor/vapoursynth/src/core/vscore.cpp',
    '../vendor/vapoursynth/src/core/vslog.cpp',
    '../vendor/vapoursynth/src/core/vsthreadpool.cpp',
)

upstream_core = static_library(
    'vapoursynth-browser-upstream',
    upstream_sources,
    'browser_static_plugin.cpp',
    cpp_args: browser_cpp_args,
    include_directories: upstream_includes,
    override_options: ['cpp_std=c++20', 'warning_level=0'],
)

browser_bridge = static_library(
    'vapoursynth-browser-bridge',
    'browser_bridge.cpp',
    cpp_args: browser_cpp_args,
    include_directories: upstream_includes,
    override_options: ['cpp_std=c++20', 'warning_level=3', 'werror=true'],
)

render_invert = executable(
    'vapoursynth-render-invert',
    'tests/render_invert.cpp',
    cpp_args: browser_cpp_args,
    link_with: [browser_bridge, upstream_core],
    override_options: ['cpp_std=c++20', 'warning_level=3', 'werror=true'],
    link_args: [
        '-fexceptions',
        '-sALLOW_MEMORY_GROWTH=0',
        '-sASSERTIONS=2',
        '-sENVIRONMENT=node,web',
        '-sEXIT_RUNTIME=1',
        '-sINITIAL_MEMORY=67108864',
    ],
)

test('upstream opaque-handle render-invert', render_invert)

rust_core_builder = find_program(
    join_paths(meson.project_source_root(), 'tools', 'build-emscripten-core.sh'),
)
rust_core = custom_target(
    'vapoursynth-emscripten-core',
    output: 'libvapoursynth-emscripten-core.a',
    command: [rust_core_builder, '@OUTPUT@', '@OUTDIR@/cargo'],
    build_always_stale: true,
    build_by_default: true,
)

render_invert_rust = executable(
    'vapoursynth-rust-render-invert',
    'tests/render_invert_rust.cpp',
    cpp_args: browser_cpp_args,
    link_with: [rust_core, browser_bridge, upstream_core],
    override_options: ['cpp_std=c++20', 'warning_level=3', 'werror=true'],
    link_args: [
        '-fexceptions',
        '-sWASM_BIGINT',
        '-sABORTING_MALLOC=0',
        '-sALLOW_MEMORY_GROWTH=0',
        '-sASSERTIONS=2',
        '-sENVIRONMENT=node,web',
        '-sEXIT_RUNTIME=1',
        '-sINITIAL_MEMORY=67108864',
    ],
)

test('Rust render-invert through VapourSynth RGBA', render_invert_rust)

browser_module_link_args = [
    '--no-entry',
    '-fexceptions',
    '-sWASM_BIGINT',
    '-sABORTING_MALLOC=0',
    '-sALLOW_MEMORY_GROWTH=0',
    '-sASSERTIONS=2',
    '-sEXPORT_ES6=1',
    '-sMODULARIZE=1',
    '-sINITIAL_MEMORY=67108864',
    '-sEXPORTED_FUNCTIONS=["_malloc","_free","_vs_rust_render_inverted_blank"]',
]

browser_module = executable(
    'vapoursynth-browser-module',
    'browser_module.cpp',
    cpp_args: browser_cpp_args,
    link_with: [rust_core, browser_bridge, upstream_core],
    override_options: ['cpp_std=c++20', 'warning_level=3', 'werror=true'],
    link_args: browser_module_link_args + ['-sENVIRONMENT=worker'],
)

node_browser_module = executable(
    'vapoursynth-browser-module-node',
    'browser_module.cpp',
    cpp_args: browser_cpp_args,
    link_with: [rust_core, browser_bridge, upstream_core],
    override_options: ['cpp_std=c++20', 'warning_level=3', 'werror=true'],
    link_args: browser_module_link_args + ['-sENVIRONMENT=node'],
)

node = find_program('node')
test(
    'worker-owned Emscripten ES module render-invert',
    node,
    args: [files('tests/browser_module.test.mjs'), node_browser_module],
)
