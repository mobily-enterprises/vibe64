# Work in connected repositories

This continues [Configure connected repositories](connected-projects.md): how a
session works in the repositories its `vibe64.connections.json` lists, and how
**Prepare workspace**, **Update this session (rebase)** and **Save** cover them.

## Each session has its own copies

Every session keeps its own copy of each listed repository, in a `connected`
folder beside its source: `connected/<name>`, where the name is the last part of
the repository's `owner/name`, in lower case. You, Main chat and the coding
agent edit a copy like any other files. Other sessions never see this session's
copies, and no session of another project is involved.

The AI's Git works in a copy too: inside `connected/<name>` it runs Git's local
commands, such as `status`, `diff`, `log` and `show`. It does not run the ones
that reach the repository on GitHub, such as `fetch`, `pull` and `push`, or
`gh`, there: **Save** publishes the copy and **Update this session (rebase)**
brings in its main.

`vibe64-helper session status --json` lists the copies under
`repository.connected`, each with its `name`, `path`, how many commits it is
`behind` its main and whether it holds `unsaved` work.

## Prepare workspace makes the missing copies

**Prepare workspace** (and **Retry**) copies every listed repository the session
has no copy of yet, from that repository's default branch on GitHub, with your
connected GitHub account. When this installation already has a project for the
same GitHub repository, its local copy speeds the clone up; the session's copy
does not depend on it afterwards. The output has one line per repository:

- `[Connected] library copied at 4f2a9c1e7b30.` for a new copy;
- `[Connected] library ready at 4f2a9c1e7b30.` for a copy the session already
  has. Prepare never fetches, resets or replaces an existing copy; **Update this
  session (rebase)** brings it up to date;
- `[Connected] library removed; it is no longer listed.` when the repository
  left the list and its copy held no work;
- `[Connected] library kept: it is no longer listed but has unsaved work. Save it,
  then prepare again.` when it did. Save still saves that copy; the next
  preparation then removes it.

Preparation then writes the Stack's `Sources file` pointing at the copies and
runs the declared connected Prepare and Verify commands; see
[Configure connected repositories](connected-projects.md).

Preparation stops, naming the repository, when:

- the list names this project's own repository: remove that entry;
- a folder the session did not record is already where the copy goes: move it
  away, then **Retry**;
- a recorded copy's folder is missing: Vibe64 does not replace it, because its
  work could be lost. Restore the folder from a backup, or start a new session.

## Update this session (rebase) updates every copy

**Update this session (rebase)** first brings each copy onto the latest commit
of its repository's main, the same way it updates the session's own repository:
your work in the copy stays on top as unsaved changes. Then it updates the
session's own repository. Each copy adds one line to the output:

- `[Connected] library updated to 9d1c03b2aa41.`
- `[Connected] library was already current.`
- `[Connected] library was not updated and is unchanged: ...` followed by the
  reason, for example the files that conflict.

A copy that cannot be updated stays exactly as it was, and the other copies and
the session's own repository still update. The Update notice then shows that
copy's problem. A conflict names the repository and its files from the session's
source, for example `1 file in connected repository library needs review before
this session can update: ../connected/library/src/index.js.` Resolve it as you
would in the session's own repository: edit the listed files in the copy's
folder, then use **Review resolved conflicts** to apply Update, or choose **Fix it
with AI** and the AI repairs the files and runs Update itself. Only that copy
resumes its review; with several conflicting copies, Update shows the next one
afterwards.

If Vibe64 stops while updating, for example on a restart, the copy it was
changing is finished from what Update had prepared, as the session's own
repository is. When Update had not yet reached the session's own repository, the
notice says the update can be retried: choose **Update this session (rebase)**
again.

The session's regular check for newer saved work also watches each copy's main,
so the session asks for an Update when any of them moves.

## Save saves the copies first

**Save** covers the copies and the session's own repository together. The
session badge shows **Unsaved changes** when any copy has work, even when the
session's own repository is clean.

1. Before pushing anything, Save checks every copy against its main, and the
   session's own repository too when it has work. If any of them is behind, even
   a copy with nothing to save, Save stops with an **Update first** refusal, for
   example `library has newer saved work. Update this session before saving its
   work.`, and pushes nothing. Choose **Update this session (rebase)**, then Save.
2. It then saves each copy that has work, in the order the list names them:
   one commit, named like any Save, pushed straight to that repository's main.
   Each copy's new commit is recorded before the next copy is saved, and the
   output shows `[Connected] library saved at 6e0b7a2c91d4.`
3. Last, it saves the session's own repository, as usual. When only copies have
   work, Save saves them and leaves the session's own repository as it is.

The Save result lists the connected repositories it saved, with their commits.

If a copy's push is refused because someone saved to that repository's main
meanwhile, Save stops with the same **Update first** refusal. Copies saved
before it stay saved; the later copies and the session's own repository are not
pushed. Any other refusal, for example a branch rule that requires a pull
request, is reported as GitHub gave it and also stops Save before the session's
own repository. Copies are only ever saved straight to their main, so work in a
copy of a repository that requires pull requests cannot be saved from here.

If Vibe64 stops while saving, for example on a restart, recovery records each
copy whose push landed and never pushes it again; a copy that was not pushed
keeps its work for the next Save. A Save of copies alone shows **Interrupted
Save recovered and reconciled.** with one `[Connected] library saved at …` line
per copy once every copy it pushed is recorded and nothing is left unsaved.

## Archive and renewal

Archiving a session saves each copy's commits, changed files and untracked files
in the session's archive, next to its own recovery, then removes the copies with
the session's source.

Renewal needs every copy saved and current, like the session's own repository:
Save and Update first. The renewed session makes new copies from the mains when
its workspace is prepared; the old copies are removed once the renewal finishes,
with their recovery kept in the old session's archive.

Colleague can explain these steps and run **Prepare workspace**, **Update this
session (rebase)** and **Save** through their existing actions when you ask; a
how-to question does not authorize a Save.
