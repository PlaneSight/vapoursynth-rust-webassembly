//! Typed, validated argument values for generic browser-hosted invocation.
//!
//! These types model the stable Rust-side contract before values cross the
//! opaque C ABI. They deliberately support only value kinds with an exact,
//! fixed-width representation: scalars and arrays of integers and floats,
//! opaque data bytes, and scalar or array node tokens. The model is
//! allocation-free so the Emscripten build stays `no_std`; arrays borrow their
//! element spans from the wire descriptor.

use core::num::NonZeroU32;
use core::ptr;
use core::slice;

use vapoursynth_sys::browser;

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

/// An opaque, generation-checked node handle.
///
/// Both halves must be non-zero; a zero pair names no live resource.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(C)]
pub struct NodeToken {
    slot: NonZeroU32,
    generation: NonZeroU32,
}

impl NodeToken {
    /// Validates a raw `(slot, generation)` token pair.
    ///
    /// # Errors
    ///
    /// Returns [`ArgumentError::InvalidToken`] when either half is zero.
    pub fn from_raw(slot: u32, generation: u32) -> Result<Self, ArgumentError> {
        let slot = NonZeroU32::new(slot).ok_or(ArgumentError::InvalidToken)?;
        let generation = NonZeroU32::new(generation).ok_or(ArgumentError::InvalidToken)?;
        Ok(Self { slot, generation })
    }

    /// Returns the token slot.
    #[must_use]
    pub const fn slot(self) -> u32 {
        self.slot.get()
    }

    /// Returns the token generation.
    #[must_use]
    pub const fn generation(self) -> u32 {
        self.generation.get()
    }
}

/// One typed value decoded from a wire descriptor.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Value<'a> {
    /// A single signed 64-bit integer.
    Int(i64),
    /// A contiguous span of signed 64-bit integers.
    IntArray(&'a [i64]),
    /// A single double-precision float.
    Float(f64),
    /// A contiguous span of double-precision floats.
    FloatArray(&'a [f64]),
    /// Opaque binary bytes; the span length is the DATA byte count.
    Data(&'a [u8]),
    /// A single generation-checked node token.
    Node(NodeToken),
    /// A contiguous span of node tokens.
    NodeArray(&'a [NodeToken]),
}

impl Value<'_> {
    /// Returns the ABI kind constant this value serializes as.
    #[must_use]
    pub const fn kind(self) -> u32 {
        match self {
            Self::Int(_) | Self::IntArray(_) => browser::ARGUMENT_INT,
            Self::Float(_) | Self::FloatArray(_) => browser::ARGUMENT_FLOAT,
            Self::Data(_) => browser::ARGUMENT_DATA,
            Self::Node(_) | Self::NodeArray(_) => browser::ARGUMENT_NODE,
        }
    }

    /// Returns whether this value carries more than one element.
    #[must_use]
    pub const fn is_array(self) -> bool {
        matches!(
            self,
            Self::IntArray(_) | Self::FloatArray(_) | Self::NodeArray(_)
        )
    }
}

/// One validated key-value argument.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Argument<'a> {
    key: Key<'a>,
    value: Value<'a>,
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

    /// Creates an integer array argument.
    ///
    /// # Errors
    ///
    /// Returns [`ArgumentError::InvalidKey`] when `key` is invalid or
    /// [`ArgumentError::InvalidCount`] when `values` is empty.
    pub fn int_array(key: &'a [u8], values: &'a [i64]) -> Result<Self, ArgumentError> {
        if values.is_empty() {
            return Err(ArgumentError::InvalidCount);
        }
        Ok(Self {
            key: Key::new(key)?,
            value: Value::IntArray(values),
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

    /// Creates a floating-point array argument.
    ///
    /// # Errors
    ///
    /// Returns [`ArgumentError::InvalidKey`] when `key` is invalid or
    /// [`ArgumentError::InvalidCount`] when `values` is empty.
    pub fn float_array(key: &'a [u8], values: &'a [f64]) -> Result<Self, ArgumentError> {
        if values.is_empty() {
            return Err(ArgumentError::InvalidCount);
        }
        Ok(Self {
            key: Key::new(key)?,
            value: Value::FloatArray(values),
        })
    }

    /// Creates a binary data argument.
    ///
    /// # Errors
    ///
    /// Returns [`ArgumentError::InvalidKey`] when `key` is invalid or
    /// [`ArgumentError::InvalidCount`] when `bytes` is empty.
    pub fn data(key: &'a [u8], bytes: &'a [u8]) -> Result<Self, ArgumentError> {
        if bytes.is_empty() {
            return Err(ArgumentError::InvalidCount);
        }
        Ok(Self {
            key: Key::new(key)?,
            value: Value::Data(bytes),
        })
    }

    /// Creates a node argument from a validated token.
    ///
    /// # Errors
    ///
    /// Returns [`ArgumentError::InvalidKey`] when `key` is invalid.
    pub fn node(key: &'a [u8], token: NodeToken) -> Result<Self, ArgumentError> {
        Ok(Self {
            key: Key::new(key)?,
            value: Value::Node(token),
        })
    }

    /// Creates a node array argument.
    ///
    /// # Errors
    ///
    /// Returns [`ArgumentError::InvalidKey`] when `key` is invalid or
    /// [`ArgumentError::InvalidCount`] when `tokens` is empty.
    pub fn node_array(key: &'a [u8], tokens: &'a [NodeToken]) -> Result<Self, ArgumentError> {
        if tokens.is_empty() {
            return Err(ArgumentError::InvalidCount);
        }
        Ok(Self {
            key: Key::new(key)?,
            value: Value::NodeArray(tokens),
        })
    }

    /// Validates one raw wire descriptor into a typed argument.
    ///
    /// # Safety
    ///
    /// When non-null, `descriptor.key` must point to `key_length` readable
    /// bytes. When non-null, `descriptor.values` must point to at least
    /// `value_count` readable elements of the declared kind (or bytes for
    /// DATA) that remain valid for the returned argument's lifetime.
    /// Structural validation cannot prove that caller-provided raw pointers name live storage.
    ///
    /// # Errors
    ///
    /// Returns an [`ArgumentError`] for null or empty keys, embedded key NUL
    /// bytes, unknown kinds, zero counts, null or misaligned value storage, or
    /// zero token halves.
    pub unsafe fn from_descriptor(
        descriptor: &browser::Argument,
    ) -> Result<Argument<'_>, ArgumentError> {
        if descriptor.key.is_null() {
            return Err(ArgumentError::InvalidKey);
        }
        // Safety: the descriptor contract requires `key_length` readable bytes.
        let key_bytes =
            unsafe { slice::from_raw_parts(descriptor.key, descriptor.key_length as usize) };
        let key = Key::new(key_bytes)?;

        let value = match descriptor.kind {
            browser::ARGUMENT_INT => {
                let count = element_count::<i64>(descriptor)?;
                if count == 1 {
                    // Safety: `values` names at least one readable i64 value.
                    Value::Int(unsafe { ptr::read_unaligned(descriptor.values.cast::<i64>()) })
                } else {
                    Value::IntArray(element_slice::<i64>(descriptor, count)?)
                }
            }
            browser::ARGUMENT_FLOAT => {
                let count = element_count::<f64>(descriptor)?;
                if count == 1 {
                    // Safety: `values` names at least one readable f64 value.
                    Value::Float(unsafe { ptr::read_unaligned(descriptor.values.cast::<f64>()) })
                } else {
                    Value::FloatArray(element_slice::<f64>(descriptor, count)?)
                }
            }
            browser::ARGUMENT_DATA => {
                let count = byte_count(descriptor)?;
                // Safety: `values` names `count` readable bytes.
                Value::Data(unsafe { slice::from_raw_parts(descriptor.values.cast::<u8>(), count) })
            }
            browser::ARGUMENT_NODE => {
                let count = element_count::<NodeToken>(descriptor)?;
                if count == 1 {
                    Value::Node(read_node_token(descriptor, 0)?)
                } else {
                    // `NodeToken` contains `NonZeroU32` fields. Validate every
                    // raw pair before reinterpreting the caller's storage as a
                    // `NodeToken` slice; constructing a slice that contains a
                    // zero half would already violate Rust's validity rules.
                    for index in 0..count {
                        read_node_token(descriptor, index)?;
                    }
                    Value::NodeArray(element_slice::<NodeToken>(descriptor, count)?)
                }
            }
            _ => return Err(ArgumentError::InvalidKind),
        };

        Ok(Argument { key, value })
    }

    /// Returns the argument key.
    #[must_use]
    pub const fn key(self) -> Key<'a> {
        self.key
    }

    /// Returns the argument value.
    #[must_use]
    pub const fn value(self) -> Value<'a> {
        self.value
    }
}

/// Failures detected while constructing an invocation argument list.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ArgumentError {
    /// A key was null, empty, or contained an embedded NUL byte.
    InvalidKey,
    /// A descriptor kind was not one of the four ABI kinds.
    InvalidKind,
    /// A value count was zero or would overflow the address space.
    InvalidCount,
    /// A non-empty descriptor had a null `values` pointer.
    NullValues,
    /// Array storage was not aligned for its declared element type.
    MisalignedValues,
    /// A node token pair had a zero slot or generation.
    InvalidToken,
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

/// Reads and validates one raw `(slot, generation)` pair.
fn read_node_token(
    descriptor: &browser::Argument,
    index: usize,
) -> Result<NodeToken, ArgumentError> {
    let offset = index * core::mem::size_of::<NodeToken>();
    // Safety: `element_count::<NodeToken>` validated that the descriptor names
    // enough readable bytes for every indexed token.
    let bytes = unsafe { descriptor.values.cast::<u8>().add(offset) };
    // Safety: both fields are readable within the token pair. Unaligned reads
    // avoid imposing stronger alignment than the raw browser ABI requires.
    let slot = unsafe { ptr::read_unaligned(bytes.cast::<u32>()) };
    // Safety: the generation field follows the slot field in the repr(C) pair.
    let generation =
        unsafe { ptr::read_unaligned(bytes.add(core::mem::size_of::<u32>()).cast::<u32>()) };
    NodeToken::from_raw(slot, generation)
}

/// Validates the descriptor's value storage and returns its element count.
fn element_count<T>(descriptor: &browser::Argument) -> Result<usize, ArgumentError> {
    values_span(descriptor)?;
    let count = descriptor.value_count as usize;
    if count > isize::MAX as usize / core::mem::size_of::<T>() {
        return Err(ArgumentError::InvalidCount);
    }
    Ok(count)
}

/// Validates the descriptor's value storage and returns its DATA byte count.
fn byte_count(descriptor: &browser::Argument) -> Result<usize, ArgumentError> {
    values_span(descriptor)?;
    Ok(descriptor.value_count as usize)
}

/// Rejects zero counts and null value storage.
fn values_span(descriptor: &browser::Argument) -> Result<(), ArgumentError> {
    if descriptor.value_count == 0 {
        return Err(ArgumentError::InvalidCount);
    }
    if descriptor.values.is_null() {
        return Err(ArgumentError::NullValues);
    }
    Ok(())
}

/// Reinterprets validated, aligned element storage as a typed span.
fn element_slice<T>(descriptor: &browser::Argument, count: usize) -> Result<&[T], ArgumentError> {
    if descriptor.values.addr() % core::mem::align_of::<T>() != 0 {
        return Err(ArgumentError::MisalignedValues);
    }
    // Safety: the synchronous descriptor contract guarantees readable storage
    // for `count` elements; alignment and address-space bounds were validated.
    Ok(unsafe { slice::from_raw_parts(descriptor.values.cast::<T>(), count) })
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::mem::MaybeUninit;

    fn int_descriptor(
        key: &[u8],
        kind: u32,
        value: i64,
        storage: &mut MaybeUninit<i64>,
    ) -> browser::Argument {
        // Safety: writing one i64 into uninitialized aligned storage.
        unsafe { storage.as_mut_ptr().write(value) };
        browser::Argument {
            key: key.as_ptr(),
            key_length: u32::try_from(key.len()).unwrap(),
            kind,
            values: storage.as_ptr().cast(),
            value_count: 1,
        }
    }

    fn float_descriptor(
        key: &[u8],
        kind: u32,
        value: f64,
        storage: &mut MaybeUninit<f64>,
    ) -> browser::Argument {
        // Safety: writing one f64 into uninitialized aligned storage.
        unsafe { storage.as_mut_ptr().write(value) };
        browser::Argument {
            key: key.as_ptr(),
            key_length: u32::try_from(key.len()).unwrap(),
            kind,
            values: storage.as_ptr().cast(),
            value_count: 1,
        }
    }

    fn data_descriptor(key: &[u8], kind: u32, bytes: &[u8]) -> browser::Argument {
        browser::Argument {
            key: key.as_ptr(),
            key_length: u32::try_from(key.len()).unwrap(),
            kind,
            values: bytes.as_ptr().cast(),
            value_count: u32::try_from(bytes.len()).unwrap(),
        }
    }

    fn node_descriptor(
        key: &[u8],
        kind: u32,
        slot: u32,
        generation: u32,
        storage: &mut MaybeUninit<[u32; 2]>,
    ) -> browser::Argument {
        // Safety: writing two u32s into uninitialized aligned storage.
        unsafe {
            storage.as_mut_ptr().write([slot, generation]);
        }
        browser::Argument {
            key: key.as_ptr(),
            key_length: u32::try_from(key.len()).unwrap(),
            kind,
            values: storage.as_ptr().cast(),
            value_count: 1,
        }
    }

    fn decode_descriptor(descriptor: &browser::Argument) -> Result<Argument<'_>, ArgumentError> {
        // Safety: each test keeps non-null descriptor storage live for the
        // returned borrow; deliberately null pointers are rejected before use.
        unsafe { Argument::from_descriptor(descriptor) }
    }

    #[test]
    fn rejects_invalid_keys() {
        assert_eq!(Key::new(b""), Err(ArgumentError::InvalidKey));
        assert_eq!(Key::new(b"bad\0key"), Err(ArgumentError::InvalidKey));
        assert_eq!(Key::new(b"width").map(Key::as_bytes), Ok(&b"width"[..]));
    }

    #[test]
    fn node_tokens_reject_zero_halves() {
        let token = NodeToken::from_raw(3, 7).unwrap();
        assert_eq!((token.slot(), token.generation()), (3, 7));
        assert_eq!(NodeToken::from_raw(0, 7), Err(ArgumentError::InvalidToken));
        assert_eq!(NodeToken::from_raw(3, 0), Err(ArgumentError::InvalidToken));
    }

    #[test]
    fn value_kinds_match_the_abi_constants() {
        assert_eq!(Value::Int(1).kind(), browser::ARGUMENT_INT);
        assert_eq!(Value::Float(1.0).kind(), browser::ARGUMENT_FLOAT);
        assert_eq!(Value::Data(b"x").kind(), browser::ARGUMENT_DATA);
        assert_eq!(
            Value::Node(NodeToken::from_raw(1, 1).unwrap()).kind(),
            browser::ARGUMENT_NODE
        );
        assert!(Value::IntArray(&[1, 2]).is_array());
        assert!(Value::FloatArray(&[1.0]).is_array());
        assert!(Value::NodeArray(&[NodeToken::from_raw(1, 1).unwrap()]).is_array());
        assert!(!Value::Int(1).is_array());
        assert!(!Value::Data(b"x").is_array());
    }

    #[test]
    fn constructors_preserve_typed_values_in_order() {
        let mut arguments = Arguments::<4>::new();
        arguments
            .push(Argument::int(b"width", 37).unwrap())
            .unwrap();
        arguments
            .push(Argument::float(b"scale", 1.5).unwrap())
            .unwrap();
        arguments
            .push(Argument::int_array(b"luma", &[1, 2, 3]).unwrap())
            .unwrap();
        arguments
            .push(Argument::data(b"blob", &[9, 8]).unwrap())
            .unwrap();

        let values: std::vec::Vec<_> = arguments.iter().collect();
        assert_eq!(values[0].value(), Value::Int(37));
        assert_eq!(values[1].value(), Value::Float(1.5));
        assert_eq!(values[2].value(), Value::IntArray(&[1, 2, 3]));
        assert_eq!(values[3].value(), Value::Data(&[9, 8]));
    }

    #[test]
    fn constructors_reject_empty_arrays_and_data() {
        assert_eq!(
            Argument::int_array(b"a", &[]),
            Err(ArgumentError::InvalidCount)
        );
        assert_eq!(
            Argument::float_array(b"a", &[]),
            Err(ArgumentError::InvalidCount)
        );
        assert_eq!(Argument::data(b"a", &[]), Err(ArgumentError::InvalidCount));
        assert_eq!(
            Argument::node_array(b"a", &[]),
            Err(ArgumentError::InvalidCount)
        );
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

    #[test]
    fn from_descriptor_decodes_scalar_int_and_float() {
        let mut int_storage = MaybeUninit::<i64>::uninit();
        let int_descriptor_value =
            int_descriptor(b"width", browser::ARGUMENT_INT, 37, &mut int_storage);
        let int_argument = decode_descriptor(&int_descriptor_value).unwrap();
        assert_eq!(int_argument.key().as_bytes(), &b"width"[..]);
        assert_eq!(int_argument.value(), Value::Int(37));

        let mut float_storage = MaybeUninit::<f64>::uninit();
        let float_descriptor_value =
            float_descriptor(b"scale", browser::ARGUMENT_FLOAT, 1.5, &mut float_storage);
        let float_argument = decode_descriptor(&float_descriptor_value).unwrap();
        assert_eq!(float_argument.value(), Value::Float(1.5));
    }

    #[test]
    fn from_descriptor_decodes_data_and_node() {
        let blob = [1_u8, 2, 3];
        let data_descriptor_value = data_descriptor(b"blob", browser::ARGUMENT_DATA, &blob);
        let data_argument = decode_descriptor(&data_descriptor_value).unwrap();
        assert_eq!(data_argument.value(), Value::Data(&[1, 2, 3]));

        let mut token_storage = MaybeUninit::<[u32; 2]>::uninit();
        let node_descriptor_value =
            node_descriptor(b"clip", browser::ARGUMENT_NODE, 5, 9, &mut token_storage);
        let node_argument = decode_descriptor(&node_descriptor_value).unwrap();
        assert_eq!(
            node_argument.value(),
            Value::Node(NodeToken::from_raw(5, 9).unwrap())
        );
    }

    #[test]
    fn from_descriptor_decodes_int_and_float_arrays() {
        let ints = [7_i64, 8, 9];
        let int_array = browser::Argument {
            key: b"widths".as_ptr(),
            key_length: 6,
            kind: browser::ARGUMENT_INT,
            values: ints.as_ptr().cast(),
            value_count: 3,
        };
        assert_eq!(
            decode_descriptor(&int_array).unwrap().value(),
            Value::IntArray(&[7, 8, 9])
        );

        let floats = [0.5_f64, 1.5];
        let float_array = browser::Argument {
            key: b"scales".as_ptr(),
            key_length: 6,
            kind: browser::ARGUMENT_FLOAT,
            values: floats.as_ptr().cast(),
            value_count: 2,
        };
        assert_eq!(
            decode_descriptor(&float_array).unwrap().value(),
            Value::FloatArray(&[0.5, 1.5])
        );
    }

    #[test]
    fn from_descriptor_rejects_misaligned_array_storage() {
        let storage = [0_u8; 24];
        let offset = (0..core::mem::align_of::<i64>())
            .find(|offset| (storage.as_ptr().addr() + offset) % core::mem::align_of::<i64>() != 0)
            .unwrap();
        // Safety: `offset` stays within `storage`; the descriptor is rejected
        // before the deliberately unaligned pointer is made into a slice.
        let values = unsafe { storage.as_ptr().add(offset) };
        let descriptor = browser::Argument {
            key: b"widths".as_ptr(),
            key_length: 6,
            kind: browser::ARGUMENT_INT,
            values: values.cast(),
            value_count: 2,
        };

        assert_eq!(
            decode_descriptor(&descriptor),
            Err(ArgumentError::MisalignedValues)
        );
    }

    #[test]
    fn from_descriptor_decodes_node_arrays() {
        let tokens = [
            NodeToken::from_raw(1, 2).unwrap(),
            NodeToken::from_raw(3, 4).unwrap(),
        ];
        let node_array = browser::Argument {
            key: b"clips".as_ptr(),
            key_length: 5,
            kind: browser::ARGUMENT_NODE,
            values: tokens.as_ptr().cast(),
            value_count: 2,
        };
        assert_eq!(
            decode_descriptor(&node_array).unwrap().value(),
            Value::NodeArray(&tokens)
        );
    }

    #[test]
    fn from_descriptor_rejects_bad_descriptors() {
        let null_key = browser::Argument {
            key: core::ptr::null(),
            key_length: 5,
            kind: browser::ARGUMENT_INT,
            values: core::ptr::null(),
            value_count: 1,
        };
        assert_eq!(decode_descriptor(&null_key), Err(ArgumentError::InvalidKey));

        let mut bad_kind_storage = MaybeUninit::<i64>::uninit();
        let bad_kind = int_descriptor(b"width", 99, 37, &mut bad_kind_storage);
        assert_eq!(
            decode_descriptor(&bad_kind),
            Err(ArgumentError::InvalidKind)
        );

        let zero_count = browser::Argument {
            key: b"width".as_ptr(),
            key_length: 5,
            kind: browser::ARGUMENT_INT,
            values: core::ptr::null(),
            value_count: 0,
        };
        assert_eq!(
            decode_descriptor(&zero_count),
            Err(ArgumentError::InvalidCount)
        );

        let null_values = browser::Argument {
            key: b"width".as_ptr(),
            key_length: 5,
            kind: browser::ARGUMENT_INT,
            values: core::ptr::null(),
            value_count: 1,
        };
        assert_eq!(
            decode_descriptor(&null_values),
            Err(ArgumentError::NullValues)
        );

        let mut nul_storage = MaybeUninit::<i64>::uninit();
        let embedded_nul = int_descriptor(b"bad\0key", browser::ARGUMENT_INT, 37, &mut nul_storage);
        assert_eq!(
            decode_descriptor(&embedded_nul),
            Err(ArgumentError::InvalidKey)
        );

        let mut zero_token_storage = MaybeUninit::<[u32; 2]>::uninit();
        let zero_token = node_descriptor(
            b"clip",
            browser::ARGUMENT_NODE,
            0,
            3,
            &mut zero_token_storage,
        );
        assert_eq!(
            decode_descriptor(&zero_token),
            Err(ArgumentError::InvalidToken)
        );

        let raw_tokens = [1_u32, 2, 0, 4];
        let zero_array_token = browser::Argument {
            key: b"clips".as_ptr(),
            key_length: 5,
            kind: browser::ARGUMENT_NODE,
            values: raw_tokens.as_ptr().cast(),
            value_count: 2,
        };
        assert_eq!(
            decode_descriptor(&zero_array_token),
            Err(ArgumentError::InvalidToken)
        );
    }
}
