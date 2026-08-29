//! Unified-diff (-U0) parser and commit-message trailer utilities.
//!
//! Zero-context hunks are the atoms of reorganization (design D14). Files that
//! cannot be safely handled at line granularity (binary content, mode changes,
//! missing trailing newline) degrade to whole-file units — conservative and
//! always correct.

use crate::error::{IsmError, Result};

/// One file's worth of a commit diff, as parsed from `diff-tree -p -U0`.
#[derive(Debug, Clone)]
pub struct FileDiff {
    pub path: String,
    pub old_blob: String,
    pub new_blob: String,
    /// Mode of the file after this commit ("000000" when deleted).
    pub new_mode: String,
    pub old_mode: String,
    pub is_new: bool,
    pub is_deleted: bool,
    /// True when this file must be treated as a whole-file unit.
    pub degraded: bool,
    pub hunks: Vec<RawHunk>,
}

/// A zero-context hunk. Ranges follow unified-diff header semantics.
#[derive(Debug, Clone)]
pub struct RawHunk {
    pub old_start: u32,
    pub old_len: u32,
    pub new_start: u32,
    pub new_len: u32,
    pub removed: Vec<Vec<u8>>,
    pub added: Vec<Vec<u8>>,
}

fn parse_range(s: &str) -> Option<(u32, u32)> {
    // "start[,len]" — len defaults to 1
    match s.split_once(',') {
        Some((a, b)) => Some((a.parse().ok()?, b.parse().ok()?)),
        None => Some((s.parse().ok()?, 1)),
    }
}

/// Split raw bytes into lines WITHOUT trailing newlines.
fn split_lines(bytes: &[u8]) -> Vec<&[u8]> {
    let mut v = Vec::new();
    let mut start = 0;
    for (i, b) in bytes.iter().enumerate() {
        if *b == b'\n' {
            v.push(&bytes[start..i]);
            start = i + 1;
        }
    }
    if start < bytes.len() {
        v.push(&bytes[start..]);
    }
    v
}

/// Parse `git diff-tree -r -p -U0 --no-renames --full-index` output.
pub fn parse_diff(raw: &[u8]) -> Result<Vec<FileDiff>> {
    let lines = split_lines(raw);
    let mut files: Vec<FileDiff> = Vec::new();
    let mut cur: Option<FileDiff> = None;
    let mut i = 0;

    while i < lines.len() {
        let line = lines[i];
        let text = String::from_utf8_lossy(line);

        if text.starts_with("diff --git ") {
            if let Some(f) = cur.take() {
                files.push(f);
            }
            // Path from `diff --git a/<p> b/<p>` — take everything after " b/".
            let path = text
                .rfind(" b/")
                .map(|idx| text[idx + 3..].to_string())
                .ok_or_else(|| IsmError::Internal(format!("unparsable diff header: {text}")))?;
            cur = Some(FileDiff {
                path,
                old_blob: String::new(),
                new_blob: String::new(),
                new_mode: String::new(),
                old_mode: String::new(),
                is_new: false,
                is_deleted: false,
                degraded: false,
                hunks: Vec::new(),
            });
            i += 1;
            continue;
        }

        let Some(f) = cur.as_mut() else {
            i += 1;
            continue;
        };

        if let Some(rest) = text.strip_prefix("index ") {
            // "index <old>..<new>[ <mode>]"
            let mut parts = rest.split_whitespace();
            if let Some(pair) = parts.next() {
                if let Some((o, n)) = pair.split_once("..") {
                    f.old_blob = o.to_string();
                    f.new_blob = n.to_string();
                }
            }
            if let Some(mode) = parts.next() {
                f.new_mode = mode.to_string();
                f.old_mode = mode.to_string();
            }
        } else if let Some(m) = text.strip_prefix("new file mode ") {
            f.is_new = true;
            f.new_mode = m.trim().to_string();
            f.old_mode = "000000".into();
        } else if let Some(m) = text.strip_prefix("deleted file mode ") {
            f.is_deleted = true;
            f.old_mode = m.trim().to_string();
            f.new_mode = "000000".into();
        } else if let Some(m) = text.strip_prefix("old mode ") {
            f.old_mode = m.trim().to_string();
            f.degraded = true; // mode change → whole-file unit
        } else if let Some(m) = text.strip_prefix("new mode ") {
            f.new_mode = m.trim().to_string();
            f.degraded = true;
        } else if text.starts_with("Binary files ") || text.starts_with("GIT binary patch") {
            f.degraded = true;
        } else if text.starts_with("@@ ") {
            // "@@ -a[,b] +c[,d] @@ ..."
            let header = text
                .trim_start_matches("@@ ")
                .split(" @@")
                .next()
                .unwrap_or("")
                .to_string();
            let mut parts = header.split_whitespace();
            let old = parts
                .next()
                .and_then(|s| s.strip_prefix('-'))
                .and_then(parse_range);
            let new = parts
                .next()
                .and_then(|s| s.strip_prefix('+'))
                .and_then(parse_range);
            let (Some((os, ol)), Some((ns, nl))) = (old, new) else {
                return Err(IsmError::Internal(format!("bad hunk header: {text}")));
            };
            let mut removed = Vec::new();
            let mut added = Vec::new();
            i += 1;
            while i < lines.len() {
                let l = lines[i];
                if l.first() == Some(&b'-') && !l.starts_with(b"--- ") {
                    removed.push(l[1..].to_vec());
                } else if l.first() == Some(&b'+') && !l.starts_with(b"+++ ") {
                    added.push(l[1..].to_vec());
                } else if l.starts_with(b"\\ No newline") {
                    // Missing trailing newline anywhere in the hunk → degrade
                    // the file; whole-file replay is byte-exact by construction.
                    f.degraded = true;
                } else {
                    break;
                }
                i += 1;
            }
            debug_assert!(removed.len() as u32 == ol || f.degraded);
            debug_assert!(added.len() as u32 == nl || f.degraded);
            f.hunks.push(RawHunk {
                old_start: os,
                old_len: ol,
                new_start: ns,
                new_len: nl,
                removed,
                added,
            });
            continue;
        }
        i += 1;
    }
    if let Some(f) = cur.take() {
        files.push(f);
    }
    Ok(files)
}

/// Extract all `Isomer-Change:` trailer values from a commit message.
pub fn parse_change_trailers(message: &str) -> Vec<String> {
    let key = format!("{}:", crate::model::TRAILER_KEY);
    message
        .lines()
        .filter_map(|l| l.strip_prefix(&key))
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_u0_hunks() {
        let diff = b"diff --git a/f.txt b/f.txt\n\
index 1111111111111111111111111111111111111111..2222222222222222222222222222222222222222 100644\n\
--- a/f.txt\n\
+++ b/f.txt\n\
@@ -2,1 +2,2 @@\n\
-old\n\
+new1\n\
+new2\n\
@@ -5,0 +7,1 @@\n\
+tail\n";
        let files = parse_diff(diff).unwrap();
        assert_eq!(files.len(), 1);
        let f = &files[0];
        assert_eq!(f.path, "f.txt");
        assert!(!f.degraded);
        assert_eq!(f.hunks.len(), 2);
        assert_eq!(f.hunks[0].removed, vec![b"old".to_vec()]);
        assert_eq!(f.hunks[0].added.len(), 2);
        assert_eq!((f.hunks[1].old_start, f.hunks[1].old_len), (5, 0));
    }

    #[test]
    fn degrades_on_no_newline_and_binary() {
        let diff = b"diff --git a/x b/x\n\
index 1111111111111111111111111111111111111111..2222222222222222222222222222222222222222 100644\n\
--- a/x\n\
+++ b/x\n\
@@ -1,1 +1,1 @@\n\
-a\n\
+b\n\
\\ No newline at end of file\n\
diff --git a/img.png b/img.png\n\
index 3333333333333333333333333333333333333333..4444444444444444444444444444444444444444 100644\n\
Binary files a/img.png and b/img.png differ\n";
        let files = parse_diff(diff).unwrap();
        assert_eq!(files.len(), 2);
        assert!(files[0].degraded);
        assert!(files[1].degraded);
    }

    #[test]
    fn new_and_deleted_files() {
        let diff = b"diff --git a/n.txt b/n.txt\n\
new file mode 100644\n\
index 0000000000000000000000000000000000000000..2222222222222222222222222222222222222222\n\
--- /dev/null\n\
+++ b/n.txt\n\
@@ -0,0 +1,1 @@\n\
+hello\n\
diff --git a/d.txt b/d.txt\n\
deleted file mode 100644\n\
index 3333333333333333333333333333333333333333..0000000000000000000000000000000000000000\n\
--- a/d.txt\n\
+++ /dev/null\n\
@@ -1,1 +0,0 @@\n\
-bye\n";
        let files = parse_diff(diff).unwrap();
        assert!(files[0].is_new);
        assert!(files[1].is_deleted);
        assert_eq!(files[1].new_mode, "000000");
    }

    #[test]
    fn trailers() {
        let msg = "title\n\nbody\n\nIsomer-Change: i-abcdefgh\n";
        assert_eq!(parse_change_trailers(msg), vec!["i-abcdefgh"]);
    }
}
