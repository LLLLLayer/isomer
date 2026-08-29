//! Independent verification: prove that a recorded operation preserved the
//! final tree bit for bit. Deliberately NOT sharing code paths with the apply
//! engine (audit independence): it re-derives both trees from the refs alone.

use crate::error::{IsmError, Result};
use crate::gitio::Git;
use crate::model::VerifyOutcome;
use crate::oplog;

pub fn verify(git: &Git, op_ref: Option<&str>) -> Result<VerifyOutcome> {
    let (op_sha, op) = match op_ref {
        Some(r) => oplog::load(git, r)?,
        None => {
            let branch = git
                .current_branch()?
                .ok_or_else(|| IsmError::Precondition("detached HEAD; pass --op".into()))?;
            oplog::latest_for_branch(git, &branch)?.ok_or_else(|| {
                IsmError::Precondition(format!("no ism operations recorded for branch {branch}"))
            })?
        }
    };

    // Live path: resolve the trees from the object db right now.
    let live_old = git.tree_of(&op.old_head).ok();
    let live_new = git.tree_of(&op.new_head).ok();
    let (old_tree, new_tree, live) = match (live_old, live_new) {
        (Some(o), Some(n)) => (o, n, true),
        // Archival fallback: objects gc'd; compare recorded tree ids.
        _ => (op.old_tree.clone(), op.new_tree.clone(), false),
    };

    Ok(VerifyOutcome {
        ok: old_tree == new_tree && !old_tree.is_empty(),
        branch: op.branch.clone(),
        op: op_sha,
        old_head: op.old_head.clone(),
        new_head: op.new_head.clone(),
        old_tree: old_tree.clone(),
        new_tree: new_tree.clone(),
        live,
        reproduce: vec![
            format!("git rev-parse {}^{{tree}}", op.old_head),
            format!("git rev-parse {}^{{tree}}", op.new_head),
        ],
    })
}
