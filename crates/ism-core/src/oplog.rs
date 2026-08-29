//! The operation log: a parallel metadata commit chain at `refs/isomer/data`.
//!
//! Append-only (jj semantics): undo appends, never rewinds. Every entry is a
//! commit whose tree holds `meta.json`, `changes/<id>.json`, `ops/current.json`.
//! Everything is readable with bare `git cat-file` — the open-format promise.

use crate::error::{IsmError, Result};
use crate::gitio::Git;
use crate::model::{ChangeMeta, Op};

pub const DATA_REF: &str = "refs/isomer/data";

/// Append one operation. `changes` upserts change metadata; existing entries
/// are carried forward by tree-sha reuse (no content rewriting).
pub fn append(git: &Git, op: &Op, changes: &[ChangeMeta], trunk: &str) -> Result<String> {
    let old = if git.ref_exists(DATA_REF) {
        Some(git.rev_parse(DATA_REF)?)
    } else {
        None
    };

    // changes/ tree: carry forward previous entries, then upsert.
    let mut entries: Vec<(String, String)> = Vec::new(); // (file name, blob sha)
    if let Some(prev) = &old {
        for (mode, sha, name) in git.ls_tree(prev, "changes")? {
            if mode == "100644" {
                entries.push((name, sha));
            }
        }
    }
    for c in changes {
        let blob = git.hash_object(serde_json::to_string_pretty(c)?.as_bytes())?;
        let fname = format!("{}.json", c.id);
        entries.retain(|(n, _)| n != &fname);
        entries.push((fname, blob));
    }
    entries.sort();
    let mut changes_listing = String::new();
    for (n, s) in &entries {
        use std::fmt::Write;
        let _ = writeln!(changes_listing, "100644 blob {s}\t{n}");
    }
    let changes_tree = git.mktree(&changes_listing)?;

    let meta_blob = git.hash_object(
        serde_json::to_string_pretty(&serde_json::json!({
            "format": 1,
            "trunk": trunk,
        }))?
        .as_bytes(),
    )?;
    let op_blob = git.hash_object(serde_json::to_string_pretty(op)?.as_bytes())?;
    let ops_tree = git.mktree(&format!("100644 blob {op_blob}\tcurrent.json\n"))?;
    let root = git.mktree(&format!(
        "040000 tree {changes_tree}\tchanges\n100644 blob {meta_blob}\tmeta.json\n040000 tree {ops_tree}\tops\n"
    ))?;

    let parents: Vec<&str> = old.iter().map(|s| s.as_str()).collect();
    let msg = format!("ism: {:?} on {}", op.kind, op.branch).to_lowercase();
    let commit = git.commit_tree(&root, &parents, &msg, None, false)?;
    git.update_ref_cas(DATA_REF, &commit, old.as_deref())?;
    Ok(commit)
}

/// Newest-first walk of the op log, returning (op commit sha, Op).
pub fn walk(git: &Git, limit: usize) -> Result<Vec<(String, Op)>> {
    if !git.ref_exists(DATA_REF) {
        return Ok(Vec::new());
    }
    let n = limit.to_string();
    let list = git.out(&["rev-list", "--max-count", &n, DATA_REF])?;
    let mut out = Vec::new();
    for sha in list.lines().filter(|l| !l.is_empty()) {
        if let Some(bytes) = git.blob_at(sha, "ops/current.json")? {
            let op: Op = serde_json::from_slice(&bytes)?;
            out.push((sha.to_string(), op));
        }
    }
    Ok(out)
}

/// Latest op for a branch, if any.
pub fn latest_for_branch(git: &Git, branch: &str) -> Result<Option<(String, Op)>> {
    Ok(walk(git, 500)?
        .into_iter()
        .find(|(_, op)| op.branch == branch))
}

/// Load an op record by its op-log commit sha.
pub fn load(git: &Git, op_sha: &str) -> Result<(String, Op)> {
    let sha = git.rev_parse(op_sha)?;
    let bytes = git
        .blob_at(&sha, "ops/current.json")?
        .ok_or_else(|| IsmError::UnknownRef(format!("not an ism op commit: {op_sha}")))?;
    Ok((sha, serde_json::from_slice(&bytes)?))
}

/// Read change metadata by id.
pub fn change_meta(git: &Git, id: &str) -> Result<Option<ChangeMeta>> {
    if !git.ref_exists(DATA_REF) {
        return Ok(None);
    }
    match git.blob_at(DATA_REF, &format!("changes/{id}.json"))? {
        Some(bytes) => Ok(Some(serde_json::from_slice(&bytes)?)),
        None => Ok(None),
    }
}
