//! Published dependency used by the connected-development fixture.

/// Identifies which source of the library the consumer was built with.
pub fn marker() -> &'static str {
    "library 1.0.0 published"
}
