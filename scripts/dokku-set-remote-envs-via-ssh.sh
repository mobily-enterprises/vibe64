#!/usr/bin/env bash
set -Eeuo pipefail

usage() {
  cat <<'EOF'
Usage:
  scripts/dokku-set-remote-envs-via-ssh.sh <ssh-target> <public-host>

Reads the allowlisted deploy env vars from .env, derives APP_PUBLIC_URL from
the public host, and pushes them to the remote Dokku app with --no-restart.

Examples:
  scripts/dokku-set-remote-envs-via-ssh.sh dokku@example.com beepollen.appgenius.biz
  scripts/dokku-set-remote-envs-via-ssh.sh dokku@example.com https://beepollen.appgenius.biz
EOF
}

die() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Required command not found: $1"
}

resolve_script_dir() {
  cd -- "$(dirname -- "$0")" && pwd
}

if [[ $# -eq 0 ]]; then
  usage
  exit 1
fi

case "${1:-}" in
  -h|--help)
    usage
    exit 0
    ;;
esac

if [[ $# -ne 2 ]]; then
  usage
  exit 1
fi

require_cmd ssh
require_cmd node

SSH_TARGET="$1"
PUBLIC_HOST_INPUT="$2"
SCRIPT_DIR="$(resolve_script_dir)"
APP_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"

case "$PUBLIC_HOST_INPUT" in
  http://*|https://*)
    APP_PUBLIC_URL="$PUBLIC_HOST_INPUT"
    ;;
  *)
    APP_PUBLIC_URL="https://${PUBLIC_HOST_INPUT}"
    ;;
esac

APP_NAME="$(node - "$APP_ROOT" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");

const appRoot = process.argv[2];

function readNameFromJson(relativePath) {
  const absolutePath = path.join(appRoot, relativePath);
  if (!fs.existsSync(absolutePath)) {
    return "";
  }
  const source = JSON.parse(fs.readFileSync(absolutePath, "utf8"));
  return String(source?.name || "").trim();
}

const appName = readNameFromJson("app.json") || readNameFromJson("package.json");
if (!appName) {
  console.error("Unable to resolve app name from app.json or package.json.");
  process.exit(1);
}

process.stdout.write(appName);
NODE
)"

set_remote_env() {
  local key="$1"
  local encoded_value="$2"

  ssh "$SSH_TARGET" /bin/bash -s -- "$APP_NAME" "$key" "$encoded_value" <<'EOF'
set -Eeuo pipefail

APP_NAME="$1"
KEY="$2"
ENCODED_VALUE="$3"

command -v dokku >/dev/null 2>&1 || {
  printf 'dokku command not found on remote host.\n' >&2
  exit 1
}

dokku config:set --no-restart --encoded "$APP_NAME" "$KEY=$ENCODED_VALUE" >/dev/null
EOF
}

while IFS=$'\t' read -r key encoded_value; do
  [[ -n "$key" ]] || continue
  set_remote_env "$key" "$encoded_value"
  printf 'Set %s on %s\n' "$key" "$APP_NAME"
done < <(node - "$APP_ROOT" "$APP_PUBLIC_URL" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");

const appRoot = process.argv[2];
const appPublicUrl = String(process.argv[3] || "").trim();
const envPath = path.join(appRoot, ".env");

const requiredKeys = Object.freeze([
  "AUTH_PROFILE_MODE",
  "AUTH_SUPABASE_URL",
  "AUTH_SUPABASE_PUBLISHABLE_KEY"
]);

const optionalKeys = Object.freeze([
  "AI_PROVIDER",
  "AI_API_KEY",
  "AI_BASE_URL",
  "AI_TIMEOUT_MS",
  "AUTH_OAUTH_PROVIDERS",
  "AUTH_OAUTH_DEFAULT_PROVIDER",
  "AUTH_JWT_AUDIENCE"
]);

function parseDotEnv(source) {
  const result = new Map();

  for (const rawLine of String(source || "").split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const normalizedLine = line.startsWith("export ") ? line.slice(7).trim() : line;
    const equalsIndex = normalizedLine.indexOf("=");
    if (equalsIndex < 1) {
      continue;
    }

    const key = normalizedLine.slice(0, equalsIndex).trim();
    let value = normalizedLine.slice(equalsIndex + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }

    result.set(key, value);
  }

  return result;
}

function toBase64(value) {
  return Buffer.from(String(value || ""), "utf8").toString("base64");
}

if (!fs.existsSync(envPath)) {
  console.error("Missing .env in app root.");
  process.exit(1);
}

if (!appPublicUrl) {
  console.error("APP_PUBLIC_URL is required.");
  process.exit(1);
}

const envMap = parseDotEnv(fs.readFileSync(envPath, "utf8"));
const rows = [["APP_PUBLIC_URL", toBase64(appPublicUrl)]];

for (const key of requiredKeys) {
  const value = String(envMap.get(key) || "").trim();
  if (!value) {
    console.error(`Missing required .env value: ${key}`);
    process.exit(1);
  }
  rows.push([key, toBase64(value)]);
}

for (const key of optionalKeys) {
  const value = String(envMap.get(key) || "").trim();
  if (!value) {
    continue;
  }
  rows.push([key, toBase64(value)]);
}

for (const [key, encodedValue] of rows) {
  process.stdout.write(`${key}\t${encodedValue}\n`);
}
NODE
)

printf '\nDone.\n'
printf 'Restart when ready:\n'
printf '  ssh %q %q\n' "$SSH_TARGET" "dokku ps:restart $APP_NAME"
