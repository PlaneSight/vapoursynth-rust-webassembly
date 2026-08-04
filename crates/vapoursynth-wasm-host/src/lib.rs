//! Browser-facing `VapourSynth` worker API.

use wasm_bindgen::prelude::*;

/// Returns a machine-readable status string for the current scaffold build.
#[wasm_bindgen]
#[must_use]
pub fn runtime_status() -> String {
    let linked = vapoursynth_sys_linked();
    format!("{{\"schemaVersion\":1,\"upstreamLinked\":{linked},\"phase\":\"scaffold\"}}")
}

const fn vapoursynth_sys_linked() -> bool {
    false
}

/// Placeholder entry point for the first real upstream proof.
///
/// # Errors
///
/// Always returns a JavaScript error until a browser-facing upstream bridge is
/// implemented.
#[wasm_bindgen]
pub fn render_blank_frame(_width: u32, _height: u32) -> Result<Vec<u8>, JsValue> {
    Err(JsValue::from_str(
        "upstream VapourSynth is not linked; see docs/plan.md milestone 1",
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_does_not_claim_upstream_support() {
        let status = runtime_status();
        assert!(status.contains("\"upstreamLinked\":false"));
        assert!(status.contains("\"phase\":\"scaffold\""));
    }
}
