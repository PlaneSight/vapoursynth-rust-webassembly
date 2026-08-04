//! Safe ownership model for the browser-hosted VapourSynth core.

use std::collections::HashMap;
use std::num::NonZeroU64;

use thiserror::Error;

/// Stable identifier sent across the worker boundary.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub struct Handle(NonZeroU64);

impl Handle {
    /// Returns the wire representation.
    #[must_use]
    pub const fn get(self) -> u64 {
        self.0.get()
    }
}

/// Resource kind stored behind an opaque handle.
#[derive(Debug, Eq, PartialEq)]
pub enum Resource {
    /// An upstream `VSNode*` once the real core is linked.
    Node,
    /// An upstream `VSFrame*` once the real core is linked.
    Frame,
}

/// Failures exposed by the safe host layer.
#[derive(Debug, Error, Eq, PartialEq)]
pub enum HostError {
    /// The requested handle was never issued or has already been released.
    #[error("unknown or stale handle {0}")]
    UnknownHandle(u64),
    /// The upstream WebAssembly backend has not yet been linked.
    #[error("upstream VapourSynth is not linked in this build")]
    UpstreamUnavailable,
}

/// Generation-ready registry for resources owned by the VapourSynth worker.
#[derive(Debug, Default)]
pub struct Registry {
    next: u64,
    resources: HashMap<Handle, Resource>,
}

impl Registry {
    /// Stores a resource and returns its opaque cross-worker handle.
    pub fn insert(&mut self, resource: Resource) -> Handle {
        self.next = self.next.checked_add(1).expect("handle space exhausted");
        let handle = Handle(NonZeroU64::new(self.next).expect("counter starts above zero"));
        let replaced = self.resources.insert(handle, resource);
        debug_assert!(replaced.is_none());
        handle
    }

    /// Releases a resource exactly once.
    ///
    /// # Errors
    ///
    /// Returns [`HostError::UnknownHandle`] when the handle is zero, stale or
    /// was never issued by this registry.
    pub fn remove(&mut self, raw: u64) -> Result<Resource, HostError> {
        let handle = NonZeroU64::new(raw)
            .map(Handle)
            .ok_or(HostError::UnknownHandle(raw))?;
        self.resources
            .remove(&handle)
            .ok_or(HostError::UnknownHandle(raw))
    }

    /// Number of resources currently retained by the worker.
    #[must_use]
    pub fn len(&self) -> usize {
        self.resources.len()
    }

    /// Whether no resources are retained.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.resources.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn handles_are_unique_and_single_release() {
        let mut registry = Registry::default();
        let first = registry.insert(Resource::Node);
        let second = registry.insert(Resource::Frame);
        assert_ne!(first, second);
        assert_eq!(registry.len(), 2);
        assert!(matches!(registry.remove(first.get()), Ok(Resource::Node)));
        assert_eq!(
            registry.remove(first.get()),
            Err(HostError::UnknownHandle(first.get()))
        );
    }
}
