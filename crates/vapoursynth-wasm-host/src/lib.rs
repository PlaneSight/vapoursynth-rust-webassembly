//! Browser-facing protocol for a worker-owned `VapourSynth` runtime.
//!
//! This crate intentionally does not link the Emscripten-built upstream core.
//! It defines the stable JavaScript boundary that the dedicated worker will
//! use once the Emscripten module is loaded alongside it.

use wasm_bindgen::prelude::*;

const SCHEMA_VERSION: u32 = 1;

/// Stateful protocol endpoint owned by exactly one dedicated Web Worker.
#[wasm_bindgen]
pub struct WorkerSession {
    next_request_id: u32,
}

#[wasm_bindgen]
impl WorkerSession {
    /// Creates a worker-local protocol session.
    #[wasm_bindgen(constructor)]
    #[must_use]
    pub fn new() -> Self {
        Self { next_request_id: 1 }
    }

    /// Allocates the next non-zero request identifier.
    #[must_use]
    pub fn allocate_request_id(&mut self) -> u32 {
        let request_id = self.next_request_id;
        self.next_request_id = self.next_request_id.wrapping_add(1).max(1);
        request_id
    }

    /// Returns the machine-readable worker capability record.
    #[must_use]
    pub fn status(&self) -> String {
        runtime_status()
    }

    /// Validates a render request and reports that the Emscripten runtime is separate.
    ///
    /// # Errors
    ///
    /// Returns a structured JavaScript error for an invalid request or because
    /// the isolated wasm-bindgen host does not own the Emscripten runtime.
    pub fn render_blank_frame(
        &self,
        request_id: u32,
        width: u32,
        height: u32,
    ) -> Result<Vec<u8>, JsValue> {
        if request_id == 0 {
            return Err(worker_error(
                request_id,
                "invalid-request",
                "requestId must be non-zero",
            ));
        }

        rgba8_byte_len(width, height).map_err(|message| {
            worker_error(request_id, "invalid-dimensions", message)
        })?;

        Err(worker_error(
            request_id,
            "runtime-unavailable",
            "the Emscripten VapourSynth runtime is not attached",
        ))
    }
}

impl Default for WorkerSession {
    fn default() -> Self {
        Self::new()
    }
}

/// Returns a machine-readable capability record for the isolated host crate.
#[wasm_bindgen]
#[must_use]
pub fn runtime_status() -> String {
    format!(
        "{{\"schemaVersion\":{SCHEMA_VERSION},\"upstreamLinked\":false,\"workerProtocol\":true,\"phase\":\"worker-protocol\"}}"
    )
}

fn rgba8_byte_len(width: u32, height: u32) -> Result<usize, &'static str> {
    if width == 0 || height == 0 {
        return Err("width and height must be non-zero");
    }

    let bytes = width
        .checked_mul(height)
        .and_then(|pixels| pixels.checked_mul(4))
        .ok_or("RGBA8 byte length overflows u32")?;

    usize::try_from(bytes).map_err(|_| "RGBA8 byte length is not representable on this target")
}

fn worker_error(request_id: u32, code: &str, message: &str) -> JsValue {
    JsValue::from_str(&format!(
        "{{\"schemaVersion\":{SCHEMA_VERSION},\"requestId\":{request_id},\"ok\":false,\"error\":{{\"code\":\"{code}\",\"message\":\"{message}\"}}}}"
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_describes_protocol_without_claiming_upstream_support() {
        let status = runtime_status();
        assert!(status.contains("\"schemaVersion\":1"));
        assert!(status.contains("\"upstreamLinked\":false"));
        assert!(status.contains("\"workerProtocol\":true"));
        assert!(status.contains("\"phase\":\"worker-protocol\""));
    }

    #[test]
    fn request_ids_are_non_zero_across_wrap() {
        let mut session = WorkerSession {
            next_request_id: u32::MAX,
        };

        assert_eq!(session.allocate_request_id(), u32::MAX);
        assert_eq!(session.allocate_request_id(), 1);
        assert_eq!(session.allocate_request_id(), 2);
    }

    #[test]
    fn rgba8_length_rejects_zero_and_overflow() {
        assert!(rgba8_byte_len(0, 1).is_err());
        assert!(rgba8_byte_len(1, 0).is_err());
        assert!(rgba8_byte_len(u32::MAX, u32::MAX).is_err());
        assert_eq!(rgba8_byte_len(37, 19), Ok(37 * 19 * 4));
    }
}
