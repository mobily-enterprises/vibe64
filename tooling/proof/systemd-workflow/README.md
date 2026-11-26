# The managed workflow proof on a real systemd

`tests/server/vibe64ManagedWorkflow.unit.test.js` has one test no ordinary run
can make: **real helper retains simultaneous workflow peak and refuses to finish
populated descendants**. It drives the exec helper as root through `sudo -n`,
for a workspace's own account, against that workspace's work slice. It checks
that a workflow's accounting group gets its MemoryMax and TasksMax, that two
executions in it share and keep their peak, that live growth raises only the
group and the requested execution, that stale or foreign growth is refused, and
that a workflow whose executions still run cannot finish. Every other run, CI
included, skips it, because none has root's systemd, `sudo -n` or a workspace
account.

`run.sh` runs that test where it can run: inside a disposable Incus VM it
launches, then deletes by its exact name on every exit, failures and
interruptions included, and checks the VM is gone. It needs a machine whose
Incus runs VMs (its own `incus`, else `sudo -n incus`), `node` on PATH and the
tree's dependencies installed (`npm ci`), which the VM gets with the tree:

```sh
tooling/proof/systemd-workflow/run.sh
```

`VIBE64_PROOF_VM_IMAGE` names the image (default `images:ubuntu/26.04`). It
exits 0 only when the test ran and passed; a skip, or a name that matches no
test, fails it.

## What it covers, and what is a stand-in

Inside the VM, `run.sh` makes what a managed host's setup would make, by hand:

- **The workspace's own account** (the helper's `DAEMON_USERNAME_PREFIX` and
  `proof`) and the shared `vibe64` group. On a managed host, the host's account
  step makes that account (mobilynet's accounts work-area), and mobilynet's own
  tests prove that step. The account made here only stands in for it.
- **A sudo-capable operator** who runs the test, as on a managed host, where
  the person running it is never root and never the workspace's account.
- **The workspace's work slice**, `vibe64-proof-work.slice`, with a 2 GiB
  MemoryMax, as host setup leaves it. The helper reads that limit and refuses a
  workflow above it.

The proof covers public's helper on a real systemd: its workflow groups under
the work slice, their MemoryMax and TasksMax, the `sudo -n` units, live growth
and its refusals, and finishing. It does not prove how a host makes the account
or the slice.

## In a combined run

It is a VM step: a test runner gives it a VM-capable machine of its own (for
example a lane that only VM work takes) and runs `run.sh` from the tree being
tested. The test's other cases run in the ordinary suites, so this step runs
only the real-host case.
