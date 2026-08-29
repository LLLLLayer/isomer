//! Domain types. Their serde shapes ARE the public JSON contract:
//! the CLI only serializes what these types define (design/07, rule 2).

use serde::{Deserialize, Serialize};

/// Change identity: `i-` + 8 chars of base32 alphabet (a-z2-7).
/// The prefix and alphabet make IDs regex-disjoint from SHAs (design D06).
pub const CHANGE_ID_ALPHABET: &[u8] = b"abcdefghijklmnopqrstuvwxyz234567";

pub fn is_valid_change_id(s: &str) -> bool {
    s.len() == 10
        && s.starts_with("i-")
        && s.as_bytes()[2..]
            .iter()
            .all(|b| CHANGE_ID_ALPHABET.contains(b))
}

pub fn is_valid_node_name(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 40
        && s.bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

/// The trailer key stamped into materialized commits.
pub const TRAILER_KEY: &str = "Isomer-Change";

// -- snapshot (inspect output) ----------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Snapshot {
    pub snapshot_digest: String,
    pub base: String,
    pub head: String,
    pub branch: String,
    pub commits: Vec<CommitInfo>,
    pub hunks: Vec<HunkMeta>,
    /// Hard dependency edges: [dependent, dependency].
    pub deps: Vec<(String, String)>,
    pub anomalies: Vec<Anomaly>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommitInfo {
    pub sha: String,
    pub title: String,
    pub change_id: Option<String>,
    pub hunks: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HunkMeta {
    /// Self-describing id: `<path>:<new_start>#<digest4>` (design D15).
    pub id: String,
    pub commit: String,
    pub kind: HunkKind,
    /// (start, len) in the pre-image of this hunk's sequential step.
    pub old_range: (u32, u32),
    /// (start, len) in the post-image.
    pub new_range: (u32, u32),
    pub lines: LineStat,
    /// Patch text; populated only in `--full` mode (design D17).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub patch: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HunkKind {
    Add,
    Mod,
    Del,
    /// Whole-file degraded unit (binary, mode change, no-newline edge).
    File,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct LineStat {
    pub add: u32,
    pub del: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Anomaly {
    /// Commit without an Isomer-Change trailer.
    Untracked { commit: String },
    /// Two commits in the stack carry the same change id (cherry-pick copy).
    DuplicateId {
        change_id: String,
        commits: Vec<String>,
    },
    /// Trailer id present but no metadata on refs/isomer/data.
    UnknownId { change_id: String, commit: String },
    /// One commit carries multiple trailers (squash of changes).
    Merged {
        commit: String,
        change_ids: Vec<String>,
    },
    /// Metadata exists but no commit in the stack carries the trailer.
    Orphan { change_id: String },
    /// A merge commit inside base..head; reorganization is undefined across it.
    MergeInStack { commit: String },
}

// -- plan (agent input) ------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Plan {
    pub version: u32,
    pub snapshot_digest: String,
    /// Optional re-anchoring redundancy; verified against reality when present.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub head: Option<String>,
    pub nodes: Vec<PlanNode>,
    pub order: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlanNode {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// Existing change id to preserve; a fresh id is minted when absent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub change: Option<String>,
    pub summary: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
    pub from: NodeSource,
    /// Soft (semantic) dependencies: node names or change ids.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub deps: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum NodeSource {
    /// `"commit:<sha-prefix>"` — every hunk of that commit (pick sugar).
    Commit(String),
    /// Explicit hunk id list.
    Hunks(Vec<String>),
}

// -- change metadata (refs/isomer/data) --------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChangeMeta {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    pub summary: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub deps: Vec<String>,
}

// -- operation log -----------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Op {
    pub kind: OpKind,
    pub branch: String,
    pub old_head: String,
    pub new_head: String,
    pub base: String,
    /// Archival anchors so verify still works after the objects are gc'd.
    pub old_tree: String,
    pub new_tree: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub undoes: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plan_digest: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub snapshot_digest: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plan: Option<Plan>,
    pub tool_version: String,
    pub timestamp: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OpKind {
    Apply,
    Undo,
}

// -- apply output ------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApplyOutcome {
    pub new_head: String,
    pub changes: Vec<AppliedChange>,
    /// Metadata commit sha recording this operation.
    pub op: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppliedChange {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    pub commit: String,
    pub summary: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VerifyOutcome {
    pub ok: bool,
    pub branch: String,
    pub op: String,
    pub old_head: String,
    pub new_head: String,
    pub old_tree: String,
    pub new_tree: String,
    /// True when tree objects were resolved live; false = archival records only.
    pub live: bool,
    /// Bare-git commands a skeptic can run independently.
    pub reproduce: Vec<String>,
}
