//! The inspect pipeline: turn a frozen `base..head` range into a Snapshot
//! (facts for the agent) plus the rich internal state that check/apply reuse.

use crate::algebra::{Algebra, BaseFile, SeqHunk, SeqPayload};
use crate::error::{IsmError, Result};
use crate::gitio::{Git, EMPTY_TREE};
use crate::model::*;
use crate::parse::{parse_change_trailers, parse_diff};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashMap, HashSet};

pub struct Analysis {
    pub snapshot: Snapshot,
    /// None when the stack contains a merge commit (reorg undefined).
    pub alg: Option<Algebra>,
    /// Patch text per hunk (canonical order), for --full and `show hunk`.
    pub patches: Vec<String>,
    /// head-side (mode, blob) per file index; None = absent at head.
    pub head_entries: Vec<Option<(String, String)>>,
    /// Trunk name used for base detection (for op metadata).
    pub trunk: String,
}

fn hex(bytes: &[u8]) -> String {
    use std::fmt::Write;
    bytes.iter().fold(String::new(), |mut acc, b| {
        let _ = write!(acc, "{b:02x}");
        acc
    })
}

fn file_entry(git: &Git, rev: &str, path: &str) -> Result<Option<(String, String)>> {
    let out = git.run(&["ls-tree", rev, "--", path]);
    match out {
        Ok(bytes) => {
            let text = String::from_utf8_lossy(&bytes);
            for line in text.lines() {
                if let Some((meta, _name)) = line.split_once('\t') {
                    let parts: Vec<&str> = meta.split_whitespace().collect();
                    if parts.len() == 3 && parts[1] == "blob" {
                        return Ok(Some((parts[0].to_string(), parts[2].to_string())));
                    }
                }
            }
            Ok(None)
        }
        Err(_) => Ok(None),
    }
}

/// Detect the trunk branch: `isomer.trunk` config, else main/master (local,
/// then origin/).
pub fn detect_trunk(git: &Git) -> Result<String> {
    if let Some(t) = git.config("isomer.trunk") {
        return Ok(t);
    }
    for cand in ["main", "master", "origin/main", "origin/master"] {
        if git.ok(&["rev-parse", "--verify", "--quiet", cand]) {
            return Ok(cand.to_string());
        }
    }
    Err(IsmError::Usage(
        "cannot determine trunk branch; set `git config isomer.trunk <branch>` or pass --base"
            .into(),
    ))
}

pub fn analyze(git: &Git, base_override: Option<&str>, full: bool) -> Result<Analysis> {
    let head = git.rev_parse("HEAD")?;
    let branch = git.current_branch()?.unwrap_or_else(|| "HEAD".into());

    let (base, trunk) = match base_override {
        Some(b) => (git.rev_parse(b)?, String::new()),
        None => {
            let trunk = detect_trunk(git)?;
            let base = if branch == trunk {
                head.clone()
            } else {
                git.merge_base(&trunk, &head)?
            };
            (base, trunk)
        }
    };

    let commits_raw = git.rev_list_with_parents(&base, &head)?;

    // Merge commits make hunk sequencing undefined; report and stop hunk work.
    let merges: Vec<String> = commits_raw
        .iter()
        .filter(|(_, p)| *p > 1)
        .map(|(sha, _)| sha.clone())
        .collect();

    let mut anomalies: Vec<Anomaly> = Vec::new();
    for m in &merges {
        anomalies.push(Anomaly::MergeInStack { commit: m.clone() });
    }

    // -- trailer / identity anomalies ---------------------------------------
    let data_ref_exists = git.ref_exists("refs/isomer/data");
    let mut commit_infos: Vec<CommitInfo> = Vec::new();
    let mut seen_ids: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for (sha, _) in &commits_raw {
        let message = git.commit_message(sha)?;
        let ids = parse_change_trailers(&message);
        let change_id = match ids.len() {
            0 => {
                anomalies.push(Anomaly::Untracked {
                    commit: sha.clone(),
                });
                None
            }
            1 => Some(ids[0].clone()),
            _ => {
                anomalies.push(Anomaly::Merged {
                    commit: sha.clone(),
                    change_ids: ids.clone(),
                });
                None
            }
        };
        for id in &ids {
            seen_ids.entry(id.clone()).or_default().push(sha.clone());
            if data_ref_exists
                && git
                    .blob_at("refs/isomer/data", &format!("changes/{id}.json"))?
                    .is_none()
            {
                anomalies.push(Anomaly::UnknownId {
                    change_id: id.clone(),
                    commit: sha.clone(),
                });
            }
        }
        commit_infos.push(CommitInfo {
            sha: sha.clone(),
            title: git.commit_title(sha)?,
            change_id,
            hunks: Vec::new(),
        });
    }
    for (id, shas) in &seen_ids {
        if shas.len() > 1 {
            anomalies.push(Anomaly::DuplicateId {
                change_id: id.clone(),
                commits: shas.clone(),
            });
        }
    }

    if !merges.is_empty() {
        // Facts stop at commit level; no hunks, no digest anchoring hunks.
        let snapshot = Snapshot {
            snapshot_digest: String::new(),
            base,
            head,
            branch,
            commits: commit_infos,
            hunks: Vec::new(),
            deps: Vec::new(),
            anomalies,
        };
        return Ok(Analysis {
            snapshot,
            alg: None,
            patches: Vec::new(),
            head_entries: Vec::new(),
            trunk,
        });
    }

    // -- parse all diffs, decide per-path degrade ----------------------------
    struct CommitDiff {
        sha: String,
        files: Vec<crate::parse::FileDiff>,
    }
    let mut commit_diffs: Vec<CommitDiff> = Vec::new();
    let mut degraded_paths: HashSet<String> = HashSet::new();
    for (i, (sha, parents)) in commits_raw.iter().enumerate() {
        let parent: String = if *parents == 0 {
            EMPTY_TREE.into()
        } else if i == 0 {
            base.clone()
        } else {
            commits_raw[i - 1].0.clone()
        };
        let files = parse_diff(&git.diff_u0(&parent, sha)?)?;
        for f in &files {
            if f.degraded || f.is_deleted {
                degraded_paths.insert(f.path.clone());
            }
        }
        commit_diffs.push(CommitDiff {
            sha: sha.clone(),
            files,
        });
    }

    // -- base file states -----------------------------------------------------
    let mut files: Vec<String> = Vec::new();
    let mut file_pos: HashMap<String, usize> = HashMap::new();
    for cd in &commit_diffs {
        for f in &cd.files {
            if !file_pos.contains_key(&f.path) {
                file_pos.insert(f.path.clone(), files.len());
                files.push(f.path.clone());
            }
        }
    }
    let mut base_files: Vec<BaseFile> = Vec::new();
    for path in &files {
        let entry = file_entry(git, &base, path)?;
        let degraded = degraded_paths.contains(path);
        let (mode, blob) = match &entry {
            Some((m, b)) => (m.clone(), b.clone()),
            None => {
                // Mode of a new file comes from its creating diff.
                let m = commit_diffs
                    .iter()
                    .flat_map(|cd| cd.files.iter())
                    .find(|f| &f.path == path)
                    .map(|f| f.new_mode.clone())
                    .unwrap_or_else(|| "100644".into());
                (m, String::new())
            }
        };
        let (lines, trailing) = if degraded || entry.is_none() {
            (None, true)
        } else {
            let content = git
                .blob_at(&base, path)?
                .ok_or_else(|| IsmError::Internal(format!("blob missing for {path}")))?;
            let trailing = content.is_empty() || content.ends_with(b"\n");
            let mut ls: Vec<Vec<u8>> = Vec::new();
            let mut start = 0usize;
            for (idx, b) in content.iter().enumerate() {
                if *b == b'\n' {
                    ls.push(content[start..idx].to_vec());
                    start = idx + 1;
                }
            }
            if start < content.len() {
                ls.push(content[start..].to_vec());
            }
            (Some(ls), trailing)
        };
        base_files.push(BaseFile {
            lines,
            trailing_newline: trailing,
            mode,
            blob,
        });
    }

    // -- canonical sequence ---------------------------------------------------
    let mut seq: Vec<SeqHunk> = Vec::new();
    let mut hunk_commit_idx: Vec<usize> = Vec::new(); // seq idx → commit idx
    let mut metas: Vec<HunkMeta> = Vec::new();
    let mut patches: Vec<String> = Vec::new();
    let mut used_ids: HashSet<String> = HashSet::new();

    for (ci, cd) in commit_diffs.iter().enumerate() {
        for f in &cd.files {
            if degraded_paths.contains(&f.path) {
                let deleted = f.is_deleted;
                let digest_full = {
                    let mut h = Sha256::new();
                    h.update(b"file");
                    h.update(cd.sha.as_bytes());
                    h.update(f.path.as_bytes());
                    h.update(f.new_blob.as_bytes());
                    hex(&h.finalize())[..16].to_string()
                };
                let mut id = format!("{}:0#{}", f.path, &digest_full[..4]);
                if !used_ids.insert(id.clone()) {
                    id = format!("{}:0#{}", f.path, &digest_full[..8]);
                    if !used_ids.insert(id.clone()) {
                        return Err(IsmError::Internal(format!("hunk id collision: {id}")));
                    }
                }
                metas.push(HunkMeta {
                    id,
                    commit: cd.sha.clone(),
                    kind: HunkKind::File,
                    old_range: (0, 0),
                    new_range: (0, 0),
                    lines: LineStat { add: 0, del: 0 },
                    patch: None,
                });
                patches.push(format!(
                    "whole-file unit: {} -> blob {}",
                    f.path,
                    if deleted { "<deleted>" } else { &f.new_blob }
                ));
                seq.push(SeqHunk {
                    file: f.path.clone(),
                    commit: cd.sha.clone(),
                    payload: SeqPayload::WholeFile {
                        new_blob: if deleted {
                            None
                        } else {
                            Some(f.new_blob.clone())
                        },
                        mode: if deleted {
                            String::new()
                        } else {
                            f.new_mode.clone()
                        },
                    },
                });
                hunk_commit_idx.push(ci);
            } else {
                for rh in &f.hunks {
                    let digest_full = {
                        let mut h = Sha256::new();
                        h.update(b"lines");
                        h.update(cd.sha.as_bytes());
                        h.update(f.path.as_bytes());
                        h.update(format!(
                            "{},{},{},{}",
                            rh.old_start, rh.old_len, rh.new_start, rh.new_len
                        ));
                        for l in &rh.removed {
                            h.update(b"-");
                            h.update(l);
                        }
                        for l in &rh.added {
                            h.update(b"+");
                            h.update(l);
                        }
                        hex(&h.finalize())[..16].to_string()
                    };
                    let mut id = format!("{}:{}#{}", f.path, rh.new_start, &digest_full[..4]);
                    if !used_ids.insert(id.clone()) {
                        id = format!("{}:{}#{}", f.path, rh.new_start, &digest_full[..8]);
                        if !used_ids.insert(id.clone()) {
                            return Err(IsmError::Internal(format!("hunk id collision: {id}")));
                        }
                    }
                    let kind = if rh.old_len == 0 {
                        HunkKind::Add
                    } else if rh.new_len == 0 {
                        HunkKind::Del
                    } else {
                        HunkKind::Mod
                    };
                    let mut patch = format!(
                        "@@ -{},{} +{},{} @@\n",
                        rh.old_start, rh.old_len, rh.new_start, rh.new_len
                    );
                    for l in &rh.removed {
                        patch.push('-');
                        patch.push_str(&String::from_utf8_lossy(l));
                        patch.push('\n');
                    }
                    for l in &rh.added {
                        patch.push('+');
                        patch.push_str(&String::from_utf8_lossy(l));
                        patch.push('\n');
                    }
                    metas.push(HunkMeta {
                        id,
                        commit: cd.sha.clone(),
                        kind,
                        old_range: (rh.old_start, rh.old_len),
                        new_range: (rh.new_start, rh.new_len),
                        lines: LineStat {
                            add: rh.added.len() as u32,
                            del: rh.removed.len() as u32,
                        },
                        patch: None,
                    });
                    patches.push(patch);
                    seq.push(SeqHunk {
                        file: f.path.clone(),
                        commit: cd.sha.clone(),
                        payload: SeqPayload::Lines {
                            old_start: rh.old_start,
                            old_len: rh.old_len,
                            new_start: rh.new_start,
                            new_len: rh.new_len,
                            removed: rh.removed.clone(),
                            added: rh.added.clone(),
                        },
                    });
                    hunk_commit_idx.push(ci);
                }
            }
        }
    }

    // -- run the algebra ------------------------------------------------------
    let alg = Algebra::build(files.clone(), base_files, seq)?;
    let deps_ids: Vec<(String, String)> = alg
        .deps
        .iter()
        .map(|(a, b)| (metas[*a].id.clone(), metas[*b].id.clone()))
        .collect();

    for (i, meta) in metas.iter().enumerate() {
        commit_infos[hunk_commit_idx[i]].hunks.push(meta.id.clone());
    }

    // -- snapshot digest ------------------------------------------------------
    let snapshot_digest = {
        let mut h = Sha256::new();
        h.update(b"ism-snapshot-v1");
        h.update(base.as_bytes());
        h.update(head.as_bytes());
        for m in &metas {
            h.update(m.id.as_bytes());
        }
        for (a, b) in &deps_ids {
            h.update(a.as_bytes());
            h.update(b.as_bytes());
        }
        format!("sha256:{}", hex(&h.finalize()))
    };

    let mut hunks_out = metas;
    if full {
        for (i, m) in hunks_out.iter_mut().enumerate() {
            m.patch = Some(patches[i].clone());
        }
    }

    // head-side entries for the R8 comparison.
    let mut head_entries = Vec::new();
    for path in &files {
        head_entries.push(file_entry(git, &head, path)?);
    }

    Ok(Analysis {
        snapshot: Snapshot {
            snapshot_digest,
            base,
            head,
            branch,
            commits: commit_infos,
            hunks: hunks_out,
            deps: deps_ids,
            anomalies,
        },
        alg: Some(alg),
        patches,
        head_entries,
        trunk,
    })
}
