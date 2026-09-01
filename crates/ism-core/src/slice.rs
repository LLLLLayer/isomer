//! Forge selected changes onto the stack base as loose commits — branch
//! mirrors for stacked-PR submission. A slice is a partial replay: it is
//! legal exactly when the selection is dependency-closed (every hard dep
//! of a selected hunk is itself selected), which this module re-checks
//! (E030 otherwise). Nothing else moves: no refs, no worktree, no index —
//! the caller points branches at the returned shas or forgets them.

use crate::algebra::{FileState, Replay};
use crate::analyze::analyze;
use crate::error::{IsmError, Result};
use crate::gitio::Git;
use crate::model::AppliedChange;
use std::collections::{HashMap, HashSet};

#[derive(Debug, serde::Serialize)]
pub struct SliceOutcome {
    /// The commit the forged chain grows from (the stack base).
    pub base: String,
    /// One forged commit per selected change, in landing order.
    pub commits: Vec<AppliedChange>,
    /// The last forged commit — what a PR head branch should point at.
    pub tip: String,
}

/// Replay `change_ids` (any order; landing order is taken from the stack)
/// onto the stack base and forge one commit per change, preserving the
/// original message and author, with the committer timestamp pinned to the
/// author's — so identical inputs forge identical shas: re-syncs are
/// no-ops, and two slices sharing a prefix fork at a common commit. The
/// tree-equality proof does not apply to a partial replay; what holds
/// instead is constructive: a dep-closed selection replays exactly as it
/// did in the full stack.
pub fn slice(git: &Git, base: Option<&str>, change_ids: &[String]) -> Result<SliceOutcome> {
    if let Some(b) = base {
        // A base off the first-parent line would silently forge mirrors
        // that revert the divergent work into identity-carrying commits.
        let resolved = git.rev_parse(b)?;
        let head = git.rev_parse("HEAD")?;
        if git.merge_base(&resolved, &head)? != resolved {
            return Err(IsmError::Precondition(format!(
                "--base {b} is not an ancestor of HEAD — slicing onto it would fold unrelated history into the mirrors"
            )));
        }
    }
    let analysis = analyze(git, base, false)?;
    let snap = &analysis.snapshot;
    let alg = analysis
        .alg
        .as_ref()
        .ok_or_else(|| IsmError::Precondition("stack contains a merge commit".into()))?;

    let want: HashSet<&str> = change_ids.iter().map(|s| s.as_str()).collect();
    if want.is_empty() {
        return Err(IsmError::Usage("slice needs at least one change id".into()));
    }
    let id_to_idx: HashMap<&str, usize> = snap
        .hunks
        .iter()
        .enumerate()
        .map(|(i, m)| (m.id.as_str(), i))
        .collect();

    // Selected commits in landing order, with their hunk indexes.
    let mut found: HashSet<&str> = HashSet::new();
    let mut picked: Vec<(usize, Vec<usize>)> = Vec::new();
    for (ci, c) in snap.commits.iter().enumerate() {
        let Some(id) = c.change_id.as_deref() else {
            continue;
        };
        if !want.contains(id) {
            continue;
        }
        if !found.insert(id) {
            return Err(IsmError::Precondition(format!(
                "two commits carry {id} (duplicate_id) — reorganize the stack first"
            )));
        }
        picked.push((ci, c.hunks.iter().map(|h| id_to_idx[h.as_str()]).collect()));
    }
    for id in &want {
        if !found.contains(id) {
            return Err(IsmError::Precondition(format!(
                "change {id} is not in the current stack"
            )));
        }
    }

    // Dependency closure: a selected hunk may only lean on selected hunks.
    let selected: HashSet<usize> = picked.iter().flat_map(|(_, h)| h.iter().copied()).collect();
    for (dependent, dependency) in &alg.deps {
        if selected.contains(dependent) && !selected.contains(dependency) {
            return Err(IsmError::HardDepViolation(format!(
                "slice is not dependency-closed: {} needs {}, which is not selected — add its change to the selection",
                snap.hunks[*dependent].id, snap.hunks[*dependency].id
            )));
        }
    }

    let base_tree = git.tree_of(&snap.base)?;

    let mut replay = Replay::new(alg);
    let mut parent_commit = snap.base.clone();
    let mut parent_tree = base_tree;
    let mut commits: Vec<AppliedChange> = Vec::new();
    let mut blob_cache: HashMap<Vec<u8>, String> = HashMap::new();

    for (ci, hunk_idxs) in &picked {
        replay.apply(hunk_idxs)?;

        let mut tree_changes: Vec<(String, String, String)> = Vec::new();
        for fi in replay.touched_files(hunk_idxs) {
            let path = alg.files[fi].clone();
            match replay.file_state(fi) {
                FileState::Deleted => tree_changes.push(("0".into(), String::new(), path)),
                FileState::Blob { mode, blob } => tree_changes.push((mode, blob, path)),
                FileState::Content { mode, bytes } => {
                    let blob = match blob_cache.get(&bytes) {
                        Some(b) => b.clone(),
                        None => {
                            let b = git.hash_object(&bytes)?;
                            blob_cache.insert(bytes, b.clone());
                            b
                        }
                    };
                    tree_changes.push((mode, blob, path));
                }
            }
        }
        let tree = git.build_tree(&parent_tree, &tree_changes)?;

        // A mirror, not a rewrite: original message (identity trailer and
        // all) and original author carry over verbatim.
        let src = &snap.commits[*ci];
        // %B appends a format-terminator newline; strip exactly that one so
        // the mirror's message is byte-equal to the original.
        let message = git.commit_message(&src.sha)?;
        let message = message.strip_suffix('\n').unwrap_or(&message);
        let author = git.commit_author(&src.sha)?;
        let commit = git.commit_tree(
            &tree,
            &[&parent_commit],
            message,
            Some((author.0.as_str(), author.1.as_str(), author.2.as_str())),
            Some(author.2.as_str()),
            // Never signed: OpenPGP signatures embed their own timestamp,
            // which would break deterministic forging — sibling slices
            // would stop forking at identical prefixes. Mirrors are review
            // artifacts; the user's real branch (engine.rs) keeps signing.
            false,
        )?;

        commits.push(AppliedChange {
            id: src.change_id.clone().expect("picked implies id"),
            name: None,
            commit: commit.clone(),
            summary: src.title.clone(),
        });
        parent_commit = commit;
        parent_tree = tree;
    }

    Ok(SliceOutcome {
        base: snap.base.clone(),
        tip: parent_commit,
        commits,
    })
}
