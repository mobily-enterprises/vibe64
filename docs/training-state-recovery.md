# Back up and restore private learning state

This explicit operator procedure covers the current schema-version-1 reservation
store. Project archives and installed-content snapshots do not back up
`training/users`. Use trusted local checkpoint directories owned by the same OS
user as the state; do not import an archive or another installation's identities.
There is no automatic backup, retention or rollback service.

Stop the application and every independent reserve/resume or maintenance writer.
Keep them stopped and exclude activation until verification finishes. Online's
host-specific steps are in its deployment state-upgrade guide. User locks alone
cannot exclude a new learner directory or a noncooperating writer.

Run these Bash blocks in one shell as the state-owning OS user, with compatible
Node 26 and the reviewed Vibe64 packages installed. Set `system_root` to the
canonical installation state path, `application_root` to the directory providing
those packages, and `backup_root` to an existing private directory outside
`system_root`. Check actual ownership, 0700 backup permissions and canonical
paths first. These are operator-selected paths, never request parameters; do not
repair permissions recursively to make this procedure run.

```bash
set -euo pipefail
umask 077
: "${system_root:?}" "${application_root:?}" "${backup_root:?}"
test "$(realpath -e -- "$system_root")" = "$system_root"
test "$(realpath -e -- "$system_root/training")" = "$system_root/training"
test "$(realpath -e -- "$backup_root")" = "$backup_root"
case "$backup_root" in "$system_root"|"$system_root"/*) exit 1 ;; esac
cd -- "$application_root"
users="$system_root/training/users"
test ! -L "$users"
if test -e "$users"; then
  test -d "$users"
fi

# Hold existing persistent lock inodes; never create or unlink a state lock.
shopt -s nullglob dotglob
held_locks=()
for lock_file in "$users"/*/state.lock; do
  test ! -L "$(dirname -- "$lock_file")"
  test -f "$lock_file"
  test ! -L "$lock_file"
  test ! -s "$lock_file"
  exec {lock_fd}<"$lock_file"
  flock --exclusive --nonblock "$lock_fd"
  held_locks+=("$lock_fd")
done
```

Absent `training/users` means no learner state to copy. An unsafe or contended
lock means stop and investigate without deleting it. Malformed record bytes can
still be copied as evidence; copying does not declare them restorable.

Create a new checkpoint. `cp -a` preserves bytes and modes, including corrupt
records and links as evidence, without following those links. An interrupted copy
is incomplete: retain it for inspection and use a new checkpoint next time.
Never merge another copy into an existing checkpoint.

```bash
if test ! -d "$users"; then
  echo 'No learner state to copy; no checkpoint created.'
  exit 0
fi
checkpoint="$(mktemp -d "$backup_root/users.XXXXXXXX")"
mkdir -- "$checkpoint/training"
cp -a -- "$users" "$checkpoint/training/users"
printf 'Copy completed: %s\n' "$checkpoint"
```

For restore, deliberately select a known completed checkpoint. Re-establish the
same stopped-writer conditions and locks, then stage a copy on the live
filesystem, keeping the checkpoint unchanged.

```bash
: "${checkpoint:?}"
test "$(realpath -e -- "$checkpoint")" = "$checkpoint"
test -d "$checkpoint/training/users"
test ! -L "$checkpoint/training/users"
stage="$(mktemp -d "$system_root/training/.users-restore.XXXXXXXX")"
mkdir -- "$stage/training"
cp -a -- "$checkpoint/training/users" "$stage/training/users"
```

Validate the candidate through the existing readers before touching live state.
The function also verifies every saved published topic/lesson pin against the
live installed content. It creates no project, runs no check, repairs no summary
and prints no record bodies. It can assess a completed checkpoint too.

```bash
validate_copy() {
  node --input-type=module - "$1" "$system_root" <<'NODE'
import { readdir } from "node:fs/promises";
import path from "node:path";
import { createTrainingLearnerState } from "@local/vibe64-training/server/learner-state";
import { createInstalledTrainingContent } from "@local/vibe64-training/server/installed-content";
const [copyRoot, liveRoot] = process.argv.slice(2);
const state = createTrainingLearnerState({ systemRoot: copyRoot });
const content = createInstalledTrainingContent({ systemRoot: liveRoot });
for (const key of await readdir(path.join(copyRoot, "training/users"))) {
  const identity = Buffer.from(key, "base64url").toString("utf8");
  if (Buffer.from(identity).toString("base64url") !== key) throw new Error("Noncanonical learner key; inspect the checkpoint.");
  const { progress } = await state.readState({ actor: { username: identity } });
  for (const { pin } of progress.attempts) {
    await content.readLesson({ ...pin.topic, lessonCode: pin.lesson.code, lessonHash: pin.lesson.hash });
  }
}
console.log("Reservation records and installed pins validated; no files changed.");
NODE
}
validate_copy "$stage"
```

Failure leaves the application stopped, with the checkpoint, stage and live
files preserved. Install a missing exact pinned revision through the explicit
owner workflow before retrying validation. Never substitute a newer release or
edit IDs, revisions, pins or malformed records to pass validation. Missing or
valid stale summaries remain unchanged; the next explicit reserve/resume may
reconcile them through the normal locked operation.

After successful validation, preserve the live tree and publish the candidate.
This is **two renames with a gap**, not an atomic directory exchange. Keep all
writers stopped. The quarantine destination must not already exist.

```bash
old_tree="$stage/previous-users"
test ! -e "$old_tree"
test ! -L "$old_tree"
if test -e "$users"; then
  mv -T -- "$users" "$old_tree"
fi
mv -T -- "$stage/training/users" "$users"
validate_copy "$system_root"
```

If interrupted after the first rename, `previous-users` holds the original and
`stage/training/users` holds the candidate. Keep the service stopped. Inspect
those exact paths and revalidate before deliberately finishing the second rename.
To abandon an unpublished candidate, verify `users` is absent, then move
`previous-users` back to `users`. If `users` already exists, stop: do not merge,
overwrite or delete either tree. A post-publication validation failure likewise
requires deliberate inspection with all copies preserved and writers stopped.

If live `users` was already absent, restore publishes the validated candidate
without an original-tree rename; `previous-users` remains absent. An interruption
before publication keeps the candidate in the stage and the live path absent.
Do not create empty progress to fill that gap. A symlink or non-directory live
path is refused by setup, not replaced. Backup of an absent namespace reports
no state and creates no checkpoint.

Retain the checkpoint and original according to the operator's private retention
policy. Close the maintenance shell to release its user locks. The host owner
releases activation exclusion and starts only the verified compatible application.
Copied empty lock files are safe only after all previous lock owners have stopped;
never unlink a live lock to clear contention.

This covers reservation state only. Off-host backups, power-loss durability and
coordinated restores of future project effects or assessments remain separate
owner responsibilities.
