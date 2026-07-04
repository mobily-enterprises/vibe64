# Vibe64 VPS Infrastructure Plan

This note preserves the infrastructure planning decisions discussed for running
Vibe64 Online on small, real VPS instances.

It is intentionally separate from `REAL_OS_USER_CREDENTIALS_PLAN.md`.
That plan owns the Vibe64 runtime/user/credential model inside a VM. This file
owns the host/VPS layer: what virtualization to use, how memory and disk should
be compressed, and what density numbers are realistic.

## Goal

Vibe64 Online should be deployable as real VPSes in the smallest practical
shape while still satisfying the credential/compliance model:

- users get a real VM boundary, not an app-only sandbox
- provider credentials live in real OS homes inside that VM
- containers are only for tool/runtime packaging
- the host can run many isolated Vibe64 Online VPSes per physical server
- the platform has a defensible answer for sizing and density

## Key Boundary

The physical server is the VPS host.

Each customer/owner/deployment gets a real VPS. Inside that VPS, Vibe64 runs
with real OS users, real home directories, and normal Linux credential files.

Containers may run inside the VPS for Node, Laravel, MariaDB, Codex binaries,
Claude/GLM tools, build tooling, previews, and app runtimes. Containers must not
be treated as the credential boundary. The credential boundary is the VM and the
OS users inside it.

In this model, a VPS customer may have root on their VPS. If they have root,
Vibe64 cannot make provider-policy violations technically impossible. Stock
Vibe64 must enforce compliant behavior, but root-controlled modified deployments
are the customer's responsibility.

## Virtualization Choice

Use real KVM virtual machines for the VPS boundary.

Recommended first implementation:

```text
Incus-managed KVM VMs
```

Why:

- it provides real VM isolation with a separate kernel/rootfs/init/network
- it is operationally simpler than building a Firecracker platform first
- it supports images, profiles, limits, storage pools, snapshots, and lifecycle
  management
- it keeps the product on a normal VPS architecture while still allowing high
  density

Possible later implementation:

```text
Firecracker or Cloud Hypervisor behind the same VPS runner interface
```

Do not start there unless Incus/KVM overhead proves to be the actual bottleneck.
The first bottleneck is more likely to be active AI/tool workloads and memory
pressure, not the VM monitor itself.

## VM Shape

Initial planning shape for a small active Vibe64 Online VPS:

```text
RAM target: 2 GB average active working set
vCPU target: shared/oversubscribed, workload-dependent
disk: thin-provisioned compressed rootfs plus project/service data
```

The 2 GB number is a planning average, not a hard guarantee. Some sessions will
fit below it; heavy app builds, databases, dev servers, browsers, or multiple
tool sessions can exceed it.

Set hard caps and monitor real workloads. The host must enforce memory and CPU
limits at the VM level so one VPS cannot consume the metal.

## Memory Compression

Use memory compression at the host layer.

Recommended:

```text
host zram: enabled
guest zram: enabled by default, conservative size
guest disk swap: disabled by default
```

Host zram is the primary pressure buffer for the physical server. It helps when
many VPSes have bursty memory use.

Guest zram is useful on top of host compression because it lets an individual
VPS absorb short spikes without immediately OOM-killing processes. It should be
configured conservatively, for example 25-50% of guest RAM, because it is not
free capacity. It consumes CPU and can stack compression overhead with the host.

Do not use normal disk swap inside guests by default. Disk swap can keep a VPS
technically alive while making it unusably slow and creating host IO pressure.

Important planning rule:

Memory compression improves burst tolerance. It does not double the safe number
of active users. Capacity should still be planned from the uncompressed working
set plus measured compression ratios.

## Disk Compression

Use a compressed, thin-provisioned host filesystem/storage pool.

Recommended first choice:

```text
ZFS with compression=zstd
```

Acceptable alternative:

```text
Btrfs with compression=zstd
```

Why ZFS is preferred:

- mature compression and snapshots
- good clone/send/receive story
- predictable storage pool management
- useful quotas/reservations per VPS dataset or volume
- good operational tooling for a VPS farm

Use golden images and clone/reflink/snapshot based provisioning so idle or new
VPSes do not consume a full rootfs each.

Keep project repositories and service data inside the VPS or on explicitly
owned per-VPS volumes according to the real OS credential/storage plan. Do not
put provider credentials in shared host storage.

## Physical Host Planning

Baseline metal:

```text
RAM: 128 GB
storage: compressed ZFS pool
virtualization: Incus-managed KVM
```

Safe active VPS planning for 2 GB average working set:

```text
40 running VPSes: conservative
45 running VPSes: normal cap
50 running VPSes: planned burst / upper target
55 running VPSes: hard stop territory unless measured data proves otherwise
```

This leaves room for:

- host OS
- Incus/KVM overhead
- filesystem cache
- zram metadata/CPU overhead
- monitoring/logging
- short workload spikes
- VMs temporarily exceeding their average

With memory compression, 50 concurrent active VPSes on a 128 GB host is a
reasonable planning target, not a guarantee. The practical cap should be
enforced by live telemetry: memory pressure, swap/zram pressure, IO latency,
CPU steal/ready time, and OOM events.

## Total Account Planning

Do not confuse total accounts/VPSes with concurrently running VPSes.

For one 128 GB physical server:

```text
running active VPS cap: about 40-50
total dormant/light accounts: 500 conservative
total dormant/light accounts: 1000 plausible
total dormant/light accounts: 2000+ only with strong idle shutdown and telemetry
```

Total accounts are mostly a disk/metadata/support problem if idle VPSes are
stopped. Running active VPSes are the memory/CPU problem.

Idle shutdown is required for high total account counts. A server cannot keep
hundreds of 2 GB VPSes running at once.

## User Activity Planning

Terminology:

```text
concurrent = active at the same time
DAU = daily active users
MAU = monthly active users
```

For a tool like Vibe64, a rough planning range:

```text
50 concurrent active VPSes ~= 130-250 DAU
50 concurrent active VPSes ~= 500-1000 MAU
```

Use the lower end for safety:

```text
one 128 GB server with 50 running VPSes
  -> about 100-130 DAU safely
  -> about 500-650 MAU safely
```

The higher end, around 1000 MAU, is plausible if usage is light, idle shutdown
works well, and users are spread across timezones. It should not be the first
capacity promise.

## Scheduling And Shutdown

The platform should distinguish:

- provisioned VPS
- stopped VPS
- booting VPS
- active VPS
- idle VPS pending shutdown

Policy:

- boot on demand
- keep recently active VPSes warm for a short period
- shut down idle VPSes aggressively enough to maintain the active cap
- refuse or queue starts when host pressure is too high
- move heavy customers to dedicated/larger hosts when needed

The host scheduler should be able to say:

```text
this metal has capacity for N more running VPSes
this VPS must wait or be placed on another host
this VPS needs a larger plan
```

## Root-Controlled VPS Compliance Boundary

If users have root inside their VPS, Vibe64 cannot use code obfuscation, SHA
checks, update gates, or local policy checks as a hard compliance boundary.
Root can patch code, alter config, pin an old version, intercept requests, or
proxy credentials.

The defensible product stance is:

- stock Vibe64 implements the compliant behavior
- company pay-per-token API routes are the supported team/collaboration path
- subscription/account routes are account-holder-only in stock Vibe64
- collaborators can propose prompts for subscription routes
- Vibe64 does not ship bypass features or bypass instructions
- Vibe64 support can refuse modified deployments that violate provider terms
- root-controlled customers are responsible for modifications inside their VPS

This is a product/legal boundary, not something the host virtualization layer
can fully enforce.

## Relationship To Vibe64 Auth And Runtime Identity

Do not tie this VPS plan to Supabase or JSKIT auth.

Inside a VPS there are separate identity planes:

- Vibe64 Online login identity: who can log into the web app
- runtime OS identity: which Linux user/home is used for tools and credentials

The login identity can be local password auth, Supabase, OIDC, PAM, or another
adapter. That is a Vibe64/JSKIT auth-layer choice.

The runtime OS identity is the credential/compliance choice. Provider CLIs,
GitHub CLI, Codex, Claude, GLM, SSH, and Git auth must use the intended OS
home. This is covered in `REAL_OS_USER_CREDENTIALS_PLAN.md`.

## Operational Metrics Required

Before promising density, measure:

- active VPS count
- host free/available memory
- zram compression ratio and saturation
- guest OOM events
- host OOM events
- CPU load and steal/ready pressure
- IO latency
- ZFS/Btrfs compression ratio
- VPS boot time
- idle shutdown accuracy
- average active session duration
- peak concurrent sessions by timezone
- project/service disk growth

These numbers should drive the real cap. The 40-50 active VPS target is the
starting plan for a 128 GB host, not a permanent constant.

## Open Decisions

- exact Incus profile limits for the first VPS size
- exact guest zram percentage
- exact idle timeout
- whether stopped VPS roots stay mounted or are fully detached
- whether large customer/project data lives in the VM disk or attached
  per-VPS data volumes
- backup/snapshot retention
- migration path between physical hosts
- whether to offer a smaller-than-2GB plan for very light users
- whether enterprise customers get dedicated metal or dedicated host pools
