#!/usr/bin/env bash
# The real-host proof of the exec helper's managed workflows (README.md beside this file): the one test every other
# run skips, "real helper retains simultaneous workflow peak and refuses to finish populated descendants" in
# tests/server/vibe64ManagedWorkflow.unit.test.js, run inside a disposable Incus VM this launches, as a sudo-capable
# operator, against a workspace account and work slice made here. The VM is deleted by its exact name on every exit,
# a failed or interrupted proof included, and its deletion is checked.
#
# Run from any directory, on a machine whose Incus runs VMs (its own `incus`, else `sudo -n incus`), with node on PATH
# and the tree's dependencies installed (npm ci):
#   tooling/proof/systemd-workflow/run.sh
# VIBE64_PROOF_VM_IMAGE names the image (default images:ubuntu/26.04). Exit 0 only when the proof ran and passed.
set -euo pipefail

tree=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../.." && pwd -P)
image=${VIBE64_PROOF_VM_IMAGE:-images:ubuntu/26.04}
workspace=proof
operator=proof-operator
if incus list --format csv > /dev/null 2>&1; then incus=(incus); else incus=(sudo -n incus); fi
I() { "${incus[@]}" "$@" < /dev/null; }
vm=vibe64-workflow-proof-$(od -An -N4 -tx4 /dev/urandom | tr -d ' ')

cleanup() {
  local status=$?
  trap - EXIT INT TERM
  "${incus[@]}" delete --force "$vm" > /dev/null 2>&1 < /dev/null || true
  if I list "^${vm}\$" --columns n --format csv | grep -q .; then
    echo "proof: $vm was not deleted" >&2
    exit 1
  fi
  echo "proof: deleted $vm"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# The VM gets the tree as it is, so its dependencies must be installed.
[ -e "$tree/node_modules/@local/vibe64-atomic-file/package.json" ] || {
  echo "proof: install the tree's dependencies first (npm ci in $tree)" >&2; exit 2; }

# The workspace's own account is named by the helper alone (DAEMON_USERNAME_PREFIX).
prefix=$(node --input-type=module -e \
  "process.stdout.write((await import('$tree/packages/vibe64-execution/src/host/hostAccounts.js')).DAEMON_USERNAME_PREFIX)")
owner=$prefix$workspace

echo "proof: launching $vm from $image"
I launch "$image" "$vm" --vm -c limits.cpu=2 -c limits.memory=4GiB -d root,size=12GiB > /dev/null
up=0
for _ in $(seq 1 90); do I exec "$vm" -- true 2> /dev/null && { up=1; break; }; sleep 2; done
[ "$up" = 1 ] || { echo "proof: $vm's agent never answered" >&2; exit 1; }

# This machine's node, and the tree (its node_modules included, never .git) at the same path, root's and read-only to
# the operator, as a host's release is.
"${incus[@]}" file push --mode 0755 "$(command -v node)" "$vm/usr/local/bin/node"
tar -C "$tree" --exclude=./.git -cf - . | "${incus[@]}" exec "$vm" -- bash -c \
  "mkdir -p '$tree' && tar -C '$tree' --no-same-owner -xf - && chmod -R go-w '$tree'"

# Stand-ins for what a managed host's setup makes (README.md, "What is a stand-in"): the shared group and the
# workspace's own account (on a managed host, the host's account step makes it), a sudo-capable operator, and the
# workspace's work slice with the memory limit every workflow fits under.
I exec "$vm" -- bash -euo pipefail -c "
  getent group vibe64 > /dev/null || groupadd --system vibe64
  useradd --system --user-group --groups vibe64 --no-create-home --shell /usr/sbin/nologin '$owner'
  useradd --create-home --shell /bin/bash '$operator'
  echo '$operator ALL=(ALL) NOPASSWD: ALL' > /etc/sudoers.d/90-$operator
  chmod 0440 /etc/sudoers.d/90-$operator
  visudo -cq
  systemctl set-property --runtime 'vibe64-$workspace-work.slice' MemoryAccounting=yes MemoryMax=2G TasksMax=4096
  systemctl start 'vibe64-$workspace-work.slice'
  test \"\$(systemctl show 'vibe64-$workspace-work.slice' --property=MemoryMax --value)\" = 2147483648
"

uid=$(I exec "$vm" -- id -u "$operator")
log=$(mktemp)
echo "proof: running the real-host workflow proof as $operator, for $owner"
set +e
I exec "$vm" --user "$uid" --cwd "$tree" --env HOME="/home/$operator" --env PATH=/usr/local/bin:/usr/bin:/bin \
  --env VIBE64_WORKFLOW_TEST_OWNER="$owner" -- \
  node --test --test-timeout=240000 --test-reporter=spec \
  --test-name-pattern="real helper retains simultaneous workflow peak" tests/server/vibe64ManagedWorkflow.unit.test.js \
  > "$log" 2>&1
status=$?
set -e
cat "$log"
# A skip, or a pattern that matched nothing, is not a proof.
passed=$(sed -n 's/^ℹ pass \([0-9]*\)$/\1/p' "$log")
skipped=$(sed -n 's/^ℹ skipped \([0-9]*\)$/\1/p' "$log")
rm -f "$log"
[ "$status" = 0 ] || { echo "proof: failed (exit $status)" >&2; exit 1; }
[ "${passed:-0}" -ge 1 ] && [ "${skipped:-1}" = 0 ] || { echo "proof: did not run (pass ${passed:-?}, skipped ${skipped:-?})" >&2; exit 1; }
echo "proof: passed ($passed tests, none skipped)"
