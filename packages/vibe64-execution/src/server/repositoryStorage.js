import path from "node:path";

import {
  shellQuote
} from "./shellText.js";

const CANONICAL_REPOSITORY_BACKUP_NAME = "backups.git";
const CANONICAL_REPOSITORY_PUSH_OPTION = "vibe64-atomic";

const CANONICAL_REPOSITORY_BACKUP_FUNCTION_SOURCE = `backup_canonical_ref() {
  vibe64_backup_repository="$1"
  vibe64_source_repository="$2"
  vibe64_source_ref="$3"
  vibe64_expected_object="$4"
  vibe64_backup_ref="$5"

  env -u GIT_DIR -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES -u GIT_QUARANTINE_PATH \
    git --git-dir "$vibe64_backup_repository" fetch --quiet --no-tags "$vibe64_source_repository" "+$vibe64_source_ref:$vibe64_backup_ref"
  vibe64_backed_up_object="$(
    env -u GIT_DIR -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES -u GIT_QUARANTINE_PATH \
      git --git-dir "$vibe64_backup_repository" rev-parse --verify "$vibe64_backup_ref"
  )"
  if [ "$vibe64_backed_up_object" != "$vibe64_expected_object" ]; then
    printf '[vibe64] Canonical repository backup verification failed for %s.\n' "$vibe64_source_ref" >&2
    return 1
  fi
}`;

const CANONICAL_REPOSITORY_PRE_RECEIVE_HOOK_SOURCE = `#!/bin/sh
set -eu

zero_object=0000000000000000000000000000000000000000
git_dir="$(git rev-parse --absolute-git-dir)"
repository_root="$(dirname "$git_dir")"
backup_repository="$repository_root/${CANONICAL_REPOSITORY_BACKUP_NAME}"
if [ -L "$repository_root" ] || [ -L "$backup_repository" ] || [ -L "$repository_root/mutation.lock" ]; then
  printf '[vibe64] Canonical repository storage must not use symlinked role paths.\n' >&2
  exit 1
fi
exec 8>"$repository_root/mutation.lock"
flock -x 8

if [ "\${GIT_PUSH_OPTION_COUNT:-0}" != "1" ] || [ "\${GIT_PUSH_OPTION_0:-}" != "${CANONICAL_REPOSITORY_PUSH_OPTION}" ]; then
  printf '[vibe64] Canonical repository pushes must use the Vibe64 atomic mutation path.\n' >&2
  exit 1
fi
if [ "$(git --git-dir "$backup_repository" rev-parse --is-bare-repository 2>/dev/null || true)" != "true" ]; then
  printf '[vibe64] Canonical repository backup storage is missing or invalid.\n' >&2
  exit 1
fi

${CANONICAL_REPOSITORY_BACKUP_FUNCTION_SOURCE}

updates_file="$(mktemp "$repository_root/.pre-receive.XXXXXX")"
cleanup_updates_file() {
  rm -f "$updates_file"
}
trap cleanup_updates_file EXIT
cat >"$updates_file"

mutation_count=0
while read -r old_object new_object ref_name; do
  case "$ref_name" in
    refs/vibe64/*)
      printf '[vibe64] The canonical repository recovery namespace is managed by Vibe64.\n' >&2
      exit 1
      ;;
    refs/heads/*|refs/tags/*)
      mutation_count=$((mutation_count + 1))
      if [ "$new_object" = "$zero_object" ]; then
        printf '[vibe64] Canonical repository refs cannot be deleted.\n' >&2
        exit 1
      fi
      ;;
    *)
      printf '[vibe64] Canonical repository pushes may update branches or tags only.\n' >&2
      exit 1
      ;;
  esac
done <"$updates_file"
if [ "$mutation_count" -ne 1 ]; then
  printf '[vibe64] Canonical repository pushes must update exactly one ref per transaction.\n' >&2
  exit 1
fi

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
index=0
while read -r old_object _new_object ref_name; do
  if [ "$old_object" != "$zero_object" ]; then
    index=$((index + 1))
    backup_subject="\${ref_name#refs/}"
    backup_ref="refs/vibe64/backups/$backup_subject/$timestamp-$old_object-$$-$index"
    backup_canonical_ref "$backup_repository" "$git_dir" "$ref_name" "$old_object" "$backup_ref"
  fi
done <"$updates_file"
`;

const GITHUB_MIRROR_REFRESH_SCRIPT = `set -euo pipefail
mirror_path="$1"
remote_url="$2"

if [ -z "$mirror_path" ] || [ -z "$remote_url" ]; then
  printf '[studio] GitHub mirror refresh requires a mirror path and remote URL.\n' >&2
  exit 1
fi
case "$mirror_path" in
  /*/github-mirror/repository.git) ;;
  *)
    printf '[studio] Refusing an invalid GitHub mirror path: %s.\n' "$mirror_path" >&2
    exit 1
    ;;
esac
case "$mirror_path" in
  *//*|*/../*|*/./*)
    printf '[studio] Refusing a non-normalized GitHub mirror path: %s.\n' "$mirror_path" >&2
    exit 1
    ;;
esac
if ! command -v flock >/dev/null 2>&1; then
  printf '[studio] GitHub mirror refresh requires flock.\n' >&2
  exit 1
fi

mirror_parent="$(dirname "$mirror_path")"
lock_path="$mirror_parent/refresh.lock"
if [ -L "$mirror_parent" ]; then
  printf '[studio] Refusing a symlinked GitHub mirror directory: %s.\n' "$mirror_parent" >&2
  exit 1
fi
mkdir -p "$mirror_parent"
if [ -L "$lock_path" ]; then
  printf '[studio] Refusing a symlinked GitHub mirror lock: %s.\n' "$lock_path" >&2
  exit 1
fi
exec 9>"$lock_path"
flock -x 9

if [ -L "$mirror_path" ]; then
  printf '[studio] Replacing symlinked disposable GitHub mirror %s.\n' "$mirror_path" >&2
  rm -f "$mirror_path"
elif [ -e "$mirror_path" ] && [ "$(git --git-dir "$mirror_path" rev-parse --is-bare-repository 2>/dev/null || true)" != "true" ]; then
  printf '[studio] Replacing invalid disposable GitHub mirror %s.\n' "$mirror_path" >&2
  rm -rf "$mirror_path"
fi

if [ ! -d "$mirror_path" ]; then
  staging_root="$(mktemp -d "$mirror_parent/.refresh.XXXXXX")"
  cleanup_github_mirror_staging() {
    rm -rf "$staging_root"
  }
  trap cleanup_github_mirror_staging EXIT
  git clone --bare "$remote_url" "$staging_root/repository.git"
  mv "$staging_root/repository.git" "$mirror_path"
  rmdir "$staging_root"
  staging_root=
  trap - EXIT
  printf '[studio] Created GitHub mirror for %s.\n' "$remote_url"
  exit 0
fi

if git --git-dir "$mirror_path" remote get-url origin >/dev/null 2>&1; then
  git --git-dir "$mirror_path" remote set-url origin "$remote_url"
else
  git --git-dir "$mirror_path" remote add origin "$remote_url"
fi
git --git-dir "$mirror_path" fetch --prune --atomic origin '+refs/heads/*:refs/heads/*' '+refs/tags/*:refs/tags/*'
remote_head_ref="$(git --git-dir "$mirror_path" ls-remote --symref origin HEAD 2>/dev/null | sed -n 's/^ref: \\(refs\\/heads\\/[^[:space:]]*\\)[[:space:]][[:space:]]*HEAD$/\\1/p' | head -n 1 || true)"
case "$remote_head_ref" in
  refs/heads/*)
    git --git-dir "$mirror_path" symbolic-ref HEAD "$remote_head_ref"
    ;;
esac
printf '[studio] Refreshed GitHub mirror for %s.\n' "$remote_url"
`;

function canonicalRepositoryBackupPath(repositoryPath = "") {
  return repositoryPath
    ? path.join(path.dirname(repositoryPath), CANONICAL_REPOSITORY_BACKUP_NAME)
    : "";
}

function canonicalRepositoryPathGuardScript() {
  return [
    "case \"$CANONICAL_REPOSITORY_PATH\" in",
    "  /*/canonical-repository/repository.git) ;;",
    "  *)",
    "    printf '[vibe64] Refusing an invalid canonical repository path: %s.\\n' \"$CANONICAL_REPOSITORY_PATH\" >&2",
    "    exit 1",
    "    ;;",
    "esac",
    "case \"$CANONICAL_REPOSITORY_PATH\" in",
    "  *//*|*/../*|*/./*)",
    "    printf '[vibe64] Refusing a non-normalized canonical repository path: %s.\\n' \"$CANONICAL_REPOSITORY_PATH\" >&2",
    "    exit 1",
    "    ;;",
    "esac"
  ];
}

function canonicalRepositoryInitializeScript({
  defaultBranch = "main",
  repositoryPath = ""
} = {}) {
  return [
    "set -euo pipefail",
    `CANONICAL_REPOSITORY_PATH=${shellQuote(repositoryPath)}`,
    `CANONICAL_DEFAULT_BRANCH=${shellQuote(defaultBranch || "main")}`,
    `CANONICAL_BACKUP_NAME=${shellQuote(CANONICAL_REPOSITORY_BACKUP_NAME)}`,
    "if [ -z \"$CANONICAL_REPOSITORY_PATH\" ]; then",
    "  printf '[vibe64] Canonical repository path is required.\\n' >&2",
    "  exit 1",
    "fi",
    ...canonicalRepositoryPathGuardScript(),
    "git check-ref-format --branch \"$CANONICAL_DEFAULT_BRANCH\" >/dev/null",
    "CANONICAL_REPOSITORY_ROOT=\"$(dirname \"$CANONICAL_REPOSITORY_PATH\")\"",
    "CANONICAL_BACKUP_PATH=\"$CANONICAL_REPOSITORY_ROOT/$CANONICAL_BACKUP_NAME\"",
    "if [ -L \"$CANONICAL_REPOSITORY_ROOT\" ]; then",
    "  printf '[vibe64] Refusing a symlinked canonical repository directory: %s.\\n' \"$CANONICAL_REPOSITORY_ROOT\" >&2",
    "  exit 1",
    "fi",
    "mkdir -p \"$CANONICAL_REPOSITORY_ROOT\"",
    "if ! command -v flock >/dev/null 2>&1; then",
    "  printf '[vibe64] Canonical repository initialization requires flock.\\n' >&2",
    "  exit 1",
    "fi",
    "if [ -L \"$CANONICAL_REPOSITORY_ROOT/mutation.lock\" ]; then",
    "  printf '[vibe64] Refusing a symlinked canonical repository lock.\\n' >&2",
    "  exit 1",
    "fi",
    "exec 9>\"$CANONICAL_REPOSITORY_ROOT/mutation.lock\"",
    "flock -x 9",
    "initialize_bare_repository() {",
    "  repository_path=\"$1\"",
    "  repository_label=\"$2\"",
    "  if [ -L \"$repository_path\" ]; then",
    "    printf '[vibe64] %s path must not be a symlink: %s\\n' \"$repository_label\" \"$repository_path\" >&2",
    "    exit 1",
    "  fi",
    "  if [ -e \"$repository_path\" ]; then",
    "    if [ \"$(git --git-dir \"$repository_path\" rev-parse --is-bare-repository 2>/dev/null || true)\" != \"true\" ]; then",
    "      printf '[vibe64] %s path is not a bare Git repository: %s\\n' \"$repository_label\" \"$repository_path\" >&2",
    "      exit 1",
    "    fi",
    "    return 0",
    "  fi",
    "  staging_root=\"$(mktemp -d \"$CANONICAL_REPOSITORY_ROOT/.initialize.XXXXXX\")\"",
    "  cleanup_canonical_staging() {",
    "    rm -rf \"$staging_root\"",
    "  }",
    "  trap cleanup_canonical_staging EXIT",
    "  git init --bare --initial-branch=\"$CANONICAL_DEFAULT_BRANCH\" \"$staging_root/repository.git\"",
    "  mv \"$staging_root/repository.git\" \"$repository_path\"",
    "  rmdir \"$staging_root\"",
    "  staging_root=",
    "  trap - EXIT",
    "}",
    "initialize_bare_repository \"$CANONICAL_REPOSITORY_PATH\" 'Canonical repository'",
    "initialize_bare_repository \"$CANONICAL_BACKUP_PATH\" 'Canonical repository backup'",
    "git --git-dir \"$CANONICAL_REPOSITORY_PATH\" symbolic-ref HEAD \"refs/heads/$CANONICAL_DEFAULT_BRANCH\"",
    "git --git-dir \"$CANONICAL_REPOSITORY_PATH\" config core.logAllRefUpdates always",
    "git --git-dir \"$CANONICAL_REPOSITORY_PATH\" config gc.reflogExpire never",
    "git --git-dir \"$CANONICAL_REPOSITORY_PATH\" config gc.reflogExpireUnreachable never",
    "git --git-dir \"$CANONICAL_REPOSITORY_PATH\" config receive.advertiseAtomic true",
    "git --git-dir \"$CANONICAL_REPOSITORY_PATH\" config receive.advertisePushOptions true",
    "git --git-dir \"$CANONICAL_REPOSITORY_PATH\" config receive.denyDeletes true",
    "git --git-dir \"$CANONICAL_REPOSITORY_PATH\" config receive.denyNonFastForwards true",
    "git --git-dir \"$CANONICAL_REPOSITORY_PATH\" config --unset-all core.hooksPath >/dev/null 2>&1 || true",
    "git --git-dir \"$CANONICAL_BACKUP_PATH\" config core.logAllRefUpdates always",
    "git --git-dir \"$CANONICAL_BACKUP_PATH\" config gc.reflogExpire never",
    "git --git-dir \"$CANONICAL_BACKUP_PATH\" config gc.reflogExpireUnreachable never",
    "if [ -L \"$CANONICAL_REPOSITORY_PATH/hooks\" ]; then",
    "  printf '[vibe64] Canonical repository hooks directory must not be a symlink.\\n' >&2",
    "  exit 1",
    "fi",
    "CANONICAL_HOOK_PATH=\"$CANONICAL_REPOSITORY_PATH/hooks/pre-receive\"",
    "CANONICAL_HOOK_TEMP=\"$CANONICAL_HOOK_PATH.vibe64.$$\"",
    "cleanup_canonical_hook_temp() {",
    "  rm -f \"$CANONICAL_HOOK_TEMP\"",
    "}",
    "trap cleanup_canonical_hook_temp EXIT",
    "umask 077",
    "cat >\"$CANONICAL_HOOK_TEMP\" <<'VIBE64_CANONICAL_PRE_RECEIVE'",
    CANONICAL_REPOSITORY_PRE_RECEIVE_HOOK_SOURCE.trimEnd(),
    "VIBE64_CANONICAL_PRE_RECEIVE",
    "chmod 700 \"$CANONICAL_HOOK_TEMP\"",
    "mv \"$CANONICAL_HOOK_TEMP\" \"$CANONICAL_HOOK_PATH\"",
    "trap - EXIT",
    "printf '[vibe64] Canonical repository is ready at %s.\\n' \"$CANONICAL_REPOSITORY_PATH\""
  ].join("\n");
}

function canonicalRepositoryInstallRefScript({
  allowNonFastForward = false,
  repositoryPath = "",
  sourceRef = "",
  sourceRepository = "",
  targetRef = ""
} = {}) {
  return [
    "set -euo pipefail",
    `CANONICAL_REPOSITORY_PATH=${shellQuote(repositoryPath)}`,
    `CANONICAL_SOURCE_REPOSITORY=${shellQuote(sourceRepository)}`,
    `CANONICAL_SOURCE_REF=${shellQuote(sourceRef)}`,
    `CANONICAL_TARGET_REF=${shellQuote(targetRef)}`,
    `CANONICAL_ALLOW_NON_FAST_FORWARD=${allowNonFastForward ? "yes" : "no"}`,
    `CANONICAL_BACKUP_NAME=${shellQuote(CANONICAL_REPOSITORY_BACKUP_NAME)}`,
    "if [ -z \"$CANONICAL_REPOSITORY_PATH\" ] || [ -z \"$CANONICAL_SOURCE_REPOSITORY\" ] || [ -z \"$CANONICAL_SOURCE_REF\" ] || [ -z \"$CANONICAL_TARGET_REF\" ]; then",
    "  printf '[vibe64] Canonical repository ref installation requires complete source and target details.\\n' >&2",
    "  exit 1",
    "fi",
    ...canonicalRepositoryPathGuardScript(),
    "git check-ref-format \"$CANONICAL_SOURCE_REF\" >/dev/null",
    "case \"$CANONICAL_TARGET_REF\" in",
    "  refs/heads/*) ;;",
    "  *)",
    "    printf '[vibe64] Canonical repository installations require a branch target.\\n' >&2",
    "    exit 1",
    "    ;;",
    "esac",
    "if [ \"$(git --git-dir \"$CANONICAL_REPOSITORY_PATH\" rev-parse --is-bare-repository 2>/dev/null || true)\" != \"true\" ]; then",
    "  printf '[vibe64] Canonical repository is missing or invalid: %s\\n' \"$CANONICAL_REPOSITORY_PATH\" >&2",
    "  exit 1",
    "fi",
    "CANONICAL_REPOSITORY_ROOT=\"$(dirname \"$CANONICAL_REPOSITORY_PATH\")\"",
    "CANONICAL_BACKUP_PATH=\"$CANONICAL_REPOSITORY_ROOT/$CANONICAL_BACKUP_NAME\"",
    "if [ -L \"$CANONICAL_REPOSITORY_ROOT\" ] || [ -L \"$CANONICAL_REPOSITORY_PATH\" ] || [ -L \"$CANONICAL_BACKUP_PATH\" ] || [ -L \"$CANONICAL_REPOSITORY_ROOT/mutation.lock\" ]; then",
    "  printf '[vibe64] Canonical repository storage must not use symlinked role paths.\\n' >&2",
    "  exit 1",
    "fi",
    "if [ \"$(git --git-dir \"$CANONICAL_BACKUP_PATH\" rev-parse --is-bare-repository 2>/dev/null || true)\" != \"true\" ]; then",
    "  printf '[vibe64] Canonical repository backup storage is missing or invalid: %s\\n' \"$CANONICAL_BACKUP_PATH\" >&2",
    "  exit 1",
    "fi",
    "if ! command -v flock >/dev/null 2>&1; then",
    "  printf '[vibe64] Canonical repository ref installation requires flock.\\n' >&2",
    "  exit 1",
    "fi",
    "exec 9>\"$CANONICAL_REPOSITORY_ROOT/mutation.lock\"",
    "flock -x 9",
    "CANONICAL_INCOMING_REF=\"refs/vibe64/incoming/install-$$\"",
    "cleanup_canonical_incoming_ref() {",
    "  git --git-dir \"$CANONICAL_REPOSITORY_PATH\" update-ref -d \"$CANONICAL_INCOMING_REF\" >/dev/null 2>&1 || true",
    "}",
    "trap cleanup_canonical_incoming_ref EXIT",
    "git --git-dir \"$CANONICAL_REPOSITORY_PATH\" fetch --no-tags \"$CANONICAL_SOURCE_REPOSITORY\" \"+$CANONICAL_SOURCE_REF:$CANONICAL_INCOMING_REF\"",
    "CANONICAL_NEW_OBJECT=\"$(git --git-dir \"$CANONICAL_REPOSITORY_PATH\" rev-parse \"$CANONICAL_INCOMING_REF^{commit}\")\"",
    "CANONICAL_OLD_OBJECT=\"$(git --git-dir \"$CANONICAL_REPOSITORY_PATH\" rev-parse --verify \"$CANONICAL_TARGET_REF^{commit}\" 2>/dev/null || true)\"",
    "if [ -n \"$CANONICAL_OLD_OBJECT\" ] && [ \"$CANONICAL_ALLOW_NON_FAST_FORWARD\" != \"yes\" ] && ! git --git-dir \"$CANONICAL_REPOSITORY_PATH\" merge-base --is-ancestor \"$CANONICAL_OLD_OBJECT\" \"$CANONICAL_NEW_OBJECT\"; then",
    "  printf '[vibe64] Canonical repository branch updates must be fast-forwards.\\n' >&2",
    "  exit 1",
    "fi",
    CANONICAL_REPOSITORY_BACKUP_FUNCTION_SOURCE,
    "if [ -n \"$CANONICAL_OLD_OBJECT\" ]; then",
    "  CANONICAL_TIMESTAMP=\"$(date -u +%Y%m%dT%H%M%SZ)\"",
    "  CANONICAL_BACKUP_SUBJECT=\"${CANONICAL_TARGET_REF#refs/}\"",
    "  CANONICAL_BACKUP_REF=\"refs/vibe64/backups/$CANONICAL_BACKUP_SUBJECT/$CANONICAL_TIMESTAMP-$CANONICAL_OLD_OBJECT-$$\"",
    "  backup_canonical_ref \"$CANONICAL_BACKUP_PATH\" \"$CANONICAL_REPOSITORY_PATH\" \"$CANONICAL_TARGET_REF\" \"$CANONICAL_OLD_OBJECT\" \"$CANONICAL_BACKUP_REF\"",
    "fi",
    "{",
    "  printf 'start\\n'",
    "  if [ -n \"$CANONICAL_OLD_OBJECT\" ]; then",
    "    printf 'update %s %s %s\\n' \"$CANONICAL_TARGET_REF\" \"$CANONICAL_NEW_OBJECT\" \"$CANONICAL_OLD_OBJECT\"",
    "  else",
    "    printf 'create %s %s\\n' \"$CANONICAL_TARGET_REF\" \"$CANONICAL_NEW_OBJECT\"",
    "  fi",
    "  printf 'delete %s %s\\n' \"$CANONICAL_INCOMING_REF\" \"$CANONICAL_NEW_OBJECT\"",
    "  printf 'prepare\\ncommit\\n'",
    "} | git --git-dir \"$CANONICAL_REPOSITORY_PATH\" update-ref --stdin",
    "trap - EXIT",
    "printf '%s\\n' \"$CANONICAL_NEW_OBJECT\""
  ].join("\n");
}

function githubMirrorRefreshInvocation({
  mirrorPath = "",
  remoteUrl = ""
} = {}) {
  return [
    "bash",
    "-c",
    GITHUB_MIRROR_REFRESH_SCRIPT,
    "vibe64-github-mirror-refresh",
    mirrorPath,
    remoteUrl
  ];
}

const __testables = Object.freeze({ CANONICAL_REPOSITORY_PUSH_OPTION, canonicalRepositoryBackupPath });

export {
  GITHUB_MIRROR_REFRESH_SCRIPT,
  canonicalRepositoryInitializeScript,
  canonicalRepositoryInstallRefScript,
  githubMirrorRefreshInvocation,
  __testables
};
