#[path = "../src/invocation.rs"]
mod invocation;

use invocation::{Argument, ArgumentError, Arguments, Key, Value};

#[test]
fn public_contract_builds_without_allocation() {
    let mut arguments = Arguments::<2>::new();
    arguments.push(Argument::int(b"width", 37).unwrap()).unwrap();
    arguments
        .push(Argument::float(b"scale", 1.5).unwrap())
        .unwrap();

    assert_eq!(arguments.len(), 2);
    assert!(!arguments.is_empty());

    let values: Vec<_> = arguments.iter().map(Argument::value).collect();
    assert_eq!(values, [Value::Int(37), Value::Float(1.5)]);
    assert_eq!(Key::new(b"width").unwrap().as_bytes(), b"width");
}

#[test]
fn invalid_states_are_rejected_at_construction() {
    let mut arguments = Arguments::<1>::new();
    arguments.push(Argument::int(b"width", 37).unwrap()).unwrap();

    assert_eq!(
        arguments.push(Argument::int(b"width", 38).unwrap()),
        Err(ArgumentError::DuplicateKey)
    );
    assert_eq!(
        arguments.push(Argument::int(b"height", 19).unwrap()),
        Err(ArgumentError::CapacityExceeded)
    );
    assert_eq!(Key::new(b"bad\0key"), Err(ArgumentError::InvalidKey));
}
