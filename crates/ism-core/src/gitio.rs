//! Thin subprocess wrapper around git plumbing.
//!
//! Design rules (see design/05-engine.md):
//! - plumbing only, never porcelain: no `rebase`, no `cherry-pick`, no `checkout`;
//! - all writes are either invisible object-db inserts or CAS `update-ref` flips;
//! - the working tree and the real index are never touched (temp index files only).

use crate::error::{IsmError, Result};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

#[derive(Debug, Clone)]
pub struct Git {
    /// Repository work-tree root (absolute).
    pub root: PathBuf,
}

impl Git {
    /// Locate the repository containing `dir`.
    pub fn discover(dir: &Path) -> Result<Git> {
        let out = Command::new("git")
            .arg("-C")
            .arg(dir)
            .args(["rev-parse", "--show-toplevel"])
            .output()?;
        if !out.status.success() {
            return Err(IsmError::Precondition(format!(
                "not a git repository: {}",
                dir.display()
            )));
        }
        let root = PathBuf::from(String::from_utf8_lossy(&out.stdout).trim().to_string());
        Ok(Git { root })
    }

    fn command(&self) -> Command {
        let mut c = Command::new("git");
        c.arg("-C").arg(&self.root);
        c
    }

    /// Run git, expect success, return raw stdout bytes.
    pub fn run(&self, args: &[&str]) -> Result<Vec<u8>> {
        self.run_with(args, None, &[])
    }

    /// Run git with optional stdin bytes and extra environment variables.
    pub fn run_with(
        &self,
        args: &[&str],
        stdin: Option<&[u8]>,
        envs: &[(&str, &str)],
    ) -> Result<Vec<u8>> {
        let mut cmd = self.command();
        cmd.args(args);
        for (k, v) in envs {
            cmd.env(k, v);
        }
        cmd.stdin(if stdin.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        });
        cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
        let mut child = cmd.spawn()?;
        if let Some(bytes) = stdin {
            use std::io::Write;
            child
                .stdin
                .as_mut()
                .expect("stdin piped")
                .write_all(bytes)?;
        }
        let out = child.wait_with_output()?;
        if !out.status.success() {
            return Err(IsmError::Git(format!(
                "git {} failed: {}",
                args.join(" "),
                String::from_utf8_lossy(&out.stderr).trim()
            )));
        }
        Ok(out.stdout)
    }

    /// Run git, return trimmed stdout as String.
    pub fn out(&self, args: &[&str]) -> Result<String> {
        Ok(String::from_utf8_lossy(&self.run(args)?).trim().to_string())
    }

    /// Run git and only report success/failure (no error on failure).
    pub fn ok(&self, args: &[&str]) -> bool {
        self.command()
            .args(args)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    }

    // -- read-side helpers ---------------------------------------------------

    pub fn rev_parse(&self, rev: &str) -> Result<String> {
        self.out(&["rev-parse", "--verify", "--quiet", rev])
            .map_err(|_| IsmError::UnknownRef(format!("revision not found: {rev}")))
    }

    /// Current branch short name, or None when HEAD is detached.
    pub fn current_branch(&self) -> Result<Option<String>> {
        let out = self
            .command()
            .args(["symbolic-ref", "--short", "-q", "HEAD"])
            .output()?;
        if out.status.success() {
            Ok(Some(
                String::from_utf8_lossy(&out.stdout).trim().to_string(),
            ))
        } else {
            Ok(None)
        }
    }

    pub fn merge_base(&self, a: &str, b: &str) -> Result<String> {
        self.out(&["merge-base", a, b])
    }

    /// Commits in `base..head`, oldest first, with parent counts.
    pub fn rev_list_with_parents(&self, base: &str, head: &str) -> Result<Vec<(String, usize)>> {
        let range = format!("{base}..{head}");
        let text = self.out(&["rev-list", "--reverse", "--parents", &range])?;
        let mut v = Vec::new();
        for line in text.lines().filter(|l| !l.is_empty()) {
            let mut it = line.split_whitespace();
            let sha = it.next().unwrap_or_default().to_string();
            let parents = it.count();
            v.push((sha, parents));
        }
        Ok(v)
    }

    /// Zero-context patch between a commit and its first parent (or empty tree).
    pub fn diff_u0(&self, parent: &str, child: &str) -> Result<Vec<u8>> {
        self.run(&[
            "-c",
            "core.quotepath=off",
            "diff-tree",
            "-r",
            "-p",
            "-U0",
            "--no-renames",
            "--no-color",
            "--full-index",
            parent,
            child,
        ])
    }

    pub fn commit_message(&self, sha: &str) -> Result<String> {
        Ok(String::from_utf8_lossy(&self.run(&["show", "-s", "--format=%B", sha])?).to_string())
    }

    pub fn commit_title(&self, sha: &str) -> Result<String> {
        self.out(&["show", "-s", "--format=%s", sha])
    }

    /// (author name, author email, author date in raw format)
    pub fn commit_author(&self, sha: &str) -> Result<(String, String, String)> {
        let raw = self.out(&[
            "show",
            "-s",
            "--format=%an%x00%ae%x00%ad",
            "--date=raw",
            sha,
        ])?;
        let mut it = raw.split('\u{0}');
        Ok((
            it.next().unwrap_or_default().to_string(),
            it.next().unwrap_or_default().to_string(),
            it.next().unwrap_or_default().to_string(),
        ))
    }

    pub fn tree_of(&self, rev: &str) -> Result<String> {
        self.rev_parse(&format!("{rev}^{{tree}}"))
    }

    /// Read a blob at `rev:path`. Returns None when the path is absent.
    pub fn blob_at(&self, rev: &str, path: &str) -> Result<Option<Vec<u8>>> {
        let spec = format!("{rev}:{path}");
        let out = self.command().args(["cat-file", "blob", &spec]).output()?;
        if out.status.success() {
            Ok(Some(out.stdout))
        } else {
            Ok(None)
        }
    }

    pub fn config(&self, key: &str) -> Option<String> {
        self.command()
            .args(["config", "--get", key])
            .output()
            .ok()
            .filter(|o| o.status.success())
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
    }

    // -- write-side plumbing (object db + CAS ref flips only) -----------------

    pub fn hash_object(&self, content: &[u8]) -> Result<String> {
        Ok(String::from_utf8_lossy(&self.run_with(
            &["hash-object", "-w", "--stdin"],
            Some(content),
            &[],
        )?)
        .trim()
        .to_string())
    }

    pub fn mktree(&self, lines: &str) -> Result<String> {
        Ok(
            String::from_utf8_lossy(&self.run_with(&["mktree"], Some(lines.as_bytes()), &[])?)
                .trim()
                .to_string(),
        )
    }

    /// Build a tree by layering file changes on a parent tree via a temp index.
    /// `changes`: (mode, blob_sha, path); mode "0" removes the path.
    pub fn build_tree(
        &self,
        parent_tree: &str,
        changes: &[(String, String, String)],
    ) -> Result<String> {
        // A fresh path inside a temp dir: git rejects an existing empty file
        // as an index, so the file must not exist before read-tree creates it.
        let tmp = tempfile::tempdir()?;
        let index_path = tmp.path().join("index").to_string_lossy().to_string();
        let env: &[(&str, &str)] = &[("GIT_INDEX_FILE", &index_path)];
        self.run_with(&["read-tree", parent_tree], None, env)?;
        let mut info = String::new();
        for (mode, sha, path) in changes {
            if mode == "0" {
                info.push_str(&format!("0 {} 0\t{}\n", "0".repeat(40), path));
            } else {
                info.push_str(&format!("{mode} {sha} 0\t{path}\n"));
            }
        }
        self.run_with(
            &["update-index", "--index-info"],
            Some(info.as_bytes()),
            env,
        )?;
        Ok(
            String::from_utf8_lossy(&self.run_with(&["write-tree"], None, env)?)
                .trim()
                .to_string(),
        )
    }

    /// Create a commit object. `author`: (name, email, raw date) to preserve.
    /// `sign` adds `-S` (honoring commit.gpgsign).
    pub fn commit_tree(
        &self,
        tree: &str,
        parents: &[&str],
        message: &str,
        author: Option<(&str, &str, &str)>,
        sign: bool,
    ) -> Result<String> {
        let mut args: Vec<String> = vec!["commit-tree".into(), tree.into()];
        for p in parents {
            args.push("-p".into());
            args.push((*p).into());
        }
        if sign {
            args.push("-S".into());
        }
        // Message via stdin: -m puts it in argv, which dies on ARG_MAX for
        // large bodies — violating "check passed => apply succeeds".
        let argrefs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        let mut envs: Vec<(&str, &str)> = Vec::new();
        if let Some((name, email, date)) = author {
            envs.push(("GIT_AUTHOR_NAME", name));
            envs.push(("GIT_AUTHOR_EMAIL", email));
            envs.push(("GIT_AUTHOR_DATE", date));
        }
        let out = self
            .run_with(&argrefs, Some(message.as_bytes()), &envs)
            .map_err(|e| {
                if sign {
                    IsmError::SigningFailed(e.to_string())
                } else {
                    e
                }
            })?;
        Ok(String::from_utf8_lossy(&out).trim().to_string())
    }

    /// Compare-and-swap ref update: fails if `refname` is not at `old`.
    /// `old = None` asserts the ref does not exist yet.
    pub fn update_ref_cas(&self, refname: &str, new: &str, old: Option<&str>) -> Result<()> {
        let zero = "0".repeat(40);
        let old_val = old.unwrap_or(&zero);
        self.run(&["update-ref", refname, new, old_val])?;
        Ok(())
    }

    pub fn ref_exists(&self, refname: &str) -> bool {
        self.ok(&["show-ref", "--verify", "--quiet", refname])
    }

    /// ls-tree entries of `rev` limited to one directory level under `path`.
    pub fn ls_tree(&self, rev: &str, path: &str) -> Result<Vec<(String, String, String)>> {
        let spec = format!("{rev}:{path}");
        let out = self.command().args(["ls-tree", &spec]).output()?;
        if !out.status.success() {
            return Ok(Vec::new());
        }
        let mut v = Vec::new();
        for line in String::from_utf8_lossy(&out.stdout).lines() {
            // "<mode> <type> <sha>\t<name>"
            if let Some((meta, name)) = line.split_once('\t') {
                let parts: Vec<&str> = meta.split_whitespace().collect();
                if parts.len() == 3 {
                    v.push((parts[0].to_string(), parts[2].to_string(), name.to_string()));
                }
            }
        }
        Ok(v)
    }

    /// Upstream ref of a branch, e.g. "origin/feat", if configured.
    pub fn upstream_of(&self, branch: &str) -> Option<String> {
        self.command()
            .args([
                "rev-parse",
                "--abbrev-ref",
                &format!("{branch}@{{upstream}}"),
            ])
            .output()
            .ok()
            .filter(|o| o.status.success())
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
    }
}

/// The well-known empty tree object id (SHA-1 repositories).
pub const EMPTY_TREE: &str = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
