//! `ism` — agent-native git change reorganization with a tree-hash proof.
//!
//! Contract (design/03): stdout is a clean data channel (JSON for machine
//! commands, table for `status`); human notes go to stderr; errors are
//! structured JSON with stable codes; nothing is ever interactive.

use clap::{Parser, Subcommand};
use ism_core::error::IsmError;
use ism_core::gitio::Git;
use ism_core::model::Plan;
use std::path::PathBuf;
use std::process::ExitCode;

#[derive(Parser)]
#[command(
    name = "ism",
    version,
    about = "Same code, new structure. Reorganize git changes with proof."
)]
struct Cli {
    #[command(subcommand)]
    command: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// Human view of the current stack and its health.
    Status {
        /// Emit machine-readable JSON instead of the table.
        #[arg(long)]
        json: bool,
    },
    /// Show one change (by name or id), or hunk contents.
    Show {
        /// "hunk" for hunk mode, else a change name or id.
        target: String,
        /// Hunk ids (when target is "hunk").
        ids: Vec<String>,
        /// Explicit base revision (defaults to merge-base with the trunk).
        #[arg(long)]
        base: Option<String>,
    },
    /// Emit the reorganization raw material as JSON (index level by default).
    Inspect {
        /// Explicit base revision (defaults to merge-base with the trunk).
        #[arg(long)]
        base: Option<String>,
        /// Include patch text inline (large diffs may be huge).
        #[arg(long)]
        full: bool,
    },
    /// Validate a plan (R1–R8). Passing check guarantees apply succeeds.
    Check { plan: PathBuf },
    /// Execute a plan: atomically rebuild the commit chain (the only writer).
    Apply { plan: PathBuf },
    /// Prove tree invariance for the latest (or given) operation.
    Verify {
        /// Op-log commit sha (defaults to the latest op on this branch).
        #[arg(long)]
        op: Option<String>,
    },
    /// Revert the latest ism operation on this branch (append-only op log).
    Undo,
    /// Review comments anchored to changes (stored on refs/isomer/data).
    Comment {
        #[command(subcommand)]
        action: CommentCmd,
    },
    /// The paired agent skill (embedded in this binary, version-locked).
    Skill {
        #[command(subcommand)]
        action: SkillCmd,
    },
}

#[derive(Subcommand)]
enum SkillCmd {
    /// Write SKILL.md to .claude/skills/ism/ (project) or ~/.claude/skills/ism/.
    Install {
        /// Install user-wide instead of into the current project.
        #[arg(long)]
        user: bool,
    },
    /// Print the embedded SKILL.md to stdout.
    Show,
}

/// The skill shipped inside the binary — always matches this ism version.
const SKILL_MD: &str = include_str!("../skill/SKILL.md");

#[derive(Subcommand)]
enum CommentCmd {
    /// Add a comment (or a threaded reply) to a change.
    Add {
        /// Change id (i-xxxxxxxx) or node name.
        #[arg(long)]
        change: String,
        /// Optional file anchor (repo-relative path).
        #[arg(long)]
        path: Option<String>,
        /// Optional 1-based line in the change's post-image (requires --path).
        #[arg(long)]
        line: Option<u32>,
        /// Comment id this replies to (threading).
        #[arg(long)]
        reply_to: Option<String>,
        /// Comment body.
        #[arg(short, long)]
        message: String,
    },
    /// List comments as JSON, oldest first.
    List {
        /// Filter to one change (id or name).
        #[arg(long)]
        change: Option<String>,
        /// Only unresolved comments.
        #[arg(long)]
        unresolved: bool,
    },
    /// Mark a comment resolved (idempotent).
    Resolve { id: String },
}

fn read_plan(path: &PathBuf) -> Result<Plan, IsmError> {
    let bytes = std::fs::read(path)
        .map_err(|e| IsmError::Usage(format!("cannot read plan {}: {e}", path.display())))?;
    serde_json::from_slice(&bytes).map_err(|e| IsmError::PlanSchema(e.to_string()))
}

fn run() -> Result<(), IsmError> {
    let cli = Cli::parse();
    let git = Git::discover(&std::env::current_dir()?)?;

    match cli.command {
        Cmd::Status { json } => {
            let mut analysis = ism_core::analyze::analyze(&git, None, false)?;
            if let Some(voided) = ism_core::oplog::reconcile(&git, &analysis.snapshot.branch)? {
                analysis
                    .snapshot
                    .anomalies
                    .push(ism_core::model::Anomaly::DanglingOpVoided { op: voided });
            }
            let snap = &analysis.snapshot;
            if json {
                println!("{}", serde_json::to_string_pretty(snap)?);
                return Ok(());
            }
            println!(
                "stack {}..{} on {}",
                &snap.base[..8.min(snap.base.len())],
                &snap.head[..8.min(snap.head.len())],
                snap.branch
            );
            if snap.commits.is_empty() {
                println!("(empty — branch is at the trunk)");
            }
            for (i, c) in snap.commits.iter().enumerate() {
                let id = c.change_id.clone().unwrap_or_else(|| "untracked".into());
                let meta = ism_core::oplog::change_meta(&git, &id).ok().flatten();
                let summary = meta.map(|m| m.summary).unwrap_or_else(|| c.title.clone());
                println!("{:>3}  {}  {:<12}  {}", i + 1, &c.sha[..8], id, summary);
            }
            if !snap.anomalies.is_empty() {
                println!("--- anomalies ---");
                for a in &snap.anomalies {
                    println!("{}", serde_json::to_string(a)?);
                }
            }
            if let Some((sha, op)) = ism_core::oplog::latest_for_branch(&git, &snap.branch)? {
                println!("last op: {:?} {} ({})", op.kind, &sha[..8], op.timestamp);
            }
            Ok(())
        }
        Cmd::Show { target, ids, base } => {
            if target == "hunk" {
                if ids.is_empty() {
                    return Err(IsmError::Usage("ism show hunk <id>...".into()));
                }
                let analysis = ism_core::analyze::analyze(&git, base.as_deref(), false)?;
                let mut out = Vec::new();
                for id in &ids {
                    let idx = analysis
                        .snapshot
                        .hunks
                        .iter()
                        .position(|m| &m.id == id)
                        .ok_or_else(|| IsmError::UnknownRef(format!("unknown hunk: {id}")))?;
                    out.push(serde_json::json!({
                        "id": id,
                        "commit": analysis.snapshot.hunks[idx].commit,
                        "patch": analysis.patches[idx],
                    }));
                }
                println!("{}", serde_json::to_string_pretty(&out)?);
                return Ok(());
            }
            // Change mode: resolve by trailer id or by metadata name.
            let analysis = ism_core::analyze::analyze(&git, base.as_deref(), false)?;
            let snap = &analysis.snapshot;
            let resolved: Option<(String, Option<String>)> = snap
                .commits
                .iter()
                .find(|c| c.change_id.as_deref() == Some(target.as_str()))
                .map(|c| (c.sha.clone(), c.change_id.clone()))
                .or_else(|| {
                    // Look the name up in metadata, then match its id in the stack.
                    snap.commits.iter().find_map(|c| {
                        let id = c.change_id.as_deref()?;
                        let meta = ism_core::oplog::change_meta(&git, id).ok().flatten()?;
                        (meta.name.as_deref() == Some(target.as_str()))
                            .then(|| (c.sha.clone(), c.change_id.clone()))
                    })
                });
            let (sha, change_id) = resolved.ok_or_else(|| {
                IsmError::UnknownRef(format!("change not found in stack: {target}"))
            })?;
            let meta = match &change_id {
                Some(id) => ism_core::oplog::change_meta(&git, id)?,
                None => None,
            };
            let diff = String::from_utf8_lossy(&git.run(&[
                "show",
                "--format=%H%n%s",
                "--no-color",
                &sha,
            ])?)
            .to_string();
            println!(
                "{}",
                serde_json::to_string_pretty(&serde_json::json!({
                    "change": change_id,
                    "commit": sha,
                    "meta": meta,
                    "diff": diff,
                }))?
            );
            Ok(())
        }
        Cmd::Inspect { base, full } => {
            let analysis = ism_core::analyze::analyze(&git, base.as_deref(), full)?;
            println!("{}", serde_json::to_string_pretty(&analysis.snapshot)?);
            Ok(())
        }
        Cmd::Check { plan } => {
            let plan = read_plan(&plan)?;
            ism_core::engine::validate(&git, &plan)?;
            println!(
                "{}",
                serde_json::json!({ "ok": true, "promise": "apply will succeed" })
            );
            Ok(())
        }
        Cmd::Apply { plan } => {
            let plan = read_plan(&plan)?;
            let outcome = ism_core::engine::apply(&git, &plan)?;
            println!("{}", serde_json::to_string_pretty(&outcome)?);
            Ok(())
        }
        Cmd::Verify { op } => {
            let outcome = ism_core::verify::verify(&git, op.as_deref())?;
            println!("{}", serde_json::to_string_pretty(&outcome)?);
            if !outcome.ok {
                std::process::exit(1);
            }
            Ok(())
        }
        Cmd::Undo => {
            let outcome = ism_core::engine::undo(&git)?;
            println!("{}", serde_json::to_string_pretty(&outcome)?);
            Ok(())
        }
        Cmd::Skill { action } => match action {
            SkillCmd::Install { user } => {
                let root = if user {
                    let home = std::env::var("HOME")
                        .or_else(|_| std::env::var("USERPROFILE"))
                        .map_err(|_| {
                            IsmError::Precondition("cannot resolve the home directory".into())
                        })?;
                    PathBuf::from(home).join(".claude")
                } else {
                    let top = git.out(&["rev-parse", "--show-toplevel"]).map_err(|_| {
                        IsmError::Precondition(
                            "project install requires a worktree; use --user".into(),
                        )
                    })?;
                    PathBuf::from(top.trim()).join(".claude")
                };
                let dir = root.join("skills").join("ism");
                std::fs::create_dir_all(&dir)?;
                let path = dir.join("SKILL.md");
                std::fs::write(&path, SKILL_MD)?;
                println!(
                    "{}",
                    serde_json::json!({
                        "ok": true,
                        "path": path.display().to_string(),
                        "scope": if user { "user" } else { "project" },
                        "version": ism_core::VERSION,
                    })
                );
                Ok(())
            }
            SkillCmd::Show => {
                print!("{SKILL_MD}");
                Ok(())
            }
        },
        Cmd::Comment { action } => match action {
            CommentCmd::Add {
                change,
                path,
                line,
                reply_to,
                message,
            } => {
                let comment = ism_core::comment::add(
                    &git,
                    ism_core::comment::NewComment {
                        change: &change,
                        path,
                        line,
                        reply_to,
                        body: message,
                    },
                )?;
                println!("{}", serde_json::to_string_pretty(&comment)?);
                Ok(())
            }
            CommentCmd::List { change, unresolved } => {
                let comments = ism_core::comment::list(&git, change.as_deref(), unresolved)?;
                println!("{}", serde_json::to_string_pretty(&comments)?);
                Ok(())
            }
            CommentCmd::Resolve { id } => {
                let comment = ism_core::comment::resolve(&git, &id)?;
                println!("{}", serde_json::to_string_pretty(&comment)?);
                Ok(())
            }
        },
    }
}

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            // Structured error to stdout (agents parse it); code drives exit.
            println!(
                "{}",
                serde_json::json!({ "ok": false, "errors": [e.report()] })
            );
            ExitCode::from(e.exit_code() as u8)
        }
    }
}
