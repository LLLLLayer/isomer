//! The operation log: a parallel metadata commit chain at `refs/isomer/data`.
//!
//! Append-only (jj semantics): undo appends, never rewinds. Every entry is a
//! commit whose tree holds `meta.json`, `changes/<id>.json`, `comments/<id>.json`
//! and — for operation entries — `ops/current.json`. Comment entries have no
//! `ops/` tree, so op walks skip them naturally. Everything is readable with
//! bare `git cat-file` — the open-format promise.
//!
//! Crash bookkeeping (journal-first protocol, design/05): apply appends its op
//! record *before* flipping the branch ref. If the flip never lands (crash or
//! ref race), the newest op's `new_head` disagrees with the branch while the
//! branch still sits at `old_head`; `reconcile` detects that and appends a
//! `void` op so the books never claim a state the branch does not have.

use crate::error::{IsmError, Result};
use crate::gitio::Git;
use crate::model::{ChangeMeta, Comment, Op, OpKind};
use std::collections::HashSet;

pub const DATA_REF: &str = "refs/isomer/data";

/// One data commit: carry forward previous `changes/` and `comments/` entries
/// by blob-sha reuse, upsert the given ones, and (for operation entries)
/// record `ops/current.json`. Returns the new data commit sha.
fn append_data_commit(
    git: &Git,
    op: Option<&Op>,
    changes: &[ChangeMeta],
    comments: &[Comment],
    trunk: Option<&str>,
    subject: &str,
) -> Result<String> {
    let old = if git.ref_exists(DATA_REF) {
        Some(git.rev_parse(DATA_REF)?)
    } else {
        None
    };

    let subtree = |dir: &str, upserts: &[(String, String)]| -> Result<String> {
        let mut entries: Vec<(String, String)> = Vec::new(); // (file name, blob sha)
        if let Some(prev) = &old {
            for (mode, sha, name) in git.ls_tree(prev, dir)? {
                if mode == "100644" {
                    entries.push((name, sha));
                }
            }
        }
        for (fname, blob) in upserts {
            entries.retain(|(n, _)| n != fname);
            entries.push((fname.clone(), blob.clone()));
        }
        entries.sort();
        let mut listing = String::new();
        for (n, s) in &entries {
            use std::fmt::Write;
            let _ = writeln!(listing, "100644 blob {s}\t{n}");
        }
        git.mktree(&listing)
    };

    let mut change_upserts = Vec::new();
    for c in changes {
        let blob = git.hash_object(serde_json::to_string_pretty(c)?.as_bytes())?;
        change_upserts.push((format!("{}.json", c.id), blob));
    }
    let mut comment_upserts = Vec::new();
    for c in comments {
        let blob = git.hash_object(serde_json::to_string_pretty(c)?.as_bytes())?;
        comment_upserts.push((format!("{}.json", c.id), blob));
    }
    let changes_tree = subtree("changes", &change_upserts)?;
    let comments_tree = subtree("comments", &comment_upserts)?;

    // meta.json: rewrite when a trunk is given, else carry the previous blob.
    let meta_blob = match trunk {
        Some(t) => git.hash_object(
            serde_json::to_string_pretty(&serde_json::json!({ "format": 1, "trunk": t }))?
                .as_bytes(),
        )?,
        None => match &old {
            Some(prev) => git
                .ls_tree(prev, "")?
                .into_iter()
                .find(|(_, _, name)| name == "meta.json")
                .map(|(_, sha, _)| Ok::<_, IsmError>(sha))
                .unwrap_or_else(|| {
                    git.hash_object(
                        serde_json::to_string_pretty(
                            &serde_json::json!({ "format": 1, "trunk": "" }),
                        )?
                        .as_bytes(),
                    )
                })?,
            None => git.hash_object(
                serde_json::to_string_pretty(&serde_json::json!({ "format": 1, "trunk": "" }))?
                    .as_bytes(),
            )?,
        },
    };

    let mut root_listing = format!(
        "040000 tree {changes_tree}\tchanges\n040000 tree {comments_tree}\tcomments\n100644 blob {meta_blob}\tmeta.json\n"
    );
    if let Some(op) = op {
        let op_blob = git.hash_object(serde_json::to_string_pretty(op)?.as_bytes())?;
        let ops_tree = git.mktree(&format!("100644 blob {op_blob}\tcurrent.json\n"))?;
        root_listing.push_str(&format!("040000 tree {ops_tree}\tops\n"));
    }
    let root = git.mktree(&root_listing)?;

    let parents: Vec<&str> = old.iter().map(|s| s.as_str()).collect();
    let commit = git.commit_tree(&root, &parents, subject, None, None, false)?;
    git.update_ref_cas(DATA_REF, &commit, old.as_deref())?;
    Ok(commit)
}

/// Append one operation. `changes` upserts change metadata; existing entries
/// are carried forward by tree-sha reuse (no content rewriting).
pub fn append(git: &Git, op: &Op, changes: &[ChangeMeta], trunk: Option<&str>) -> Result<String> {
    let msg = format!("ism: {:?} on {}", op.kind, op.branch).to_lowercase();
    append_data_commit(git, Some(op), changes, &[], trunk, &msg)
}

/// Append or update comments. Comment entries carry no `ops/` tree, so the
/// op walk skips them; only the `comments/` books advance.
pub fn append_comments(git: &Git, comments: &[Comment]) -> Result<String> {
    append_data_commit(git, None, &[], comments, None, "ism: comment")
}

/// Newest-first walk of the op log, returning (op commit sha, Op).
/// Void entries and the ops they void are filtered out; comment-only data
/// commits (no `ops/current.json`) are skipped.
pub fn walk(git: &Git, limit: usize) -> Result<Vec<(String, Op)>> {
    let mut out = Vec::new();
    let mut voided: HashSet<String> = HashSet::new();
    for (sha, op) in walk_raw(git, limit)? {
        if op.kind == OpKind::Void {
            if let Some(target) = &op.undoes {
                voided.insert(target.clone());
            }
            continue;
        }
        if voided.contains(&sha) {
            continue;
        }
        out.push((sha, op));
    }
    Ok(out)
}

/// Newest-first walk including void entries (audit view).
///
/// `limit` bounds the number of OP entries returned, not data commits
/// scanned — comment-only commits share the same chain and must never
/// crowd ops out of the window. Scanning itself is capped generously.
pub fn walk_raw(git: &Git, limit: usize) -> Result<Vec<(String, Op)>> {
    if !git.ref_exists(DATA_REF) {
        return Ok(Vec::new());
    }
    const SCAN_CAP: &str = "100000";
    let list = git.out(&["rev-list", "--max-count", SCAN_CAP, DATA_REF])?;
    let mut out = Vec::new();
    for sha in list.lines().filter(|l| !l.is_empty()) {
        if out.len() >= limit {
            break;
        }
        if let Some(bytes) = git.blob_at(sha, "ops/current.json")? {
            let op: Op = serde_json::from_slice(&bytes)?;
            out.push((sha.to_string(), op));
        }
    }
    Ok(out)
}

/// Latest live (non-void, non-voided) op for a branch, if any.
pub fn latest_for_branch(git: &Git, branch: &str) -> Result<Option<(String, Op)>> {
    Ok(walk(git, 500)?
        .into_iter()
        .find(|(_, op)| op.branch == branch))
}

/// Crash bookkeeping. If the newest live op for `branch` recorded a `new_head`
/// that never became the branch tip — the branch still sits at the op's
/// `old_head` — the flip never landed (crash between journal and ref update,
/// or an external rewind). Append a `void` op so the books match reality.
/// Returns the voided op's data-commit sha, if any.
///
/// Deliberately conservative: when the branch moved *beyond* `new_head`
/// (normal commits on top) or somewhere unrelated, nothing is voided.
pub fn reconcile(git: &Git, branch: &str) -> Result<Option<String>> {
    let Some((op_sha, op)) = latest_for_branch(git, branch)? else {
        return Ok(None);
    };
    let current = match git.rev_parse(&format!("refs/heads/{branch}")) {
        Ok(sha) => sha,
        Err(_) => return Ok(None),
    };
    if op.new_head == current || op.old_head != current {
        return Ok(None);
    }
    append_void(git, &op_sha, &op)?;
    Ok(Some(op_sha))
}

/// Append a `void` entry for the given op (books correction; refs untouched).
pub fn append_void(git: &Git, target_sha: &str, target: &Op) -> Result<String> {
    let current = git
        .rev_parse(&format!("refs/heads/{}", target.branch))
        .unwrap_or_else(|_| target.old_head.clone());
    let tree = git
        .tree_of(&current)
        .unwrap_or_else(|_| target.old_tree.clone());
    let void = Op {
        kind: OpKind::Void,
        branch: target.branch.clone(),
        old_head: current.clone(),
        new_head: current,
        base: target.base.clone(),
        old_tree: tree.clone(),
        new_tree: tree,
        undoes: Some(target_sha.to_string()),
        plan_digest: None,
        snapshot_digest: None,
        plan: None,
        tool_version: env!("CARGO_PKG_VERSION").to_string(),
        timestamp: crate::model::now_epoch(),
    };
    append(git, &void, &[], None)
}

/// Load an op record by its op-log commit sha.
pub fn load(git: &Git, op_sha: &str) -> Result<(String, Op)> {
    let sha = git.rev_parse(op_sha)?;
    let bytes = git
        .blob_at(&sha, "ops/current.json")?
        .ok_or_else(|| IsmError::UnknownRef(format!("not an ism op commit: {op_sha}")))?;
    Ok((sha, serde_json::from_slice(&bytes)?))
}

/// All change metadata entries on the data ref.
pub fn change_metas(git: &Git) -> Result<Vec<ChangeMeta>> {
    if !git.ref_exists(DATA_REF) {
        return Ok(Vec::new());
    }
    let mut out = Vec::new();
    for (mode, _sha, name) in git.ls_tree(DATA_REF, "changes")? {
        if mode != "100644" {
            continue;
        }
        if let Some(bytes) = git.blob_at(DATA_REF, &format!("changes/{name}"))? {
            out.push(serde_json::from_slice(&bytes)?);
        }
    }
    Ok(out)
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

/// All comments, oldest-first by created_at (stable for agents).
pub fn comments(git: &Git) -> Result<Vec<Comment>> {
    if !git.ref_exists(DATA_REF) {
        return Ok(Vec::new());
    }
    let mut out: Vec<Comment> = Vec::new();
    for (mode, _sha, name) in git.ls_tree(DATA_REF, "comments")? {
        if mode != "100644" {
            continue;
        }
        if let Some(bytes) = git.blob_at(DATA_REF, &format!("comments/{name}"))? {
            out.push(serde_json::from_slice(&bytes)?);
        }
    }
    out.sort_by(|a, b| {
        (a.created_at.parse::<u64>().unwrap_or(0), a.id.clone())
            .cmp(&(b.created_at.parse::<u64>().unwrap_or(0), b.id.clone()))
    });
    Ok(out)
}

/// Read one comment by id.
pub fn comment(git: &Git, id: &str) -> Result<Option<Comment>> {
    if !git.ref_exists(DATA_REF) {
        return Ok(None);
    }
    match git.blob_at(DATA_REF, &format!("comments/{id}.json"))? {
        Some(bytes) => Ok(Some(serde_json::from_slice(&bytes)?)),
        None => Ok(None),
    }
}
