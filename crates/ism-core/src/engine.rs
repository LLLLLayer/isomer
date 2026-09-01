//! The only write path: apply a checked plan (rebuild the chain atomically)
//! and undo (flip back to a recorded state). See design/05 for the atomicity
//! argument: new objects are invisible until the final CAS ref flips.

use crate::algebra::{FileState, Replay};
use crate::analyze::{analyze, Analysis};
use crate::error::{IsmError, Result};
use crate::gitio::Git;
use crate::model::*;
use crate::oplog;
use crate::plancheck::{check, CheckedPlan};
use sha2::{Digest, Sha256};
use std::collections::HashMap;

/// Deterministic change-id mint: stable for the same (base, head, node, summary),
/// so a re-run of the same plan mints the same ids (idempotency-friendly).
fn mint_change_id(base: &str, head: &str, node_index: usize, summary: &str) -> String {
    let mut h = Sha256::new();
    h.update(b"ism-change-v1");
    h.update(base.as_bytes());
    h.update(head.as_bytes());
    h.update(node_index.to_le_bytes());
    h.update(summary.as_bytes());
    let digest = h.finalize();
    let id: String = digest
        .iter()
        .take(8)
        .map(|b| CHANGE_ID_ALPHABET[(*b as usize) % 32] as char)
        .collect();
    format!("i-{id}")
}

fn plan_digest(plan: &Plan) -> Result<String> {
    use std::fmt::Write;
    let mut h = Sha256::new();
    h.update(serde_json::to_vec(plan)?);
    let hexed = h.finalize().iter().fold(String::new(), |mut acc, b| {
        let _ = write!(acc, "{b:02x}");
        acc
    });
    Ok(format!("sha256:{hexed}"))
}

pub struct ApplyContext {
    pub analysis: Analysis,
    pub checked: CheckedPlan,
}

/// Validate a plan against reality (analyze + R1..R8). Shared by check/apply.
pub fn validate(git: &Git, plan: &Plan) -> Result<ApplyContext> {
    let analysis = analyze(git, plan.base.as_deref(), false)?;
    let checked = check(git, plan, &analysis)?;
    Ok(ApplyContext { analysis, checked })
}

pub fn apply(git: &Git, plan: &Plan) -> Result<ApplyOutcome> {
    let branch = git.current_branch()?.ok_or_else(|| {
        IsmError::Precondition("apply requires a branch checkout (detached HEAD)".into())
    })?;
    // Correct the books first (journal-first crash protocol, design/05).
    oplog::reconcile(git, &branch)?;
    let ctx = validate(git, plan)?;
    let snap = &ctx.analysis.snapshot;
    let alg = ctx.analysis.alg.as_ref().expect("checked");
    let branch_ref = format!("refs/heads/{branch}");
    let old_head = snap.head.clone();
    let old_tree = git.tree_of(&old_head)?;
    let base_tree = git.tree_of(&snap.base)?;
    let sign = git
        .config("commit.gpgsign")
        .map(|v| v.eq_ignore_ascii_case("true"))
        .unwrap_or(false);
    let user_name = git.config("user.name").unwrap_or_default();
    let user_email = git.config("user.email").unwrap_or_default();

    // Change-id trailer per commit in the current stack, for preservation.
    let stack_change_of: HashMap<&str, &str> = snap
        .commits
        .iter()
        .filter_map(|c| c.change_id.as_deref().map(|id| (c.sha.as_str(), id)))
        .collect();
    // Total hunks per commit: identity may only be inherited by a node that
    // owns the WHOLE source commit — a split must mint fresh ids, or both
    // halves would carry the same trailer (duplicate_id on our own output).
    let commit_hunk_count: HashMap<&str, usize> = snap
        .commits
        .iter()
        .map(|c| (c.sha.as_str(), c.hunks.len()))
        .collect();
    // Ids explicitly claimed by any node must not also be inherited.
    let explicit_ids: std::collections::HashSet<&str> = ctx
        .checked
        .nodes
        .iter()
        .filter_map(|n| n.change.as_deref())
        .collect();

    // -- forge the new chain (invisible until the ref flips) ------------------
    let mut replay = Replay::new(alg);
    let mut parent_commit = snap.base.clone();
    let mut parent_tree = base_tree;
    let mut applied: Vec<AppliedChange> = Vec::new();
    let mut change_metas: Vec<ChangeMeta> = Vec::new();
    let mut blob_cache: HashMap<Vec<u8>, String> = HashMap::new();

    for (pos, node) in ctx.checked.nodes.iter().enumerate() {
        replay.apply(&node.hunk_idxs)?;

        // Tree: layer this node's touched files onto the parent tree.
        let mut tree_changes: Vec<(String, String, String)> = Vec::new();
        for fi in replay.touched_files(&node.hunk_idxs) {
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

        // Identity: preserve explicit change, else the single source commit's
        // trailer, else mint deterministically.
        let change_id = node
            .change
            .clone()
            .or_else(|| {
                let owns_whole_commit = node.source_commits.len() == 1
                    && commit_hunk_count
                        .get(node.source_commits[0].as_str())
                        .is_some_and(|&n| n == node.hunk_idxs.len());
                if owns_whole_commit {
                    stack_change_of
                        .get(node.source_commits[0].as_str())
                        .map(|s| s.to_string())
                        .filter(|id| !explicit_ids.contains(id.as_str()))
                } else {
                    None
                }
            })
            .unwrap_or_else(|| mint_change_id(&snap.base, &old_head, pos, &node.summary));

        // Authorship (design D18): single-source nodes keep the original
        // author; mixed nodes credit all source authors as co-authors.
        let mut author: Option<(String, String, String)> = None;
        let mut coauthors: Vec<String> = Vec::new();
        if node.source_commits.len() == 1 {
            author = Some(git.commit_author(&node.source_commits[0])?);
        } else {
            let mut seen: Vec<(String, String)> = Vec::new();
            for sha in &node.source_commits {
                let (name, email, _) = git.commit_author(sha)?;
                if (name.as_str(), email.as_str()) != (user_name.as_str(), user_email.as_str())
                    && !seen.contains(&(name.clone(), email.clone()))
                {
                    seen.push((name.clone(), email.clone()));
                    coauthors.push(format!("Co-authored-by: {name} <{email}>"));
                }
            }
        }

        let mut message = node.summary.clone();
        if let Some(body) = &node.body {
            message.push_str("\n\n");
            message.push_str(body);
        }
        message.push_str("\n\n");
        for ca in &coauthors {
            message.push_str(ca);
            message.push('\n');
        }
        message.push_str(&format!("{TRAILER_KEY}: {change_id}\n"));

        let author_ref = author
            .as_ref()
            .map(|(n, e, d)| (n.as_str(), e.as_str(), d.as_str()));
        let commit = git.commit_tree(&tree, &[&parent_commit], &message, author_ref, None, sign)?;

        applied.push(AppliedChange {
            id: change_id.clone(),
            name: node.name.clone(),
            commit: commit.clone(),
            summary: node.summary.clone(),
        });
        change_metas.push(ChangeMeta {
            id: change_id,
            name: node.name.clone(),
            summary: node.summary.clone(),
            body: node.body.clone(),
            deps: node
                .soft_deps
                .iter()
                .map(|p| ctx.checked.nodes[*p].name.clone().unwrap_or_default())
                .filter(|s| !s.is_empty())
                .collect(),
        });
        parent_commit = commit;
        parent_tree = tree;
    }

    // -- the proof, enforced inside the write path ---------------------------
    if parent_tree != old_tree {
        return Err(IsmError::Internal(format!(
            "tree invariance broken: rebuilt tree {parent_tree} != original {old_tree} — aborting, branch untouched"
        )));
    }

    // -- journal first, then flip the switch ---------------------------------
    // The op record lands on the data ref *before* the branch moves. If the
    // flip never happens (crash or a raced ref), `reconcile` voids the entry;
    // the books never claim a state the branch does not have.
    let op = Op {
        kind: OpKind::Apply,
        branch: branch.clone(),
        old_head: old_head.clone(),
        new_head: parent_commit.clone(),
        base: snap.base.clone(),
        old_tree: old_tree.clone(),
        new_tree: parent_tree.clone(),
        undoes: None,
        plan_digest: Some(plan_digest(plan)?),
        snapshot_digest: Some(snap.snapshot_digest.clone()),
        plan: Some(plan.clone()),
        tool_version: env!("CARGO_PKG_VERSION").to_string(),
        timestamp: crate::model::now_epoch(),
    };
    let trunk = (!ctx.analysis.trunk.is_empty()).then_some(ctx.analysis.trunk.as_str());
    let op_sha = oplog::append(git, &op, &change_metas, trunk)?;
    if let Err(e) = git.update_ref_cas(&branch_ref, &parent_commit, Some(&old_head)) {
        // Void the journaled op explicitly: the branch moved while we worked,
        // so its entry must not stand as the branch's latest state. Should
        // the void append itself fail (e.g. a raced data ref), the E101 must
        // still be the caller's error — reconcile will void the entry later.
        let void_note = match oplog::append_void(git, &op_sha, &op) {
            Ok(_) => "the journaled op was voided".to_string(),
            Err(e2) => format!("voiding the journaled op also failed ({e2}); it will be reconciled on the next command"),
        };
        return Err(IsmError::Precondition(format!(
            "branch {branch} moved during apply (ref update refused: {e}); \
{void_note} — re-run `ism inspect` and rebuild the plan"
        )));
    }

    Ok(ApplyOutcome {
        new_head: parent_commit,
        changes: applied,
        op: op_sha,
    })
}

#[derive(Debug, serde::Serialize)]
pub struct UndoOutcome {
    pub branch: String,
    pub restored_head: String,
    pub undone_op: String,
    pub op: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hint: Option<String>,
}

pub fn undo(git: &Git) -> Result<UndoOutcome> {
    let branch = git
        .current_branch()?
        .ok_or_else(|| IsmError::Precondition("undo requires a branch checkout".into()))?;
    oplog::reconcile(git, &branch)?;
    let (op_sha, op) = oplog::latest_for_branch(git, &branch)?.ok_or_else(|| {
        IsmError::Precondition(format!("no ism operations recorded for branch {branch}"))
    })?;
    let current = git.rev_parse("HEAD")?;
    if current != op.new_head {
        return Err(IsmError::UndoPrecondition(format!(
            "branch {branch} is at {current}, but the last ism operation left it at {}",
            op.new_head
        )));
    }
    let branch_ref = format!("refs/heads/{branch}");
    git.update_ref_cas(&branch_ref, &op.old_head, Some(&op.new_head))?;

    let undo_op = Op {
        kind: OpKind::Undo,
        branch: branch.clone(),
        old_head: op.new_head.clone(),
        new_head: op.old_head.clone(),
        base: op.base.clone(),
        old_tree: op.new_tree.clone(),
        new_tree: op.old_tree.clone(),
        undoes: Some(op_sha.clone()),
        plan_digest: None,
        snapshot_digest: None,
        plan: None,
        tool_version: env!("CARGO_PKG_VERSION").to_string(),
        timestamp: crate::model::now_epoch(),
    };
    let new_op = oplog::append(git, &undo_op, &[], None)?;

    let hint = git.upstream_of(&branch).map(|up| {
        format!("branch has upstream {up}; if the undone commits were pushed, you will need `git push --force-with-lease`")
    });

    Ok(UndoOutcome {
        branch,
        restored_head: op.old_head,
        undone_op: op_sha,
        op: new_op,
        hint,
    })
}
