//! Plan validation, rules R1–R8 (design/04).
//!
//! The contract: `check` passing GUARANTEES `apply` succeeds. R8 performs the
//! full in-memory replay and compares the final state against head, so the
//! guarantee is established constructively, not by static reasoning alone.

use crate::algebra::{FileState, Replay};
use crate::analyze::Analysis;
use crate::error::{IsmError, Result};
use crate::gitio::Git;
use crate::model::*;
use std::collections::{HashMap, HashSet};

/// A validated plan, resolved down to hunk indices, ready for apply.
pub struct CheckedPlan {
    /// Nodes in `order` sequence.
    pub nodes: Vec<CheckedNode>,
}

pub struct CheckedNode {
    pub name: Option<String>,
    /// Existing change id to preserve (validated); None → mint at apply.
    pub change: Option<String>,
    pub summary: String,
    pub body: Option<String>,
    /// Hunk indices (canonical order) belonging to this node.
    pub hunk_idxs: Vec<usize>,
    /// Source commits of those hunks (deduplicated, stack order).
    pub source_commits: Vec<String>,
    /// Soft dependency node positions (earlier in order).
    pub soft_deps: Vec<usize>,
}

pub fn check(git: &Git, plan: &Plan, analysis: &Analysis) -> Result<CheckedPlan> {
    let snap = &analysis.snapshot;

    // R1: version.
    if plan.version != 1 {
        return Err(IsmError::PlanSchema(format!(
            "unsupported plan version {}",
            plan.version
        )));
    }
    // Optional re-anchoring (redundant with digest, but yields better errors).
    if let Some(h) = &plan.head {
        if !snap.head.starts_with(h.as_str()) && h != &snap.head {
            return Err(IsmError::StalePlan(format!(
                "plan was computed against head {h}, but head is now {}",
                snap.head
            )));
        }
    }
    // R2: snapshot digest.
    if plan.snapshot_digest != snap.snapshot_digest {
        return Err(IsmError::StalePlan(format!(
            "snapshot digest mismatch: plan has {}, reality is {}",
            plan.snapshot_digest, snap.snapshot_digest
        )));
    }
    let alg = analysis
        .alg
        .as_ref()
        .ok_or_else(|| IsmError::Precondition("stack contains a merge commit".into()))?;

    // Hunk id → canonical index.
    let mut id_to_idx: HashMap<&str, usize> = HashMap::new();
    for (i, m) in snap.hunks.iter().enumerate() {
        id_to_idx.insert(m.id.as_str(), i);
    }
    // Commit sha (full) list for `from: commit:` resolution.
    let commit_shas: Vec<&str> = snap.commits.iter().map(|c| c.sha.as_str()).collect();

    // R4: node naming, change refs, source resolution.
    let mut names: HashSet<&str> = HashSet::new();
    let mut change_refs: HashSet<&str> = HashSet::new();
    struct RawNode<'a> {
        node: &'a PlanNode,
        hunk_idxs: Vec<usize>,
    }
    let mut raw_nodes: Vec<RawNode> = Vec::new();
    for node in &plan.nodes {
        if node.name.is_none() && node.change.is_none() {
            return Err(IsmError::PlanSchema(
                "every node needs a `name` or a `change` id so `order` can reference it".into(),
            ));
        }
        if let Some(n) = &node.name {
            if !is_valid_node_name(n) {
                return Err(IsmError::PlanSchema(format!("invalid node name: {n}")));
            }
            if !names.insert(n.as_str()) {
                return Err(IsmError::PlanSchema(format!("duplicate node name: {n}")));
            }
        }
        if node.summary.trim().is_empty() {
            return Err(IsmError::PlanSchema(
                "node summary must not be empty".into(),
            ));
        }
        if let Some(c) = &node.change {
            if !is_valid_change_id(c) {
                return Err(IsmError::PlanSchema(format!("invalid change id: {c}")));
            }
            if !change_refs.insert(c.as_str()) {
                return Err(IsmError::PlanSchema(format!("change id used twice: {c}")));
            }
            // Must exist: as a stack trailer or as metadata on the data ref.
            let in_stack = snap
                .commits
                .iter()
                .any(|ci| ci.change_id.as_deref() == Some(c));
            let in_data = git
                .blob_at("refs/isomer/data", &format!("changes/{c}.json"))
                .ok()
                .flatten()
                .is_some();
            if !in_stack && !in_data {
                return Err(IsmError::UnknownRef(format!("change id not found: {c}")));
            }
        }
        // Resolve sources.
        let hunk_idxs: Vec<usize> = match &node.from {
            NodeSource::Commit(spec) => {
                let Some(pfx) = spec.strip_prefix("commit:") else {
                    return Err(IsmError::PlanSchema(format!(
                        "string `from` must look like \"commit:<sha>\", got: {spec}"
                    )));
                };
                let matches: Vec<usize> = commit_shas
                    .iter()
                    .enumerate()
                    .filter(|(_, sha)| sha.starts_with(pfx))
                    .map(|(i, _)| i)
                    .collect();
                match matches.as_slice() {
                    [ci] => {
                        let sha = commit_shas[*ci];
                        snap.hunks
                            .iter()
                            .enumerate()
                            .filter(|(_, m)| m.commit == sha)
                            .map(|(i, _)| i)
                            .collect()
                    }
                    [] => return Err(IsmError::UnknownRef(format!("commit not in stack: {pfx}"))),
                    _ => {
                        return Err(IsmError::UnknownRef(format!(
                            "commit prefix ambiguous in stack: {pfx}"
                        )))
                    }
                }
            }
            NodeSource::Hunks(ids) => {
                let mut v = Vec::new();
                for id in ids {
                    if let Some(&i) = id_to_idx.get(id.as_str()) {
                        v.push(i);
                        continue;
                    }
                    // E003: same path:start exists but digest differs.
                    let anchor = id.split('#').next().unwrap_or(id);
                    if let Some(m) = snap
                        .hunks
                        .iter()
                        .find(|m| m.id.split('#').next() == Some(anchor))
                    {
                        let found = m.id.split('#').nth(1).unwrap_or("").to_string();
                        let expected = id.split('#').nth(1).unwrap_or("").to_string();
                        return Err(IsmError::DigestMismatch {
                            id: id.clone(),
                            expected,
                            found,
                        });
                    }
                    return Err(IsmError::UnknownRef(format!("unknown hunk: {id}")));
                }
                v.sort_unstable();
                v
            }
        };
        raw_nodes.push(RawNode { node, hunk_idxs });
    }

    // R3: every hunk exactly once.
    let mut owner: Vec<Option<usize>> = vec![None; snap.hunks.len()];
    for (ni, rn) in raw_nodes.iter().enumerate() {
        for &hi in &rn.hunk_idxs {
            if let Some(prev) = owner[hi] {
                return Err(IsmError::HunkDuplicated(format!(
                    "{} is assigned to node {} and node {}",
                    snap.hunks[hi].id, prev, ni
                )));
            }
            owner[hi] = Some(ni);
        }
    }
    if let Some(unassigned) = owner.iter().position(|o| o.is_none()) {
        return Err(IsmError::HunkUnassigned(snap.hunks[unassigned].id.clone()));
    }

    // R5: order ↔ nodes bijection; build position map.
    if plan.order.len() != plan.nodes.len() {
        return Err(IsmError::PlanSchema(format!(
            "`order` has {} entries but there are {} nodes",
            plan.order.len(),
            plan.nodes.len()
        )));
    }
    let resolve_node = |key: &str| -> Option<usize> {
        raw_nodes.iter().position(|rn| {
            rn.node.name.as_deref() == Some(key) || rn.node.change.as_deref() == Some(key)
        })
    };
    let mut order_idx: Vec<usize> = Vec::new();
    let mut seen_nodes: HashSet<usize> = HashSet::new();
    for key in &plan.order {
        let ni = resolve_node(key)
            .ok_or_else(|| IsmError::UnknownRef(format!("order references unknown node: {key}")))?;
        if !seen_nodes.insert(ni) {
            return Err(IsmError::PlanSchema(format!(
                "node referenced twice in order: {key}"
            )));
        }
        order_idx.push(ni);
    }

    // Node position (in order) per hunk.
    let mut pos_of_node: Vec<usize> = vec![0; raw_nodes.len()];
    for (pos, &ni) in order_idx.iter().enumerate() {
        pos_of_node[ni] = pos;
    }
    let pos_of_hunk = |hi: usize| pos_of_node[owner[hi].unwrap()];

    // R6: order must linearize hard dependencies.
    for (dependent, dependency) in &alg.deps {
        if pos_of_hunk(*dependent) < pos_of_hunk(*dependency) {
            return Err(IsmError::HardDepViolation(format!(
                "{} (node position {}) depends on {} (node position {})",
                snap.hunks[*dependent].id,
                pos_of_hunk(*dependent) + 1,
                snap.hunks[*dependency].id,
                pos_of_hunk(*dependency) + 1
            )));
        }
    }

    // R7: soft deps resolve to strictly-earlier nodes.
    let mut soft: Vec<Vec<usize>> = vec![Vec::new(); raw_nodes.len()];
    for (ni, rn) in raw_nodes.iter().enumerate() {
        for dep in &rn.node.deps {
            let di = resolve_node(dep).ok_or_else(|| {
                IsmError::SoftDepInvalid(format!("dep references unknown node: {dep}"))
            })?;
            if pos_of_node[di] >= pos_of_node[ni] {
                return Err(IsmError::SoftDepInvalid(format!(
                    "node at position {} declares dep on node at position {} which is not earlier",
                    pos_of_node[ni] + 1,
                    pos_of_node[di] + 1
                )));
            }
            soft[ni].push(pos_of_node[di]);
        }
    }

    // R8: full replay; final state must equal head, byte for byte.
    let mut replay = Replay::new(alg);
    for &ni in &order_idx {
        replay.apply(&raw_nodes[ni].hunk_idxs)?;
    }
    for (fi, path) in alg.files.iter().enumerate() {
        let state = replay.file_state(fi);
        let head_entry = &analysis.head_entries[fi];
        let ok = match (&state, head_entry) {
            (FileState::Deleted, None) => true,
            (FileState::Blob { blob, mode }, Some((hm, hb))) => blob == hb && mode == hm,
            (FileState::Content { bytes, mode }, Some((hm, hb))) => {
                if mode != hm {
                    false
                } else {
                    // Read-only content hash (no -w: nothing is written).
                    let sha = String::from_utf8_lossy(&git.run_with(
                        &["hash-object", "--stdin"],
                        Some(bytes),
                        &[],
                    )?)
                    .trim()
                    .to_string();
                    &sha == hb
                }
            }
            _ => false,
        };
        if !ok {
            return Err(IsmError::ReplayFailed(format!(
                "final state of {path} does not match head"
            )));
        }
    }

    // Assemble in order sequence.
    let mut nodes = Vec::new();
    for &ni in &order_idx {
        let rn = &raw_nodes[ni];
        let mut sources: Vec<String> = Vec::new();
        for &hi in &rn.hunk_idxs {
            let sha = snap.hunks[hi].commit.clone();
            if !sources.contains(&sha) {
                sources.push(sha);
            }
        }
        nodes.push(CheckedNode {
            name: rn.node.name.clone(),
            change: rn.node.change.clone(),
            summary: rn.node.summary.clone(),
            body: rn.node.body.clone(),
            hunk_idxs: rn.hunk_idxs.clone(),
            source_commits: sources,
            soft_deps: soft[ni].clone(),
        });
    }
    Ok(CheckedPlan { nodes })
}
