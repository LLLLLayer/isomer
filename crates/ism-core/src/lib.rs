//! ism-core: the Isomer engine.
//!
//! Reorganize a frozen `base..head` commit range according to a declarative
//! plan, with a bit-for-bit tree-equality proof that no code was changed.
//! All domain logic lives here; the CLI and any future desktop app are shells.

pub mod algebra;
pub mod analyze;
pub mod comment;
pub mod engine;
pub mod error;
pub mod gitio;
pub mod model;
pub mod oplog;
pub mod parse;
pub mod plancheck;
pub mod verify;

pub const VERSION: &str = env!("CARGO_PKG_VERSION");
