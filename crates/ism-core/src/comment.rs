//! Review comments: anchored to change identities, stored on the data ref.
//!
//! The review loop this enables: a human (or the desktop app) leaves comments
//! on changes; `ism comment list` hands the full set to an agent as JSON; the
//! agent fixes and resolves. Comments never reference commit shas — those are
//! rewritten by reorganization; change ids survive it.

use crate::error::{IsmError, Result};
use crate::gitio::Git;
use crate::model::{
    is_valid_change_id, is_valid_comment_id, now_epoch, Comment, CHANGE_ID_ALPHABET,
};
use crate::oplog;
use sha2::{Digest, Sha256};

fn mint_comment_id(seed: &str, salt: u32) -> String {
    let mut h = Sha256::new();
    h.update(b"ism-comment-v1");
    h.update(seed.as_bytes());
    h.update(salt.to_le_bytes());
    let digest = h.finalize();
    let id: String = digest
        .iter()
        .take(8)
        .map(|b| CHANGE_ID_ALPHABET[(*b as usize) % 32] as char)
        .collect();
    format!("c-{id}")
}

/// Resolve a change reference — an `i-` id or a node name — against the
/// metadata on the data ref.
pub fn resolve_change(git: &Git, target: &str) -> Result<String> {
    if is_valid_change_id(target) {
        if oplog::change_meta(git, target)?.is_some() {
            return Ok(target.to_string());
        }
        return Err(IsmError::UnknownRef(format!(
            "change {target} has no metadata on refs/isomer/data"
        )));
    }
    let matches: Vec<String> = oplog::change_metas(git)?
        .into_iter()
        .filter(|m| m.name.as_deref() == Some(target))
        .map(|m| m.id)
        .collect();
    match matches.as_slice() {
        [] => Err(IsmError::UnknownRef(format!("no change named {target}"))),
        [id] => Ok(id.clone()),
        many => Err(IsmError::UnknownRef(format!(
            "change name {target} is ambiguous ({}); use the i- id",
            many.join(", ")
        ))),
    }
}

pub struct NewComment<'a> {
    pub change: &'a str,
    pub path: Option<String>,
    pub line: Option<u32>,
    pub reply_to: Option<String>,
    pub body: String,
}

pub fn add(git: &Git, new: NewComment<'_>) -> Result<Comment> {
    if new.line.is_some() && new.path.is_none() {
        return Err(IsmError::Usage("--line requires --path".into()));
    }
    if new.body.trim().is_empty() {
        return Err(IsmError::Usage("comment body must not be empty".into()));
    }
    let change = resolve_change(git, new.change)?;
    if let Some(parent) = &new.reply_to {
        if !is_valid_comment_id(parent) {
            return Err(IsmError::UnknownRef(format!("not a comment id: {parent}")));
        }
        let p = oplog::comment(git, parent)?
            .ok_or_else(|| IsmError::UnknownRef(format!("unknown comment: {parent}")))?;
        if p.change != change {
            return Err(IsmError::Usage(format!(
                "reply targets change {change} but parent comment is on {}",
                p.change
            )));
        }
    }
    let author_name = git.config("user.name").unwrap_or_default();
    let author_email = git.config("user.email").unwrap_or_default();
    let created_at = now_epoch();
    let seed = format!(
        "{change}\x1f{}\x1f{}\x1f{}\x1f{}\x1f{author_name}\x1f{created_at}",
        new.path.as_deref().unwrap_or(""),
        new.line.unwrap_or(0),
        new.reply_to.as_deref().unwrap_or(""),
        new.body,
    );
    let mut salt = 0u32;
    let id = loop {
        let candidate = mint_comment_id(&seed, salt);
        if oplog::comment(git, &candidate)?.is_none() {
            break candidate;
        }
        salt += 1;
    };
    let comment = Comment {
        id,
        change,
        path: new.path,
        line: new.line,
        parent: new.reply_to,
        body: new.body,
        author_name,
        author_email,
        created_at,
        resolved: false,
    };
    oplog::append_comments(git, std::slice::from_ref(&comment))?;
    Ok(comment)
}

/// Mark a comment resolved. Idempotent: resolving twice is not an error.
pub fn resolve(git: &Git, id: &str) -> Result<Comment> {
    if !is_valid_comment_id(id) {
        return Err(IsmError::UnknownRef(format!("not a comment id: {id}")));
    }
    let mut c = oplog::comment(git, id)?
        .ok_or_else(|| IsmError::UnknownRef(format!("unknown comment: {id}")))?;
    if !c.resolved {
        c.resolved = true;
        oplog::append_comments(git, std::slice::from_ref(&c))?;
    }
    Ok(c)
}

/// List comments, optionally filtered by change and resolution state.
pub fn list(git: &Git, change: Option<&str>, unresolved_only: bool) -> Result<Vec<Comment>> {
    let change_id = match change {
        Some(target) => Some(resolve_change(git, target)?),
        None => None,
    };
    Ok(oplog::comments(git)?
        .into_iter()
        .filter(|c| change_id.as_deref().is_none_or(|id| c.change == id))
        .filter(|c| !unresolved_only || !c.resolved)
        .collect())
}
