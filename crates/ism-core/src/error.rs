//! Structured error model.
//!
//! Every user-facing failure carries a stable error code (documented in the
//! CLI contract) plus an agent-oriented `hint` describing the next action.
//! Exit-code mapping lives in the CLI layer.

use serde::Serialize;
use thiserror::Error;

/// Machine-readable error report, serialized to stdout by the CLI.
#[derive(Debug, Serialize)]
pub struct ErrorReport {
    pub code: String,
    pub message: String,
    pub hint: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context: Option<serde_json::Value>,
}

#[derive(Debug, Error)]
pub enum IsmError {
    // -- E0xx: input / schema ------------------------------------------------
    #[error("plan is not valid: {0}")]
    PlanSchema(String), // E001
    #[error("unknown reference: {0}")]
    UnknownRef(String), // E002
    #[error("hunk digest mismatch for {id}: expected {expected}, found {found}")]
    DigestMismatch {
        id: String,
        expected: String,
        found: String,
    }, // E003

    // -- E01x: preconditions -------------------------------------------------
    #[error("plan is stale: {0}")]
    StalePlan(String), // E010
    #[error("undo precondition failed: {0}")]
    UndoPrecondition(String), // E012

    // -- E02x/E03x/E04x: plan validation ------------------------------------
    #[error("hunk not assigned to any node: {0}")]
    HunkUnassigned(String), // E020
    #[error("hunk assigned more than once: {0}")]
    HunkDuplicated(String), // E021
    #[error("order violates hard dependency: {0}")]
    HardDepViolation(String), // E030
    #[error("soft dependency graph invalid: {0}")]
    SoftDepInvalid(String), // E031
    #[error("replay failed: {0}")]
    ReplayFailed(String), // E040

    // -- E05x: environment-policy failures -----------------------------------
    #[error("commit signing failed: {0}")]
    SigningFailed(String), // E050

    // -- usage / environment -------------------------------------------------
    #[error("usage error: {0}")]
    Usage(String),
    #[error("precondition failed: {0}")]
    Precondition(String),

    // -- E9xx: broken internal invariants ------------------------------------
    #[error("internal invariant broken: {0}")]
    Internal(String),

    #[error("git command failed: {0}")]
    Git(String),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
}

impl IsmError {
    pub fn code(&self) -> &'static str {
        use IsmError::*;
        match self {
            PlanSchema(_) => "E001",
            UnknownRef(_) => "E002",
            DigestMismatch { .. } => "E003",
            StalePlan(_) => "E010",
            UndoPrecondition(_) => "E012",
            HunkUnassigned(_) => "E020",
            HunkDuplicated(_) => "E021",
            HardDepViolation(_) => "E030",
            SoftDepInvalid(_) => "E031",
            ReplayFailed(_) => "E040",
            SigningFailed(_) => "E050",
            Usage(_) => "E100",
            Precondition(_) => "E101",
            Internal(_) | Git(_) | Io(_) | Json(_) => "E900",
        }
    }

    pub fn hint(&self) -> String {
        use IsmError::*;
        match self {
            PlanSchema(_) => "fix the plan JSON to match schema/plan.v1.json".into(),
            UnknownRef(_) => {
                "re-run `ism inspect` and reference hunks/changes from its output".into()
            }
            DigestMismatch { .. } => {
                "the hunk content changed since inspect; re-run `ism inspect` and rebuild the plan"
                    .into()
            }
            StalePlan(_) => "re-run `ism inspect` and regenerate the plan".into(),
            UndoPrecondition(_) => {
                "the branch moved after the last ism operation; check `git reflog` manually".into()
            }
            HunkUnassigned(_) => "every hunk must appear in exactly one node's `from` list".into(),
            HunkDuplicated(_) => {
                "remove the duplicate assignment; a hunk belongs to one node".into()
            }
            HardDepViolation(_) => {
                "move the dependent hunk into the same node as its dependency, or into a later node"
                    .into()
            }
            SoftDepInvalid(_) => "make node `deps` acyclic and consistent with `order`".into(),
            ReplayFailed(_) => "re-run `ism inspect`; if it persists, report a bug".into(),
            SigningFailed(_) => "check your signing key config, or unset commit.gpgsign".into(),
            Usage(_) => "see `ism --help`".into(),
            Precondition(_) => "resolve the precondition and retry".into(),
            Internal(_) | Git(_) | Io(_) | Json(_) => {
                "this should never happen; please report a bug".into()
            }
        }
    }

    /// CLI process exit code, per the CLI contract.
    pub fn exit_code(&self) -> i32 {
        use IsmError::*;
        match self {
            PlanSchema(_)
            | UnknownRef(_)
            | DigestMismatch { .. }
            | HunkUnassigned(_)
            | HunkDuplicated(_)
            | HardDepViolation(_)
            | SoftDepInvalid(_)
            | ReplayFailed(_)
            | SigningFailed(_) => 1,
            Usage(_) => 2,
            StalePlan(_) | UndoPrecondition(_) | Precondition(_) => 3,
            Internal(_) | Git(_) | Io(_) | Json(_) => 9,
        }
    }

    pub fn report(&self) -> ErrorReport {
        ErrorReport {
            code: self.code().to_string(),
            message: self.to_string(),
            hint: self.hint(),
            context: None,
        }
    }
}

pub type Result<T> = std::result::Result<T, IsmError>;
