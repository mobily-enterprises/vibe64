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

The AI's Git works in a copy too: on `connected/<name>`, whether it runs inside
the copy or names it with `-C`, `--git-dir` or `--work-tree` from elsewhere in
the session, it runs Git's local commands, such as `status`, `diff`, `log` and
`show`. It does not run the ones that reach the repository on GitHub, such as
`fetch`, `pull` and `push`, or `gh`, there: **Save** publishes the copy and
**Update this session (rebase)** brings in its main. From the session's
[temporary folder](sessions.md#the-sessions-temporary-folder) it can read a copy,
for example `git -C ../connected/<name> rev-parse --show-toplevel`, but one
command never works on two of the session's repositories at once.

`vibe64-helper session status --json` lists the copies under
`repository.connected`, each with its `name`, `path`, how many commits it is
`behind` its main and whether it holds `unsaved` work. A typed `dependency`
copy also has its package `type` and `inEffect`: `true` when the session's app
uses this copy instead of the published package, otherwise `false` with the
`reason` (for example `node_modules/library/index.js no longer holds the
connected source.`); **Prepare workspace** puts it in effect again. Its
`published` list names, per package, the version the copy carries
(`connected`) and the published one Staging and Production use (`locked`);
`unreleased: true` means the copy differs from what was published at that same
version, so publish a new version (npm, Go modules and Composer can tell; the
other types leave it out).

## Prepare workspace makes the missing copies

**Prepare workspace** (and **Retry**) copies every listed repository the session
has no copy of yet, from that repository's default branch on GitHub, with the
session's GitHub account: the one its Save and Update of the copies run as,
shown in the session header. A session without one yet takes the account of the
person who prepares it, which becomes the session's. Preparation that starts on
its own, after **Update this session (rebase)**, after an AI turn or when
Preview starts, copies with that same account. When the session has no GitHub
account yet and nobody started the preparation, it does not fail: it stops at
**Prepare connected repositories** with **Workspace preparation required** and
`Select Prepare workspace to copy this session's connected repositories with
your GitHub account.`, and Preview waits with the same message. Select
**Prepare workspace** and it continues with your account. When this
installation already has a project for the same GitHub repository, its local
copy speeds the clone up; the session's copy does not depend on it afterwards.
The output has one line per repository:

- `[Connected] library copied at 4f2a9c1e7b30.` for a new copy;
- `[Connected] library ready at 4f2a9c1e7b30.` for a copy the session already
  has. Prepare never fetches, resets or replaces an existing copy; **Update this
  session (rebase)** brings it up to date;
- `[Connected] library removed; it is no longer listed.` when the repository
  left the list and its copy held no work;
- `[Connected] library kept: it is no longer listed but holds 1 uncommitted file.
  Save it or move it away, then prepare again.` when it held work: uncommitted
  files, stashes, commits its main lacks on any branch, or an unfinished rebase,
  merge, cherry-pick or revert. Files Git ignores are not work. Save still saves
  that copy's commits and files; the next preparation then removes it. For work
  Save does not take, such as a stash, apply or drop it, or move the folder away.

When a typed npm dependency left the list, the same preparation puts npm's
published package back in place of the connected copy and says so, for example
`[Connected] Put back the published @example/library at
/…/node_modules/@example/library in place of the removed connection's copy.`
Other package types name the files they removed. This happens at the next
preparation even when it was the last connection.

Preparation then writes the Stack's `Sources file` pointing at the copies (when
Stack names one), puts each typed dependency copy in effect, proves it, and
runs any declared connected Prepare and Verify commands; see
[Configure connected repositories](connected-projects.md). A typed dependency
nothing in the session installs does not stop it: preparation says `<name> is
connected, but nothing here installs it: remove it or install it.` and goes on.

Preparation stops, naming the repository, when:

- the list names this project's own repository: remove that entry;
- a folder the session did not record is already where the copy goes: move it
  away, then **Retry**;
- a recorded copy's folder is missing: Vibe64 does not replace it, because its
  work could be lost. Restore the folder from a backup, or start a new session;
- the list now names another repository with the name of a copy the session
  has, for example `example/library` where `connected/library` is a clone of
  `archive/library`. Preparation stops before it changes anything: `Connected
  repository library now names example/library, but this session's copy at
  /…/connected/library is a clone of archive/library. Nothing was changed. Save
  any work in it, move the folder away, then prepare again.` When the copy holds
  work, the message names it. Vibe64 never replaces a copy itself: Save still
  saves the copy's work to the old repository; then move the folder out of
  `connected` and choose **Retry** to copy the new repository.

## Update this session (rebase) updates every copy

**Update this session (rebase)** first brings each copy onto the latest commit
of its repository's main, the same way it updates the session's own repository:
your work in the copy stays on top as unsaved changes. Then it updates the
session's own repository. Each copy adds one line to the output:

- `[Connected] library updated to 9d1c03b2aa41.`
- `[Connected] library was already current.`
- `[Connected] library was not updated and is unchanged: ...` followed by the
  reason, for example the files that conflict.
- `[Connected] library: ...` when Update could not put the copy back as it was,
  for example because its files kept changing; the reason says how it was left.

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

When another session saved a Composition copy, the project's main pins that
newer commit in `vibe64.connections.lock.json` (see the Save section below):
after Update this session's copy is on that repository's main and its source
holds the same pin. A pin an unfinished Save of this session left in the file is
put back before Update, so it never conflicts; the next Save writes the copies'
commits again.

When a Composition repository's main moved without this project pinning it (it
was saved from another project or outside Vibe64), Update still brings the copy
onto that main, and the session's source keeps the earlier pin. Until a Save
records the new one, the project's main, and so Staging and Production, keep
building the earlier commit. So the session then has work to save even with no
changed file: its badge shows **Unsaved changes**, the badge's hover text and
the **Save** button's say `Save pins example/library at 6e0b7a2c91d4 in
vibe64.connections.lock.json`, and **Save** records it (step 3 below). The same
holds when the project's main has no `vibe64.connections.lock.json` yet: Save
stays available in each session with a Composition copy until one Save writes
it.

The session's regular check for newer saved work also watches each copy's main,
so the session asks for an Update when any of them moves. The session's AI runs
this same Update itself when the session is behind, before building on the old
code, and repairs a copy's conflict the same way, or leaves it and tells you; see
[The session's AI updates the session itself](ai-save-and-update.md#the-sessions-ai-updates-the-session-itself).

## Save saves the copies first

**Save** covers the copies and the session's own repository together. The
session badge shows **Unsaved changes** when any copy has work, or when
`vibe64.connections.lock.json` is behind a Composition copy (see above), even
when the session's own repository is clean. Save answers **Nothing to save**
only when no repository has work and every pin names its copy's commit, before
it pushes anything.

1. Before pushing anything, Save checks every copy against its main, and the
   session's own repository too when it has work or this Save will pin a
   Composition copy (step 3). If any of them is behind, even
   a copy with nothing to save, Save stops with an **Update first** refusal, for
   example `In connected repository library, main has 1 newer saved version
   (8:11 AM, 1 file). Update this session to take it in (your unsaved work
   stays), then Save.`, and pushes nothing. Choose **Update this session
   (rebase)**, then Save.
2. It then saves each copy that has work, in the order the list names them:
   one commit, named like any Save, pushed straight to that repository's main.
   Each copy's new commit is recorded before the next copy is saved, and the
   output shows `[Connected] library saved at 6e0b7a2c91d4.`
3. It records the connections in the session's own source:
   - each **Composition** copy's saved commit and tree go into
     `vibe64.connections.lock.json` beside `vibe64.connections.json`, with the
     line `[Connected] vibe64.connections.lock.json pins example/library at
     6e0b7a2c91d4.`; a Composition this session has no copy of keeps its earlier
     pin. The project's composer, and so Staging and Production, assemble exactly
     the pinned commit. Vibe64 writes this file; do not edit it;
   - a **Dependency** has no pin: it reaches Staging and Production as a
     published version. When its copy declares a version the registry has
     published, Save moves the project's manifest and lock to it and says so in
     a `[Connected]` line naming the package and version; until then they keep
     the version the manifest and lock name. A check that cannot reach the registry is
     reported as `[Connected] Vibe64 could not check the connected dependencies
     for published versions: ...` and never stops Save;
   - the Stack's Connected development **Save** entries run, in order; one that
     fails stops Save before the session's own commit, with `The connected Save
     step <label> failed: <reason>.`
4. Last, it saves the session's own repository, as usual, in one commit with
   what step 3 changed, even when that is only the pin. When only copies have
   work and nothing changed in step 3, Save saves them and leaves the session's
   own repository as it is.

The Save result lists the connected repositories it saved, with their commits.
When Main chat's AI saves a finished stage itself, with **Automatically save
changes** on, it is this same Save, copies first; its answer names each copy's
commit and files as `../connected/<name>/...`. See [The session's AI saves its
finished stages](ai-save-and-update.md#the-sessions-ai-saves-its-finished-stages).

If a copy's push is refused because someone saved to that repository's main
meanwhile, Save stops with the same **Update first** refusal. Copies saved
before it stay saved; the later copies and the session's own repository are not
pushed. Any other refusal, for example a branch rule that requires a pull
request, is reported as GitHub gave it and also stops Save before the session's
own repository. Copies are only ever saved straight to their main, so work in a
copy of a repository that requires pull requests cannot be saved from here.

If Save stops after it pushed a copy (step 3 or 4 failed, or the session's own
main moved meanwhile), the copy stays saved and the refusal says so, for example
`Saved library at 6e0b7a2c91d4 to its main, but this project's own source is not
saved, so its main still pins the earlier commit of library. Main has 1 newer
saved version (2 minutes ago, 1 file). Update this session to take it in (your
unsaved work stays), then Save. Save again to finish.`
Do what the reason asks, then Save again: the copy has nothing left to push, and
this Save records its pin.

If Vibe64 stops while saving, for example on a restart, recovery records each
copy whose push landed and never pushes it again; a copy that was not pushed
keeps its work for the next Save. A Save of copies alone shows **Interrupted
Save recovered and reconciled.** with one `[Connected] library saved at …` line
per copy once every copy it pushed is recorded and pinned and nothing is left
unsaved; until then the next Save finishes it.

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
