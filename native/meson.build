if host_machine.system() != 'emscripten'
    error('The upstream browser spike must be configured with toolchains/emscripten.ini')
endif

build_rust_emscripten_probe = get_option('build_rust_emscripten_probe')

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

smoke = executable(
    'vapoursynth-browser-smoke',
    'smoke.cpp',
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

test('upstream BlankClip to Invert RGBA', smoke)

if build_rust_emscripten_probe
    rust_probe_builder = find_program(
        join_paths(meson.project_source_root(), 'tools', 'build-emscripten-probe.sh'),
    )
    rust_probe = custom_target(
        'vapoursynth-emscripten-probe',
        output: 'libvapoursynth-emscripten-probe.a',
        command: [rust_probe_builder, '@OUTPUT@', '@OUTDIR@/cargo'],
        build_always_stale: true,
        build_by_default: true,
    )

    rust_smoke = executable(
        'vapoursynth-rust-browser-smoke',
        'rust_smoke.cpp',
        cpp_args: browser_cpp_args,
        link_with: [rust_probe, browser_bridge, upstream_core],
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

    test('Rust to VapourSynth to RGBA ABI', rust_smoke)
endif
