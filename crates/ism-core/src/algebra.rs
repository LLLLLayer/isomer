//! Line-identity dependency algebra and replay engine.
//!
//! The design contract (design/02) is patch commutation: two hunks are
//! independent iff they can swap order with deterministic offset recalculation.
//! We realize that contract through *line identity* instead of offset math:
//!
//! - A canonical pass applies every hunk in original order to a virtual file
//!   whose lines are identity-tagged objects (base lines or hunk-created lines).
//! - Hunk B depends on hunk A iff B removes a line A created, or B's insertion
//!   point touches a line A created (conservative adjacency, same as
//!   git-absorb's non-commuting "touching" rule).
//! - Replaying any dependency-closed subset then needs no offset arithmetic:
//!   every operation locates its target lines by identity, which the
//!   dependency closure guarantees to exist.
//!
//! This is equivalent to commutation (independent pairs commute freely, the
//! identity lookup performs the offset shift implicitly) but is immune to the
//! classic off-by-one families that plague offset-based implementations.

use crate::error::{IsmError, Result};
use std::collections::BTreeSet;

/// Global line id within one [`Algebra`] arena.
pub type LineId = u32;
/// Index of a hunk in canonical order.
pub type HunkIdx = usize;

const ORIGIN_BASE: isize = -1;

/// One sequential unit in canonical order (per file, commits oldest→newest,
/// hunks top→bottom inside each commit's diff).
#[derive(Debug, Clone)]
pub enum SeqPayload {
    Lines {
        old_start: u32,
        old_len: u32,
        new_start: u32,
        new_len: u32,
        removed: Vec<Vec<u8>>,
        added: Vec<Vec<u8>>,
    },
    /// Whole-file unit: set the path to a blob (None = delete the file).
    WholeFile {
        new_blob: Option<String>,
        mode: String,
    },
}

#[derive(Debug, Clone)]
pub struct SeqHunk {
    pub file: String,
    pub commit: String,
    pub payload: SeqPayload,
}

/// Identity record captured for each hunk during the canonical pass.
#[derive(Debug, Clone, Default)]
pub struct HunkRecord {
    pub removed: Vec<LineId>,
    pub inserted: Vec<LineId>,
    pub pred: Option<LineId>,
    pub succ: Option<LineId>,
}

/// Base state of one file before the stack.
#[derive(Debug, Clone)]
pub struct BaseFile {
    /// None = file does not exist at base.
    pub lines: Option<Vec<Vec<u8>>>,
    pub trailing_newline: bool,
    pub mode: String,
    /// Blob sha at base (whole-file replay anchor); empty when absent.
    pub blob: String,
}

/// Result of a full canonical analysis over all files.
pub struct Algebra {
    pub seq: Vec<SeqHunk>,
    pub records: Vec<HunkRecord>,
    /// Dependency edges (dependent, dependency), deduplicated.
    pub deps: Vec<(HunkIdx, HunkIdx)>,
    /// Line text arena, indexed by LineId.
    texts: Vec<Vec<u8>>,
    /// Which hunk created each line (ORIGIN_BASE for base lines).
    origins: Vec<isize>,
    /// Initial virtual files (line ids) per path, in `files` order.
    base_vfiles: Vec<Vec<LineId>>,
    /// Paths in a stable order; parallel to base_vfiles.
    pub files: Vec<String>,
    pub base_files: Vec<BaseFile>,
}

impl Algebra {
    /// Run the canonical pass. `seq` must be in canonical order and every
    /// referenced file must be present in `files`/`base_files`.
    pub fn build(
        files: Vec<String>,
        base_files: Vec<BaseFile>,
        seq: Vec<SeqHunk>,
    ) -> Result<Algebra> {
        assert_eq!(files.len(), base_files.len());
        let mut texts: Vec<Vec<u8>> = Vec::new();
        let mut origins: Vec<isize> = Vec::new();
        let alloc = |text: Vec<u8>,
                     origin: isize,
                     texts: &mut Vec<Vec<u8>>,
                     origins: &mut Vec<isize>|
         -> LineId {
            let id = texts.len() as LineId;
            texts.push(text);
            origins.push(origin);
            id
        };

        // Materialize base virtual files.
        let mut base_vfiles: Vec<Vec<LineId>> = Vec::new();
        for bf in &base_files {
            let ids = match &bf.lines {
                Some(lines) => lines
                    .iter()
                    .map(|l| alloc(l.clone(), ORIGIN_BASE, &mut texts, &mut origins))
                    .collect(),
                None => Vec::new(),
            };
            base_vfiles.push(ids);
        }

        // Canonical application, tracking per-file whole-file chain state.
        let mut vfiles: Vec<Vec<LineId>> = base_vfiles.clone();
        let mut last_wholefile: Vec<Option<HunkIdx>> = vec![None; files.len()];
        let mut records: Vec<HunkRecord> = Vec::with_capacity(seq.len());
        let mut deps: BTreeSet<(HunkIdx, HunkIdx)> = BTreeSet::new();

        let file_index = |path: &str| -> Result<usize> {
            files
                .iter()
                .position(|p| p == path)
                .ok_or_else(|| IsmError::Internal(format!("unknown file in seq: {path}")))
        };

        for (idx, h) in seq.iter().enumerate() {
            let fi = file_index(&h.file)?;
            let mut rec = HunkRecord::default();
            match &h.payload {
                SeqPayload::WholeFile { .. } => {
                    if let Some(prev) = last_wholefile[fi] {
                        deps.insert((idx, prev));
                    }
                    last_wholefile[fi] = Some(idx);
                }
                SeqPayload::Lines {
                    old_len,
                    new_start,
                    new_len,
                    added,
                    ..
                } => {
                    let vf = &mut vfiles[fi];
                    // Position semantics for -U0 headers (1-based):
                    //   old_len > 0            → removed block sits at ns (nl>0) or ns+1 (nl==0)
                    //   old_len == 0 (insert)  → insert before current line ns
                    let pos_1 = if *old_len == 0 {
                        *new_start
                    } else if *new_len == 0 {
                        *new_start + 1
                    } else {
                        *new_start
                    };
                    let pos = (pos_1.max(1) - 1) as usize; // 0-based splice index
                    if pos > vf.len() || pos + *old_len as usize > vf.len() {
                        return Err(IsmError::Internal(format!(
                            "hunk position out of range in {} (pos {pos}, len {}, file {} lines)",
                            h.file,
                            old_len,
                            vf.len()
                        )));
                    }
                    // Record identity context.
                    rec.pred = if pos > 0 { Some(vf[pos - 1]) } else { None };
                    let end = pos + *old_len as usize;
                    rec.succ = if end < vf.len() { Some(vf[end]) } else { None };
                    rec.removed = vf[pos..end].to_vec();
                    let new_ids: Vec<LineId> = added
                        .iter()
                        .map(|l| alloc(l.clone(), idx as isize, &mut texts, &mut origins))
                        .collect();
                    rec.inserted = new_ids.clone();
                    vf.splice(pos..end, new_ids);

                    // Dependencies: removed lines' creators + touching neighbors.
                    for lid in &rec.removed {
                        let o = origins[*lid as usize];
                        if o >= 0 {
                            deps.insert((idx, o as usize));
                        }
                    }
                    for lid in [rec.pred, rec.succ].into_iter().flatten() {
                        let o = origins[lid as usize];
                        if o >= 0 && o as usize != idx {
                            deps.insert((idx, o as usize));
                        }
                    }
                }
            }
            records.push(rec);
        }

        Ok(Algebra {
            seq,
            records,
            deps: deps.into_iter().collect(),
            texts,
            origins,
            base_vfiles,
            files,
            base_files,
        })
    }

    pub fn line_text(&self, id: LineId) -> &[u8] {
        &self.texts[id as usize]
    }

    pub fn origin(&self, id: LineId) -> Option<HunkIdx> {
        let o = self.origins[id as usize];
        (o >= 0).then_some(o as usize)
    }
}

/// Cumulative replay state over a dependency-closed, growing hunk subset.
pub struct Replay<'a> {
    alg: &'a Algebra,
    vfiles: Vec<Vec<LineId>>,
    /// Whole-file override per file: Some(None) = deleted, Some(Some(blob)).
    wholefile: Vec<Option<(Option<String>, String)>>,
    applied: Vec<bool>,
}

/// State of one file after a replay step.
#[derive(Debug, Clone, PartialEq)]
pub enum FileState {
    /// Line-mode content, byte-exact.
    Content {
        mode: String,
        bytes: Vec<u8>,
    },
    /// Whole-file mode: blob to place at path.
    Blob {
        mode: String,
        blob: String,
    },
    Deleted,
}

impl<'a> Replay<'a> {
    pub fn new(alg: &'a Algebra) -> Replay<'a> {
        Replay {
            alg,
            vfiles: alg.base_vfiles.clone(),
            wholefile: vec![None; alg.files.len()],
            applied: vec![false; alg.seq.len()],
        }
    }

    /// Apply a set of hunks (must be applied in canonical order overall; the
    /// caller passes each node's hunk indices sorted ascending, nodes in plan
    /// order — R6 guarantees dependency closure at every prefix).
    pub fn apply(&mut self, hunk_idxs: &[HunkIdx]) -> Result<()> {
        for &idx in hunk_idxs {
            if self.applied[idx] {
                return Err(IsmError::Internal(format!("hunk {idx} applied twice")));
            }
            self.applied[idx] = true;
            let h = &self.alg.seq[idx];
            let fi = self
                .alg
                .files
                .iter()
                .position(|p| p == &h.file)
                .expect("file known");
            match &h.payload {
                SeqPayload::WholeFile { new_blob, mode } => {
                    self.wholefile[fi] = Some((new_blob.clone(), mode.clone()));
                }
                SeqPayload::Lines { .. } => {
                    let rec = &self.alg.records[idx];
                    let vf = &mut self.vfiles[fi];
                    let pos = if !rec.removed.is_empty() {
                        let first = rec.removed[0];
                        let p = vf.iter().position(|&l| l == first).ok_or_else(|| {
                            IsmError::ReplayFailed(format!(
                                "target line missing for hunk {idx} in {}",
                                h.file
                            ))
                        })?;
                        // Contiguity assertion — guaranteed by construction.
                        for (k, lid) in rec.removed.iter().enumerate() {
                            if vf.get(p + k) != Some(lid) {
                                return Err(IsmError::ReplayFailed(format!(
                                    "removed block not contiguous for hunk {idx} in {}",
                                    h.file
                                )));
                            }
                        }
                        vf.splice(p..p + rec.removed.len(), rec.inserted.iter().copied());
                        continue_marker(); // no-op; keeps structure symmetrical
                        p
                    } else {
                        let p = match rec.pred {
                            Some(pred) => {
                                vf.iter().position(|&l| l == pred).ok_or_else(|| {
                                    IsmError::ReplayFailed(format!(
                                        "anchor line missing for hunk {idx} in {}",
                                        h.file
                                    ))
                                })? + 1
                            }
                            None => 0,
                        };
                        vf.splice(p..p, rec.inserted.iter().copied());
                        p
                    };
                    let _ = pos;
                }
            }
        }
        Ok(())
    }

    /// Current state of a file (by index into `alg.files`).
    pub fn file_state(&self, fi: usize) -> FileState {
        if let Some((blob, mode)) = &self.wholefile[fi] {
            return match blob {
                Some(b) => FileState::Blob {
                    mode: mode.clone(),
                    blob: b.clone(),
                },
                None => FileState::Deleted,
            };
        }
        let bf = &self.alg.base_files[fi];
        let vf = &self.vfiles[fi];
        if vf.is_empty() && bf.lines.is_none() {
            // Never created in the applied subset.
            return FileState::Deleted;
        }
        if vf.is_empty() {
            // Existed at base (or was created) and every line was removed.
            // A deletion diff removes all lines AND marks is_deleted; whether
            // this is "empty file" or "deleted" is decided by the seq metadata,
            // which the analyzer encodes as a whole-file unit for deletions of
            // line-mode files with `deleted file mode` (see analyze).
            return FileState::Content {
                mode: bf.mode.clone(),
                bytes: Vec::new(),
            };
        }
        let mut bytes = Vec::new();
        for (i, lid) in vf.iter().enumerate() {
            bytes.extend_from_slice(self.alg.line_text(*lid));
            let last = i == vf.len() - 1;
            if !last || bf.trailing_newline {
                bytes.push(b'\n');
            }
        }
        FileState::Content {
            mode: bf.mode.clone(),
            bytes,
        }
    }

    /// Files touched by the given hunk set (indices into `alg.files`).
    pub fn touched_files(&self, hunk_idxs: &[HunkIdx]) -> Vec<usize> {
        let mut set = BTreeSet::new();
        for &i in hunk_idxs {
            let f = &self.alg.seq[i].file;
            set.insert(self.alg.files.iter().position(|p| p == f).unwrap());
        }
        set.into_iter().collect()
    }
}

#[inline]
fn continue_marker() {}

#[cfg(test)]
mod tests {
    use super::*;

    fn lines(v: &[&str]) -> Vec<Vec<u8>> {
        v.iter().map(|s| s.as_bytes().to_vec()).collect()
    }

    fn base(v: &[&str]) -> BaseFile {
        BaseFile {
            lines: Some(lines(v)),
            trailing_newline: true,
            mode: "100644".into(),
            blob: String::new(),
        }
    }

    fn lh(os: u32, ol: u32, ns: u32, nl: u32, rm: &[&str], ad: &[&str]) -> SeqPayload {
        SeqPayload::Lines {
            old_start: os,
            old_len: ol,
            new_start: ns,
            new_len: nl,
            removed: lines(rm),
            added: lines(ad),
        }
    }

    fn seq1(payload: SeqPayload) -> SeqHunk {
        SeqHunk {
            file: "f".into(),
            commit: "c".into(),
            payload,
        }
    }

    #[test]
    fn independent_hunks_have_no_edge() {
        // base: a b c d e; h0 replaces b; h1 replaces d (post-h0 coords same len)
        let alg = Algebra::build(
            vec!["f".into()],
            vec![base(&["a", "b", "c", "d", "e"])],
            vec![
                seq1(lh(2, 1, 2, 1, &["b"], &["B"])),
                seq1(lh(4, 1, 4, 1, &["d"], &["D"])),
            ],
        )
        .unwrap();
        assert!(alg.deps.is_empty());
    }

    #[test]
    fn removing_created_line_is_dependency() {
        // h0 inserts X after a; h1 modifies X.
        let alg = Algebra::build(
            vec!["f".into()],
            vec![base(&["a", "b"])],
            vec![
                seq1(lh(1, 0, 2, 1, &[], &["X"])),
                seq1(lh(2, 1, 2, 1, &["X"], &["Y"])),
            ],
        )
        .unwrap();
        assert_eq!(alg.deps, vec![(1, 0)]);
    }

    #[test]
    fn touching_insertion_is_dependency() {
        // h0 inserts X after a (X at line 2); h1 inserts Z right after X.
        let alg = Algebra::build(
            vec!["f".into()],
            vec![base(&["a", "b"])],
            vec![
                seq1(lh(1, 0, 2, 1, &[], &["X"])),
                seq1(lh(2, 0, 3, 1, &[], &["Z"])), // pred = X
            ],
        )
        .unwrap();
        assert_eq!(alg.deps, vec![(1, 0)]);
    }

    #[test]
    fn subset_replay_matches_by_identity() {
        // base: a b c. h0 replaces a→A. h1 appends z at end. Independent.
        let alg = Algebra::build(
            vec!["f".into()],
            vec![base(&["a", "b", "c"])],
            vec![
                seq1(lh(1, 1, 1, 1, &["a"], &["A"])),
                seq1(lh(3, 0, 4, 1, &[], &["z"])),
            ],
        )
        .unwrap();
        assert!(alg.deps.is_empty());
        // Apply ONLY h1 (reordered before h0): must yield a b c z.
        let mut r = Replay::new(&alg);
        r.apply(&[1]).unwrap();
        match r.file_state(0) {
            FileState::Content { bytes, .. } => assert_eq!(bytes, b"a\nb\nc\nz\n"),
            _ => panic!("expected content"),
        }
        // Then h0: A b c z — full set equals canonical final.
        r.apply(&[0]).unwrap();
        match r.file_state(0) {
            FileState::Content { bytes, .. } => assert_eq!(bytes, b"A\nb\nc\nz\n"),
            _ => panic!("expected content"),
        }
    }

    #[test]
    fn randomized_full_replay_equals_direct_edit() {
        // Pseudo-random edit scripts; replaying ALL hunks must reproduce the
        // directly-edited file byte for byte. Exercises identity bookkeeping.
        let mut rng: u64 = 0x5eed;
        let mut next = move |m: u64| {
            rng = rng
                .wrapping_mul(6364136223846793005)
                .wrapping_add(1442695040888963407);
            (rng >> 33) % m
        };
        for case in 0..50 {
            let mut file: Vec<String> = (0..10).map(|i| format!("l{i}")).collect();
            let mut seq: Vec<SeqHunk> = Vec::new();
            let base_lines: Vec<&str> =
                vec!["l0", "l1", "l2", "l3", "l4", "l5", "l6", "l7", "l8", "l9"];
            for step in 0..8 {
                let op = next(3);
                let n = file.len() as u64;
                match op {
                    0 => {
                        // insert one line after position k (0..=n)
                        let k = next(n + 1) as u32; // 0 = BOF
                        let text = format!("c{case}s{step}");
                        seq.push(seq1(lh(0, 0, k + 1, 1, &[], &[&text])));
                        // emulate: header for pure insert uses old_start=k (unused) and
                        // new_start = position where line lands = k+1
                        file.insert(k as usize, text);
                    }
                    1 if n > 0 => {
                        // delete one line at position k (1-based)
                        let k = next(n) as u32 + 1;
                        let rm = file.remove((k - 1) as usize);
                        seq.push(seq1(lh(0, 1, k, 0, &[&rm], &[])));
                        // header: nl==0 → position = ns+1; we set ns = k-1
                        if let Some(SeqHunk {
                            payload: SeqPayload::Lines { new_start, .. },
                            ..
                        }) = seq.last_mut()
                        {
                            *new_start = k - 1;
                        }
                    }
                    _ if n > 0 => {
                        // replace one line at position k
                        let k = next(n) as u32 + 1;
                        let rm = file[(k - 1) as usize].clone();
                        let text = format!("r{case}s{step}");
                        seq.push(seq1(lh(0, 1, k, 1, &[&rm], &[&text])));
                        file[(k - 1) as usize] = text;
                    }
                    _ => {}
                }
            }
            let alg = Algebra::build(vec!["f".into()], vec![base(&base_lines)], seq).unwrap();
            let mut r = Replay::new(&alg);
            let all: Vec<usize> = (0..alg.seq.len()).collect();
            r.apply(&all).unwrap();
            let expect = file.join("\n") + "\n";
            match r.file_state(0) {
                FileState::Content { bytes, .. } => {
                    assert_eq!(String::from_utf8_lossy(&bytes), expect, "case {case}")
                }
                _ => panic!("expected content"),
            }
        }
    }
}
