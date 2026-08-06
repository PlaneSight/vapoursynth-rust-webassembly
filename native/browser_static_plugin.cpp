#include "VapourSynth4.h"
#include "VSHelper4.h"
#include "internalfilters.h"
#include "version.h"

// This exposes the upstream std units that the corpus and the browser
// authoring contract rely on: the generic filters (Invert, Levels, Median,
// Minimum, Maximum, ...), the expression evaluator (Expr, scalar-interpreter
// fallback on wasm), the lookup-table family (Lut, Lut2, Lut3), and the
// simple filters (BlankClip, Crop, AddBorders, flips, turns, stacks,
// ShufflePlanes, ...).
void browserStaticStdPluginInitialize(VSPlugin *plugin, const VSPLUGINAPI *vspapi) {
    vspapi->configPlugin(
        VSH_STD_PLUGIN_ID,
        "std",
        "VapourSynth Core Functions (browser runtime)",
        VAPOURSYNTH_INTERNAL_PLUGIN_VERSION,
        VAPOURSYNTH_API_VERSION,
        pcModifiable,
        plugin);
    exprInitialize(plugin, vspapi);
    genericInitialize(plugin, vspapi);
    lutInitialize(plugin, vspapi);
    stdlibInitialize(plugin, vspapi);
}
