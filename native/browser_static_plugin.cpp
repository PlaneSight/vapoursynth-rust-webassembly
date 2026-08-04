#include "VapourSynth4.h"
#include "VSHelper4.h"
#include "internalfilters.h"
#include "version.h"

// This deliberately exposes only the implementation units needed for the
// first proof. Other std functions may be registered by those units, but only
// BlankClip and Invert are part of the browser-spike contract.
void browserStaticStdPluginInitialize(VSPlugin *plugin, const VSPLUGINAPI *vspapi) {
    vspapi->configPlugin(
        VSH_STD_PLUGIN_ID,
        "std",
        "VapourSynth Core Functions (browser spike)",
        VAPOURSYNTH_INTERNAL_PLUGIN_VERSION,
        VAPOURSYNTH_API_VERSION,
        pcModifiable,
        plugin);
    genericInitialize(plugin, vspapi);
    stdlibInitialize(plugin, vspapi);
}
