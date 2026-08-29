//! End-to-end tests: real temp repositories, the real `ism` binary.
//!
//! The core loop under test is the full contract:
//!   inspect → plan → check → apply → verify → undo → verify
//! plus every documented error code on its dedicated path.

use serde_json::Value;
use std::path::{Path, PathBuf};
use std::process::Command;

struct Repo {
    dir: tempfile::TempDir,
    /// Plans live OUTSIDE the worktree so they never dirty `git status`.
    aux: tempfile::TempDir,
}

impl Repo {
    fn new() -> Repo {
        let dir = tempfile::tempdir().unwrap();
        let aux = tempfile::tempdir().unwrap();
        let r = Repo { dir, aux };
        r.git(&["init", "-q", "-b", "main"]);
        r.git(&["config", "user.name", "Test User"]);
        r.git(&["config", "user.email", "test@example.com"]);
        r.git(&["config", "commit.gpgsign", "false"]);
        r
    }

    fn path(&self) -> &Path {
        self.dir.path()
    }

    fn git(&self, args: &[&str]) -> String {
        let out = Command::new("git")
            .arg("-C")
            .arg(self.path())
            .args(args)
            .output()
            .unwrap();
        assert!(
            out.status.success(),
            "git {args:?} failed: {}",
            String::from_utf8_lossy(&out.stderr)
        );
        String::from_utf8_lossy(&out.stdout).trim().to_string()
    }

    fn write(&self, path: &str, content: &str) {
        let p = self.path().join(path);
        if let Some(parent) = p.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::write(p, content).unwrap();
    }

    fn commit_all(&self, message: &str) -> String {
        self.git(&["add", "-A"]);
        self.git(&["commit", "-q", "-m", message]);
        self.git(&["rev-parse", "HEAD"])
    }

    /// Run `ism`; returns (exit code, parsed stdout JSON if any, raw stdout).
    fn ism(&self, args: &[&str]) -> (i32, Option<Value>, String) {
        let out = Command::new(env!("CARGO_BIN_EXE_ism"))
            .current_dir(self.path())
            .args(args)
            .output()
            .unwrap();
        let stdout = String::from_utf8_lossy(&out.stdout).to_string();
        let json = serde_json::from_str(&stdout).ok();
        (out.status.code().unwrap_or(-1), json, stdout)
    }

    fn write_plan(&self, plan: &Value) -> PathBuf {
        let p = self.aux.path().join("plan.json");
        std::fs::write(&p, serde_json::to_vec_pretty(plan).unwrap()).unwrap();
        p
    }
}

/// Build the standard messy fixture used by several tests:
/// base on main, then on `feat`:
///   C1 "wip: mixed" — app.py b→B, new service.py, util.py u2→U2
///   C2 "fix bits"   — service.py line2 tweak (hard dep on C1), app.py d→D
fn messy_repo() -> Repo {
    let r = Repo::new();
    r.write("app.py", "a\nb\nc\nd\ne\n");
    r.write("util.py", "u1\nu2\nu3\n");
    r.commit_all("base");
    r.git(&["checkout", "-q", "-b", "feat"]);
    r.write("app.py", "a\nB\nc\nd\ne\n");
    r.write("service.py", "s1\ns2\ns3\n");
    r.write("util.py", "u1\nU2\nu3\n");
    r.commit_all("wip: mixed");
    r.write("service.py", "s1\nS2!\ns3\n");
    r.write("app.py", "a\nB\nc\nD\ne\n");
    r.commit_all("fix bits");
    r
}

fn inspect(r: &Repo) -> Value {
    let (code, json, raw) = r.ism(&["inspect"]);
    assert_eq!(code, 0, "inspect failed: {raw}");
    json.unwrap()
}

/// Find hunk ids in a snapshot by file path (in canonical order).
fn hunks_of(snap: &Value, path: &str) -> Vec<String> {
    snap["hunks"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|h| h["id"].as_str().unwrap().starts_with(&format!("{path}:")))
        .map(|h| h["id"].as_str().unwrap().to_string())
        .collect()
}

#[test]
fn inspect_reports_hunks_deps_anomalies() {
    let r = messy_repo();
    let snap = inspect(&r);
    assert_eq!(snap["branch"], "feat");
    assert_eq!(snap["commits"].as_array().unwrap().len(), 2);
    // 3 hunks in C1 + 2 in C2.
    assert_eq!(snap["hunks"].as_array().unwrap().len(), 5);
    // Exactly one hard dependency: C2's service tweak on C1's service creation.
    let deps = snap["deps"].as_array().unwrap();
    assert_eq!(deps.len(), 1, "deps: {deps:?}");
    assert!(deps[0][0].as_str().unwrap().starts_with("service.py:"));
    assert!(deps[0][1].as_str().unwrap().starts_with("service.py:"));
    // Both commits are untracked (no trailers yet).
    let anomalies = snap["anomalies"].as_array().unwrap();
    assert_eq!(
        anomalies
            .iter()
            .filter(|a| a["kind"] == "untracked")
            .count(),
        2
    );
}

#[test]
fn full_loop_apply_verify_undo() {
    let r = messy_repo();
    let head_before = r.git(&["rev-parse", "HEAD"]);
    let tree_before = r.git(&["rev-parse", "HEAD^{tree}"]);
    let snap = inspect(&r);

    let app = hunks_of(&snap, "app.py");
    let service = hunks_of(&snap, "service.py");
    let util = hunks_of(&snap, "util.py");
    assert_eq!((app.len(), service.len(), util.len()), (2, 2, 1));

    let plan = serde_json::json!({
        "version": 1,
        "snapshot_digest": snap["snapshot_digest"],
        "nodes": [
            {"name": "util-fix", "from": util, "summary": "Fix util label"},
            {"name": "app-changes", "from": app, "summary": "Adjust app flow", "deps": ["util-fix"]},
            {"name": "service", "from": service, "summary": "Add service module",
             "body": "Extracted as an independent reviewable unit."}
        ],
        "order": ["util-fix", "app-changes", "service"]
    });
    let plan_path = r.write_plan(&plan);

    // check: promise established.
    let (code, json, raw) = r.ism(&["check", plan_path.to_str().unwrap()]);
    assert_eq!(code, 0, "check failed: {raw}");
    assert_eq!(json.unwrap()["ok"], true);

    // Dirty the worktree to prove apply never touches it.
    r.write("scratch.txt", "uncommitted\n");

    let (code, json, raw) = r.ism(&["apply", plan_path.to_str().unwrap()]);
    assert_eq!(code, 0, "apply failed: {raw}");
    let outcome = json.unwrap();
    let changes = outcome["changes"].as_array().unwrap();
    assert_eq!(changes.len(), 3);
    for c in changes {
        assert!(c["id"].as_str().unwrap().starts_with("i-"));
    }

    // The branch actually moved — otherwise tree equality is vacuous
    // (lesson from a false-pass during verification: a rejected plan leaves
    // HEAD in place and the tree check "passes" trivially).
    let head_after = r.git(&["rev-parse", "HEAD"]);
    assert_ne!(head_after, head_before, "apply did not move HEAD");
    assert_eq!(outcome["new_head"].as_str().unwrap(), head_after);

    // Tree invariance, for real.
    let tree_after = r.git(&["rev-parse", "HEAD^{tree}"]);
    assert_eq!(tree_before, tree_after);
    // Worktree untouched: scratch file still there, status shows only it.
    let status = r.git(&["status", "--porcelain"]);
    assert_eq!(status, "?? scratch.txt");
    // Three commits, correct order, trailers present.
    let log = r.git(&["log", "--format=%s", "main..HEAD"]);
    assert_eq!(log, "Add service module\nAdjust app flow\nFix util label");
    let body = r.git(&["log", "--format=%B", "-1", "HEAD"]);
    assert!(body.contains("Isomer-Change: i-"), "body: {body}");

    // verify: live proof.
    let (code, json, _) = r.ism(&["verify"]);
    assert_eq!(code, 0);
    let v = json.unwrap();
    assert_eq!(v["ok"], true);
    assert_eq!(v["live"], true);

    // Re-inspect: everything tracked now.
    let snap2 = inspect(&r);
    assert_eq!(
        snap2["anomalies"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|a| a["kind"] == "untracked")
            .count(),
        0
    );

    // undo: back to the original head, op log appended.
    let (code, json, raw) = r.ism(&["undo"]);
    assert_eq!(code, 0, "undo failed: {raw}");
    assert_eq!(json.unwrap()["restored_head"], head_before.as_str());
    assert_eq!(r.git(&["rev-parse", "HEAD"]), head_before);
    // verify after undo still proves invariance (swapped trees, equal).
    let (code, json, _) = r.ism(&["verify"]);
    assert_eq!(code, 0);
    assert_eq!(json.unwrap()["ok"], true);
}

#[test]
fn pick_reorders_whole_commits_and_preserves_ids() {
    let r = Repo::new();
    r.write("one.txt", "1\n");
    r.commit_all("base");
    r.git(&["checkout", "-q", "-b", "feat"]);
    r.write("two.txt", "2\n");
    let c1 = r.commit_all("add two");
    r.write("three.txt", "3\n");
    let c2 = r.commit_all("add three");

    // First apply: name the two changes.
    let snap = inspect(&r);
    let plan = serde_json::json!({
        "version": 1,
        "snapshot_digest": snap["snapshot_digest"],
        "nodes": [
            {"name": "two", "from": format!("commit:{c1}"), "summary": "Add two"},
            {"name": "three", "from": format!("commit:{c2}"), "summary": "Add three"}
        ],
        "order": ["two", "three"]
    });
    let p = r.write_plan(&plan);
    let (code, json, raw) = r.ism(&["apply", p.to_str().unwrap()]);
    assert_eq!(code, 0, "apply1 failed: {raw}");
    let ids: Vec<String> = json.unwrap()["changes"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| c["id"].as_str().unwrap().to_string())
        .collect();

    // Second apply: pure pick — swap the order, reference by change id.
    let snap2 = inspect(&r);
    let commits2 = snap2["commits"].as_array().unwrap();
    let plan2 = serde_json::json!({
        "version": 1,
        "snapshot_digest": snap2["snapshot_digest"],
        "nodes": [
            {"change": ids[1], "from": format!("commit:{}", commits2[1]["sha"].as_str().unwrap()), "summary": "Add three"},
            {"change": ids[0], "from": format!("commit:{}", commits2[0]["sha"].as_str().unwrap()), "summary": "Add two"}
        ],
        "order": [ids[1].clone(), ids[0].clone()]
    });
    let p2 = r.write_plan(&plan2);
    let (code, json, raw) = r.ism(&["apply", p2.to_str().unwrap()]);
    assert_eq!(code, 0, "apply2 failed: {raw}");
    let out2 = json.unwrap();
    // Identity preserved across the swap.
    let ids2: Vec<String> = out2["changes"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| c["id"].as_str().unwrap().to_string())
        .collect();
    assert_eq!(ids2, vec![ids[1].clone(), ids[0].clone()]);
    let log = r.git(&["log", "--format=%s", "main..HEAD"]);
    assert_eq!(log, "Add two\nAdd three"); // newest first: two is now on top
                                           // Original author preserved on single-source nodes.
    let author = r.git(&["log", "--format=%an", "-1", "HEAD"]);
    assert_eq!(author, "Test User");
}

#[test]
fn error_paths_have_stable_codes() {
    let r = messy_repo();
    let snap = inspect(&r);
    let app = hunks_of(&snap, "app.py");
    let service = hunks_of(&snap, "service.py");
    let util = hunks_of(&snap, "util.py");

    // E020: forget the util hunk.
    let plan = serde_json::json!({
        "version": 1, "snapshot_digest": snap["snapshot_digest"],
        "nodes": [
            {"name": "a", "from": app, "summary": "app"},
            {"name": "s", "from": service, "summary": "service"}
        ],
        "order": ["a", "s"]
    });
    let p = r.write_plan(&plan);
    let (code, json, _) = r.ism(&["check", p.to_str().unwrap()]);
    assert_eq!(code, 1);
    assert_eq!(json.unwrap()["errors"][0]["code"], "E020");

    // E030: order the dependent service tweak before its dependency.
    let plan = serde_json::json!({
        "version": 1, "snapshot_digest": snap["snapshot_digest"],
        "nodes": [
            {"name": "tweak", "from": [service[1]], "summary": "tweak"},
            {"name": "rest", "from": [service[0].clone(), app[0].clone(), app[1].clone(), util[0].clone()], "summary": "rest"}
        ],
        "order": ["tweak", "rest"]
    });
    let p = r.write_plan(&plan);
    let (code, json, _) = r.ism(&["check", p.to_str().unwrap()]);
    assert_eq!(code, 1);
    assert_eq!(json.unwrap()["errors"][0]["code"], "E030");

    // E003: tamper with a digest.
    let anchor = service[0].split('#').next().unwrap();
    let bad_id = format!("{anchor}#zzzz");
    let plan = serde_json::json!({
        "version": 1, "snapshot_digest": snap["snapshot_digest"],
        "nodes": [
            {"name": "one", "from": [bad_id], "summary": "x"},
            {"name": "rest", "from": [service[1].clone(), app[0].clone(), app[1].clone(), util[0].clone()], "summary": "rest"}
        ],
        "order": ["one", "rest"]
    });
    let p = r.write_plan(&plan);
    let (code, json, _) = r.ism(&["check", p.to_str().unwrap()]);
    assert_eq!(code, 1);
    assert_eq!(json.unwrap()["errors"][0]["code"], "E003");

    // E002: reference a hunk that never existed.
    let plan = serde_json::json!({
        "version": 1, "snapshot_digest": snap["snapshot_digest"],
        "nodes": [{"name": "one", "from": ["ghost.py:1#abcd"], "summary": "x"}],
        "order": ["one"]
    });
    let p = r.write_plan(&plan);
    let (code, json, _) = r.ism(&["check", p.to_str().unwrap()]);
    assert_eq!(code, 1);
    assert_eq!(json.unwrap()["errors"][0]["code"], "E002");

    // E010: history moves after inspect → stale plan.
    let plan = serde_json::json!({
        "version": 1, "snapshot_digest": snap["snapshot_digest"],
        "nodes": [
            {"name": "all", "from": [service[0].clone(), service[1].clone(), app[0].clone(), app[1].clone(), util[0].clone()], "summary": "all"}
        ],
        "order": ["all"]
    });
    let p = r.write_plan(&plan);
    r.write("late.txt", "late\n");
    r.commit_all("late commit");
    let (code, json, _) = r.ism(&["check", p.to_str().unwrap()]);
    assert_eq!(code, 3);
    assert_eq!(json.unwrap()["errors"][0]["code"], "E010");

    // E012: undo when no op / after external movement.
    let (code, json, _) = r.ism(&["undo"]);
    assert_eq!(code, 3); // precondition: no ops recorded
    let c = json.unwrap()["errors"][0]["code"]
        .as_str()
        .unwrap()
        .to_string();
    assert!(c == "E101" || c == "E012", "got {c}");
}

#[test]
fn degraded_files_whole_file_units() {
    let r = Repo::new();
    r.write("keep.txt", "k\n");
    r.write("gone.txt", "g1\ng2\n");
    r.commit_all("base");
    r.git(&["checkout", "-q", "-b", "feat"]);
    // C1: delete a file and add a no-trailing-newline file (both degrade).
    std::fs::remove_file(r.path().join("gone.txt")).unwrap();
    std::fs::write(r.path().join("raw.bin"), b"x\ny no newline").unwrap();
    r.commit_all("delete and add raw");
    // C2: normal line edit elsewhere.
    r.write("keep.txt", "k\nk2\n");
    r.commit_all("edit keep");

    let snap = inspect(&r);
    let hunks = snap["hunks"].as_array().unwrap();
    let file_kinds: Vec<(&str, &str)> = hunks
        .iter()
        .map(|h| (h["id"].as_str().unwrap(), h["kind"].as_str().unwrap()))
        .collect();
    assert!(file_kinds
        .iter()
        .any(|(id, k)| id.starts_with("gone.txt:") && *k == "file"));
    assert!(file_kinds
        .iter()
        .any(|(id, k)| id.starts_with("raw.bin:") && *k == "file"));

    // Reorganize: put the keep edit first, the deletions second.
    let keep = hunks_of(&snap, "keep.txt");
    let gone = hunks_of(&snap, "gone.txt");
    let raw = hunks_of(&snap, "raw.bin");
    let plan = serde_json::json!({
        "version": 1, "snapshot_digest": snap["snapshot_digest"],
        "nodes": [
            {"name": "keep-edit", "from": keep, "summary": "Extend keep"},
            {"name": "cleanup", "from": [gone[0].clone(), raw[0].clone()], "summary": "Delete gone, add raw"}
        ],
        "order": ["keep-edit", "cleanup"]
    });
    let p = r.write_plan(&plan);
    let tree_before = r.git(&["rev-parse", "HEAD^{tree}"]);
    let (code, _, out) = r.ism(&["apply", p.to_str().unwrap()]);
    assert_eq!(code, 0, "apply failed: {out}");
    assert_eq!(r.git(&["rev-parse", "HEAD^{tree}"]), tree_before);
}

#[test]
fn status_and_show_work() {
    let r = messy_repo();
    let (code, _, out) = r.ism(&["status"]);
    assert_eq!(code, 0);
    assert!(out.contains("feat"), "status: {out}");
    assert!(out.contains("untracked"));

    let snap = inspect(&r);
    let service = hunks_of(&snap, "service.py");
    let (code, json, _) = r.ism(&["show", "hunk", &service[0]]);
    assert_eq!(code, 0);
    let arr = json.unwrap();
    assert!(arr[0]["patch"].as_str().unwrap().contains("+s1"));
}

#[test]
fn crlf_content_roundtrips_bit_for_bit() {
    let r = Repo::new();
    r.git(&["config", "core.autocrlf", "false"]);
    r.write("win.txt", "one\r\ntwo\r\nthree\r\n");
    r.commit_all("base");
    r.git(&["checkout", "-q", "-b", "feat"]);
    r.write("win.txt", "one\r\nTWO\r\nthree\r\n");
    r.commit_all("edit two");
    r.write("more.txt", "m1\r\nm2\r\n");
    r.commit_all("add more");

    let snap = inspect(&r);
    let win = hunks_of(&snap, "win.txt");
    let more = hunks_of(&snap, "more.txt");
    assert_eq!((win.len(), more.len()), (1, 1));

    // Swap the two commits; CRLF bytes must survive untouched.
    let plan = serde_json::json!({
        "version": 1, "snapshot_digest": snap["snapshot_digest"],
        "nodes": [
            {"name": "more", "from": more, "summary": "Add more"},
            {"name": "win-edit", "from": win, "summary": "Edit two"}
        ],
        "order": ["more", "win-edit"]
    });
    let p = r.write_plan(&plan);
    let head_before = r.git(&["rev-parse", "HEAD"]);
    let tree_before = r.git(&["rev-parse", "HEAD^{tree}"]);
    let (code, _, out) = r.ism(&["apply", p.to_str().unwrap()]);
    assert_eq!(code, 0, "apply failed: {out}");
    assert_ne!(r.git(&["rev-parse", "HEAD"]), head_before);
    assert_eq!(r.git(&["rev-parse", "HEAD^{tree}"]), tree_before);
    // Intermediate commit carries the CRLF bytes exactly.
    let blob = Command::new("git")
        .arg("-C")
        .arg(r.path())
        .args(["show", "HEAD~1:win.txt"])
        .output()
        .unwrap();
    assert_eq!(blob.stdout, b"one\r\ntwo\r\nthree\r\n");
}

#[test]
fn signing_failure_is_e050_and_leaves_everything_untouched() {
    let r = messy_repo();
    r.git(&["config", "commit.gpgsign", "true"]);
    r.git(&["config", "gpg.program", "false"]); // a program that always fails

    let snap = inspect(&r);
    let all: Vec<String> = snap["hunks"]
        .as_array()
        .unwrap()
        .iter()
        .map(|h| h["id"].as_str().unwrap().to_string())
        .collect();
    let plan = serde_json::json!({
        "version": 1, "snapshot_digest": snap["snapshot_digest"],
        "nodes": [{"name": "all", "from": all, "summary": "everything"}],
        "order": ["all"]
    });
    let p = r.write_plan(&plan);
    let head_before = r.git(&["rev-parse", "HEAD"]);
    let (code, json, _) = r.ism(&["apply", p.to_str().unwrap()]);
    assert_eq!(code, 1);
    assert_eq!(json.unwrap()["errors"][0]["code"], "E050");
    // Branch untouched, and the failure happened before journaling: no data ref.
    assert_eq!(r.git(&["rev-parse", "HEAD"]), head_before);
    let refs = r.git(&["for-each-ref", "refs/isomer"]);
    assert_eq!(
        refs, "",
        "data ref must not exist after a pre-journal failure"
    );
}

#[test]
fn dangling_op_is_voided_and_rerun_succeeds() {
    let r = messy_repo();
    let snap = inspect(&r);
    let all: Vec<String> = snap["hunks"]
        .as_array()
        .unwrap()
        .iter()
        .map(|h| h["id"].as_str().unwrap().to_string())
        .collect();
    let plan = serde_json::json!({
        "version": 1, "snapshot_digest": snap["snapshot_digest"],
        "nodes": [{"name": "all", "from": all, "summary": "everything"}],
        "order": ["all"]
    });
    let p = r.write_plan(&plan);
    let head_before = r.git(&["rev-parse", "HEAD"]);
    let (code, _, out) = r.ism(&["apply", p.to_str().unwrap()]);
    assert_eq!(code, 0, "apply failed: {out}");

    // Simulate the journal-first crash window: the op is journaled but the
    // branch flip "never landed" (equivalently: an external rewind to old head).
    r.git(&["update-ref", "refs/heads/feat", &head_before]);

    // status reconciles the books and surfaces the voided op.
    let (code, json, _) = r.ism(&["status", "--json"]);
    assert_eq!(code, 0);
    let snap2 = json.unwrap();
    assert!(
        snap2["anomalies"]
            .as_array()
            .unwrap()
            .iter()
            .any(|a| a["kind"] == "dangling_op_voided"),
        "anomalies: {}",
        snap2["anomalies"]
    );

    // The voided op no longer counts as branch state: undo has nothing to do.
    let (code, json, _) = r.ism(&["undo"]);
    assert_eq!(code, 3);
    assert_eq!(json.unwrap()["errors"][0]["code"], "E101");

    // The same plan is valid again (branch is back at the inspected head).
    let (code, _, out) = r.ism(&["apply", p.to_str().unwrap()]);
    assert_eq!(code, 0, "re-apply failed: {out}");
    assert_ne!(r.git(&["rev-parse", "HEAD"]), head_before);
    let (code, json, _) = r.ism(&["verify"]);
    assert_eq!(code, 0);
    assert_eq!(json.unwrap()["ok"], true);
}

#[test]
fn comment_lifecycle_add_reply_resolve_list() {
    let r = messy_repo();
    let snap = inspect(&r);
    let app = hunks_of(&snap, "app.py");
    let service = hunks_of(&snap, "service.py");
    let util = hunks_of(&snap, "util.py");
    let plan = serde_json::json!({
        "version": 1, "snapshot_digest": snap["snapshot_digest"],
        "nodes": [
            {"name": "util-fix", "from": util, "summary": "Fix util label"},
            {"name": "app-changes", "from": app, "summary": "Adjust app flow"},
            {"name": "service", "from": service, "summary": "Add service module"}
        ],
        "order": ["util-fix", "app-changes", "service"]
    });
    let p = r.write_plan(&plan);
    let (code, _, out) = r.ism(&["apply", p.to_str().unwrap()]);
    assert_eq!(code, 0, "apply failed: {out}");

    // Comments target changes before any comment exists: unknown change is E002.
    let (code, json, _) = r.ism(&["comment", "add", "--change", "nope", "-m", "x"]);
    assert_eq!(code, 1);
    assert_eq!(json.unwrap()["errors"][0]["code"], "E002");
    // --line without --path is a usage error.
    let (code, json, _) = r.ism(&[
        "comment", "add", "--change", "util-fix", "--line", "2", "-m", "x",
    ]);
    assert_eq!(code, 2);
    assert_eq!(json.unwrap()["errors"][0]["code"], "E100");

    // Add by node name with a file anchor.
    let (code, json, raw) = r.ism(&[
        "comment",
        "add",
        "--change",
        "util-fix",
        "--path",
        "util.py",
        "--line",
        "2",
        "-m",
        "Rename the label instead of uppercasing?",
    ]);
    assert_eq!(code, 0, "comment add failed: {raw}");
    let c1 = json.unwrap();
    let c1_id = c1["id"].as_str().unwrap().to_string();
    assert!(c1_id.starts_with("c-"));
    assert!(c1["change"].as_str().unwrap().starts_with("i-"));
    assert_eq!(c1["resolved"], false);

    // Threaded reply on the same change.
    let (code, json, raw) = r.ism(&[
        "comment",
        "add",
        "--change",
        "util-fix",
        "--reply-to",
        &c1_id,
        "-m",
        "Agreed, will do.",
    ]);
    assert_eq!(code, 0, "reply failed: {raw}");
    let c2_id = json.unwrap()["id"].as_str().unwrap().to_string();

    // List: both present, reply linked to its parent.
    let (code, json, _) = r.ism(&["comment", "list"]);
    assert_eq!(code, 0);
    let list = json.unwrap();
    let arr = list.as_array().unwrap();
    assert_eq!(arr.len(), 2);
    let reply = arr.iter().find(|c| c["id"] == c2_id.as_str()).unwrap();
    assert_eq!(reply["parent"], c1_id.as_str());

    // Resolve the first; unresolved filter leaves only the reply.
    let (code, json, _) = r.ism(&["comment", "resolve", &c1_id]);
    assert_eq!(code, 0);
    assert_eq!(json.unwrap()["resolved"], true);
    let (code, json, _) = r.ism(&["comment", "list", "--unresolved"]);
    assert_eq!(code, 0);
    let arr = json.unwrap();
    let arr = arr.as_array().unwrap().clone();
    assert_eq!(arr.len(), 1);
    assert_eq!(arr[0]["id"], c2_id.as_str());

    // Comments ride the data ref: carried forward across later operations.
    let (code, _, _) = r.ism(&["undo"]);
    assert_eq!(code, 0);
    let (code, json, _) = r.ism(&["comment", "list"]);
    assert_eq!(code, 0);
    assert_eq!(json.unwrap().as_array().unwrap().len(), 2);
}
