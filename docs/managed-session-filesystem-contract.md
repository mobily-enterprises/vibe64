# Managed session filesystem contract

This is a release-blocking contract for every host that shares managed Vibe64
project and session sources between several Unix identities through one group.
A person's own computer runs everything as that person and needs none of it. It records the 2026-08-15 permission failure that cost live
work and the architecture required to prevent it from recurring.

## Incident

Vite and `vue-router` failed with `EACCES` while regenerating
`src/typed-router.d.ts` in a hosted session.

The source file was replaced at 14:29:12. The preview watcher attempted its HMR
write at 14:29:13 and failed. Vibe64's former post-command recursive permission
repair did not complete until 14:29:30. The repair was therefore inherently too
late for a live watcher.

The human/agent command and the workspace daemon were writing the same session
source under different Unix identities:

- human or agent commands could run as `merc`;
- preview and Vite ran as the workspace daemon account;
- both identities belonged to the shared `vibe64` group;
- directories were setgid, but did not have an inherited default ACL;
- an atomically replaced file could consequently be created without shared
  group write access.

The problem was not credentials, Git authentication, application behavior, or
deployment. It was the filesystem creation contract.

## Emergency host repair

The live project trees for `sas/dogandgroom`, `sas/compas-next`, and `pass/whs2`
were repaired by:

1. assigning the shared `vibe64` group recursively;
2. making existing files group-writable;
3. making directories group-writable and setgid;
4. adding inherited default ACLs for shared group access;
5. verifying that no existing file lacked shared-group write access.

A file created as `merc` with umask `0022` then inherited owner `merc`, group
`vibe64`, and mode `0660`; the corresponding workspace daemon could append
immediately. The affected `typed-router.d.ts` became writable by that daemon.

This emergency repair is evidence, not the product design. Vibe64 must not
depend on repeating a recursive repair.

## Mandatory architecture

Credentials and filesystem identity are separate concerns. GitHub, database,
preview-identity, and application credentials must not determine source
ownership or write access.

Every routine operation inside a managed project/session source runs as the
workspace daemon account. This includes agent commands, Git index
and worktree operations, package managers, generators, workspace setup, and
preview processes. A selected human account supplies Git authorship and remote
authorization; it does not change the Unix identity of the Git process. This
single-writer rule makes an application-owned `0600` file readable to Git
without any permission repair and removes cross-identity races from live
source work.

Before any actor, agent, package manager, generated-file writer, or preview
watcher starts, every managed project/session source namespace must have:

- owning group: `vibe64`;
- directory mode: `2770`;
- process umask for managed writers: `0007`;
- access group ACL: `vibe64:rwx`;
- inherited default group ACL: `vibe64:rwx`;
- no access for other users.

The human users allowed to administer a workspace and its daemon account must
be members of `vibe64`. Shared group access
remains mandatory for maintenance, recovery, and explicit host inspection; it
is not the routine mutation path and product correctness must not depend on a
second Unix identity being able to race a live writer. A missing group, missing
ACL tools, wrong ownership, wrong mode, absent default ACL, or missing group
membership is a startup failure. It is never repaired after a command.

The ACL contract must survive or be re-established before exposing a path
created by clone, copy, atomic replacement, checkout, reset, move, archive
restore, or session-source recovery. A path must not become visible to a live
watcher in an intermediate unsafe state.

## Required proof

Host verification must exercise the credential/filesystem separation, not
merely inspect shell source:

1. Start or model a watcher as the workspace daemon.
2. Create a deliberately private (`0600`) source file as that daemon.
3. Run Git with a human account's authorship and remote authorization while
   retaining the daemon filesystem identity; prove it can stage the file.
4. Prove authenticated fetch/push transport does not change the filesystem
   actor.
5. Repeat the boundary across Git checkout/reset, an atomic replacement, and a
   generated router file.
6. Prove newly created directories retain setgid and the mandatory default ACL.

Preview recovery has a related invariant: a failed preview must offer a working
fresh-start/retry path. Restart logic must not reject a new terminal merely
because the previous process has already failed.

## Forbidden designs

- no recursive `chown`, `chgrp`, `chmod`, or ACL repair after commands;
- no timing gap between a writer completing and a watcher gaining access;
- no reliance on a cooperative application umask alone;
- no routine source mutation under a selected human credential owner's Unix
  identity;
- no weakening the project tree to world-readable or world-writable modes;
- no application-source workaround for a host filesystem defect.

The emergency repair changed no application source, Git history, or deployment
release. The permanent implementation must preserve that ownership boundary.
