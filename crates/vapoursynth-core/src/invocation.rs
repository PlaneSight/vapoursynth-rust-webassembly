//! Allocation-free argument maps for browser-hosted plugin invocation.
//!
//! These types model the stable Rust-side contract before values cross the
//! opaque C ABI. They deliberately support only value kinds with an exact,
//! fixed-width representation. Node arguments will be added alongside the
//! generic invocation bridge so resource ownership remains explicit.

/// A validated `VapourSynth` map key.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Key<'a>(&'a [u8]);

impl<'a> Key<'a> {
    /// Validates a non-empty key without embedded NUL bytes.
    ///
    /// # Errors
    ///
    /// Returns [`ArgumentError::InvalidKey`] when the key is empty or contains
    /// an embedded NUL byte.
    pub fn new(bytes: &'a [u8]) -> Result<Self, ArgumentError> {
        if bytes.is_empty() || bytes.contains(&0) {
            return Err(ArgumentError::InvalidKey);
        }

        Ok(Self(bytes))
    }

    /// Returns the validated key bytes without adding a terminator.
    #[must_use]
    pub const fn as_bytes(self) -> &'a [u8] {
        self.0
    }
}

/// A scalar value accepted by the first generic invocation slice.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Value {
    /// A signed `VapourSynth` integer value.
    Int(i64),
    /// A `VapourSynth` floating-point value.
    Float(f64),
}

/// One validated key-value argument.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Argument<'a> {
    key: Key<'a>,
    value: Value,
}

impl<'a> Argument<'a> {
    /// Creates an integer argument.
    ///
    /// # Errors
    ///
    /// Returns [`ArgumentError::InvalidKey`] when `key` is invalid.
    pub fn int(key: &'a [u8], value: i64) -> Result<Self, ArgumentError> {
        Ok(Self {
            key: Key::new(key)?,
            value: Value::Int(value),
        })
    }

    /// Creates a floating-point argument.
    ///
    /// # Errors
    ///
    /// Returns [`ArgumentError::InvalidKey`] when `key` is invalid.
    pub fn float(key: &'a [u8], value: f64) -> Result<Self, ArgumentError> {
        Ok(Self {
            key: Key::new(key)?,
            value: Value::Float(value),
        })
    }

    /// Returns the argument key.
    #[must_use]
    pub const fn key(self) -> Key<'a> {
        self.key
    }

    /// Returns the argument value.
    #[must_use]
    pub const fn value(self) -> Value {
        self.value
    }
}

/// Failures detected while constructing an invocation argument list.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ArgumentError {
    /// A key was empty or contained an embedded NUL byte.
    InvalidKey,
    /// The argument list already contains the supplied key.
    DuplicateKey,
    /// The fixed-capacity argument list is full.
    CapacityExceeded,
}

/// A small, allocation-free argument list with deterministic capacity.
#[derive(Debug)]
pub struct Arguments<'a, const N: usize> {
    entries: [Option<Argument<'a>>; N],
    len: usize,
}

impl<'a, const N: usize> Arguments<'a, N> {
    /// Creates an empty argument list.
    #[must_use]
    pub const fn new() -> Self {
        Self {
            entries: [None; N],
            len: 0,
        }
    }

    /// Appends one uniquely keyed argument.
    ///
    /// # Errors
    ///
    /// Returns [`ArgumentError::DuplicateKey`] when the key already exists or
    /// [`ArgumentError::CapacityExceeded`] when the list is full.
    pub fn push(&mut self, argument: Argument<'a>) -> Result<(), ArgumentError> {
        if self.iter().any(|existing| existing.key == argument.key) {
            return Err(ArgumentError::DuplicateKey);
        }

        let slot = self
            .entries
            .get_mut(self.len)
            .ok_or(ArgumentError::CapacityExceeded)?;
        *slot = Some(argument);
        self.len += 1;
        Ok(())
    }

    /// Returns the number of stored arguments.
    #[must_use]
    pub const fn len(&self) -> usize {
        self.len
    }

    /// Returns whether the list is empty.
    #[must_use]
    pub const fn is_empty(&self) -> bool {
        self.len == 0
    }

    /// Iterates over initialized arguments in insertion order.
    pub fn iter(&self) -> impl Iterator<Item = Argument<'a>> + '_ {
        self.entries[..self.len].iter().copied().flatten()
    }
}

impl<const N: usize> Default for Arguments<'_, N> {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_invalid_keys() {
        assert_eq!(Key::new(b""), Err(ArgumentError::InvalidKey));
        assert_eq!(Key::new(b"bad\0key"), Err(ArgumentError::InvalidKey));
        assert_eq!(Key::new(b"width").map(Key::as_bytes), Ok(&b"width"[..]));
    }

    #[test]
    fn preserves_typed_values_in_order() {
        let mut arguments = Arguments::<2>::new();
        arguments
            .push(Argument::int(b"width", 37).unwrap())
            .unwrap();
        arguments
            .push(Argument::float(b"scale", 1.5).unwrap())
            .unwrap();

        let values: std::vec::Vec<_> = arguments.iter().collect();
        assert_eq!(values[0].value(), Value::Int(37));
        assert_eq!(values[1].value(), Value::Float(1.5));
    }

    #[test]
    fn rejects_duplicates_and_capacity_overflow() {
        let mut arguments = Arguments::<1>::new();
        arguments
            .push(Argument::int(b"width", 37).unwrap())
            .unwrap();
        assert_eq!(
            arguments.push(Argument::int(b"width", 38).unwrap()),
            Err(ArgumentError::DuplicateKey)
        );
        assert_eq!(
            arguments.push(Argument::int(b"height", 19).unwrap()),
            Err(ArgumentError::CapacityExceeded)
        );
    }
}
