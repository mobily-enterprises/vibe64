# Vibe64 VPS / Dedicated Host Setup Report

This report captures the current hosting direction for Vibe64: cheap disposable Linux hosts, one customer tenant per host in normal production, user/provider credentials brought by the customer, and central management/backup/observability outside the host.

## Executive Summary

The economics can work well if Vibe64 is sold per seat.

Target unit model:

```text
100 users x A$10/month = A$1,000/month revenue
1 host per customer/team ~= A$100/month
raw server cost ~= A$1/user/month
```

That leaves strong gross infrastructure margin, assuming:

- Customers bring their own AI/provider credentials.
- Support is limited and mostly self-service.
- Hosts are treated as disposable compute.
- Durable customer state is backed up off-host.
- Logs are centralized and short-lived on the host.
- Heavy workloads are fairly limited or queued.

The server cost is not the hardest part. The hard parts are automation, restore reliability, observability, support discipline, and preventing runaway logs/cache/build output from consuming user disk.

## Host Model

Normal production model:

```text
one customer / tenant = one host
```

Test/staging may run multiple tenants on one host, but production should assume one customer per machine unless there is a strong reason to share.

Each host should be disposable:

```text
host = replaceable compute
durable state = backed up elsewhere
restore = provision fresh host + restore tenant state + switch DNS
```

The host may contain hot runtime state, but it must not contain the only durable copy of important customer data.

## Candidate Servers

### Smaller KS-5-class Host

Example discussed:

```text
CPU: Intel Xeon E5-1650v4
Cores: 6 cores / 12 threads
RAM: 128 GB DDR4 ECC
Storage: 2 x 450 GB NVMe soft RAID
Bandwidth: 500 Mbps unmetered
```

This is RAM-rich but CPU-limited. It is useful for a first customer, a smaller team, or a test host.

Practical estimate:

| Usage pattern | Estimate |
| --- | ---: |
| Heavy active users at once | 4-8 |
| Normal active coding users at once | 10-20 |
| Light active users at once | 20-35 |
| Mostly idle logged-in users | 100+ |
| Total real users target | 50-100 |

This box can plausibly support 100 total users if concurrency is normal, but it is not a safe promise for 100 heavy active developers.

### Better KS-7-class Host

Example discussed:

```text
CPU: AMD EPYC 7451
Cores: 24 cores / 48 threads
Clock: 2.3 GHz / 3.2 GHz
RAM: 128 GB to 256 GB DDR4 ECC
Storage: 2 x 500 GB to 2 x 4 TB NVMe soft RAID
Bandwidth: 500 Mbps
Price: about A$104/month, plus about A$104 setup fee
```

This is a better Vibe64 shape because Vibe64 is concurrency-heavy. Active users create CPU pressure from Codex/opencode, Nix, builds, package installs, test runs, Playwright, code indexing, and database work.

Practical estimate:

| Host | Normal active users at once | Total users target |
| --- | ---: | ---: |
| Xeon E5-1650v4, 128 GB | 10-20 | 50-100 |
| EPYC 7451, 128 GB | 20-35 | 100-180 |
| EPYC 7451, 256 GB | 25-45 | 150-250 |

For a paid 100-user customer, the EPYC 7451 class is the safer baseline.

Preferred configuration when available:

```text
EPYC 7451
256 GB RAM
2 x 4 TB NVMe RAID1
```

The 2 x 500 GB option is workable for controlled early deployments, but 2 x 4 TB avoids Nix store, project history, database dumps, backup staging, and session history becoming the first operational problem.

## User Capacity Formula

Capacity should be planned by active concurrent users, not registered users.

Rough planning formula:

```text
peak_concurrent =
  total_users
  x daily_usage_rate
  x active_hours_per_day / workday_hours
  x peak_factor
```

Reasonable Vibe64 assumptions:

```text
daily_usage_rate:      40-70%
active_hours_per_day:  1.5-3
workday_hours:         8-10
peak_factor:           1.5-2.5
```

This usually means peak active concurrency is around 15-35% of total real users for teams that use Vibe64 daily.

Planning target:

```text
100 total users
10-25 active at once
```

Heavy simultaneous builds/tests/Playwright/Codex sessions can exceed that. Vibe64 should enforce fair-use limits and queue or throttle expensive operations.

## Compression

### RAM Compression

Use zram or equivalent RAM compression.

Do not count it as doubling memory. For Node/Nix/development workloads, it can provide useful headroom because some memory is compressible.

Planning rule:

```text
128 GB physical RAM may feel like roughly 160-190 GB under pressure
```

It helps avoid swap death. It does not create CPU.

### Disk Compression

Disk compression is useful for Vibe64 data:

- Nix store content can compress well.
- `node_modules` can compress well.
- source trees, JSON, logs, generated files, and text assets compress well.
- database data compresses variably.
- images, archives, media, and already-compressed assets gain much less.

On a 450 GB usable RAID1 disk, compression may make typical development data feel closer to 700 GB to 1 TB, but real usage still needs monitoring.

Use filesystem/storage compression where operationally safe, for example ZFS or btrfs, but do not make the architecture depend on compression to survive.

## Database Runtime Policy

Do not run one database daemon per project.

Preferred model:

```text
one tenant/host = one MySQL/MariaDB daemon
many project databases inside that daemon
```

Development user/password can be simple:

```text
one shared dev DB user/password per tenant
```

Deployment user/password should be stricter:

```text
one deployment DB user/password per deployment database
```

This keeps the server viable. Running one DB daemon per project would waste RAM/CPU and becomes dangerous on smaller hosts.

## Pricing and Unit Economics

If each user pays A$10/month:

| Paid users on A$100 server | Revenue | Server cost share |
| ---: | ---: | ---: |
| 30 | A$300 | 33% |
| 50 | A$500 | 20% |
| 75 | A$750 | 13% |
| 100 | A$1,000 | 10% |

At 100 users:

```text
Revenue:       A$1,000/month
Server:        about A$100/month
Backup/etc:    likely A$20-A$100/month for normal small-data tenants
Infra margin:  likely strong
```

This only works cleanly because customers bring their own AI/provider credentials.

Costs not included in raw server math:

- backup storage
- monitoring/log infrastructure
- control plane
- payment fees
- taxes/VAT/GST
- domain/DNS/email
- support time
- emergency operations

Support must be strict at A$10/user/month:

- Platform-broken support is included.
- Customer app debugging is limited.
- Credential setup should be self-service.
- Doctor checks should be clear enough to avoid manual support.
- Heavy resource usage should be governed by fair-use limits.

## Scaling to 100,000 Users

At 100 users per host:

```text
100,000 users / 100 users per host = 1,000 hosts
1,000 hosts x A$104/month ~= A$104,000/month server cost
100,000 users x A$10/month = A$1,000,000/month revenue
```

One-time install fees at A$104 per host:

```text
1,000 x A$104 = A$104,000 one-time setup fees
```

The infrastructure math still works. The operational model must be automated.

At this scale, Vibe64 needs a control plane.

The control plane should own:

- customers
- tenants
- host inventory
- host health
- deployment versions
- backup manifests
- restore status
- billing/customer mapping
- DNS routing
- provisioning
- replacement workflows

The control plane should be able to answer:

```text
customer X -> host Y
host Y health -> OK/bad
backup status -> current/stale
deploy version -> current/old
replace host Y -> provision new host, restore customer, switch DNS
```

Do not scale this manually.

## Backup Model

Do not back up servers as servers.

Back up tenant state.

Back up:

- managed project sources
- app databases
- Vibe64 metadata/state
- deployment config/secrets
- selected credential state if needed
- selected logs only if needed for audit/compliance

Do not back up:

- Nix store
- `node_modules`
- package caches
- Playwright browsers
- build artifacts
- temp directories
- runtime scratch
- OS image

Preferred storage target:

```text
S3-compatible object storage
```

Possible providers:

- Backblaze B2
- Wasabi
- Cloudflare R2
- OVH Object Storage
- AWS S3 or compatible alternatives

Approximate public pricing discussed:

| Provider | Rough storage price |
| --- | ---: |
| Backblaze B2 | about US$6.95/TB/month |
| Wasabi | about US$7.99/TB/month |
| Cloudflare R2 standard | about US$15/TB/month |

Backblaze pricing: https://www.backblaze.com/cloud-storage/pricing  
Wasabi pricing: https://wasabi.com/pricing  
Cloudflare R2 pricing: https://developers.cloudflare.com/r2/pricing/

Backup cost examples for 1,000 tenants:

| Durable data per tenant | Stored after retention/compression | Estimated backup cost/month |
| ---: | ---: | ---: |
| 10 GB | 30-50 TB | about US$200-US$400 |
| 50 GB | 150-250 TB | about US$1,000-US$2,000 |
| 200 GB | 600 TB-1 PB | about US$4,000-US$8,000 |

Retention example:

```text
hourly for 24 hours
daily for 14-30 days
weekly for 8-12 weeks
monthly for 6-12 months
```

Each host should run the same backup agent:

```text
dump DBs
snapshot/back up durable paths
upload to object storage
write manifest
report status to control plane
```

Example durable paths:

```text
/var/lib/vibe64/<tenant>/projects
/var/lib/vibe64/<tenant>/services/mysql-8.0/backups
/home/v64d_<tenant>/.local/state/vibe64
selected credential/config paths
```

Backup manifests should include:

```json
{
  "tenant": "acme",
  "host": "ks-123",
  "timestamp": "2026-07-07T00:00:00Z",
  "vibe64Version": "0.1.22",
  "dbDump": "s3://...",
  "snapshot": "restic:...",
  "status": "ok"
}
```

The important part is restore testing.

The control plane should regularly do:

```text
restore random tenant backup into disposable verification host
run doctor
run DB integrity check
report pass/fail
destroy verification host
```

## Observability and Log Search

Use an open source, self-hosted observability stack. Do not write custom log search.

Recommended starting stack:

```text
Grafana + Loki + Grafana Alloy
```

Add metrics:

```text
Grafana + Loki + Alloy + Prometheus
```

At larger scale, consider:

```text
Grafana + Loki + Alloy + VictoriaMetrics
```

What each component does:

- Grafana: UI, dashboards, alerts, log exploration.
- Loki: centralized log storage/search.
- Alloy: host collector/agent for logs, metrics, traces, and profiles.
- Prometheus or VictoriaMetrics: metrics storage/querying.

Why Loki:

- horizontally scalable
- multi-tenant
- cost-conscious
- indexes metadata/labels rather than full log content

Use OpenSearch/Elasticsearch only if deep full-text search over all logs becomes a hard requirement. It is heavier operationally.

Use ClickHouse/ClickStack later if log volume becomes huge and analytical querying becomes important.

## Integrating Observability Into Vibe64 Management

Vibe64's self-management software can integrate with Grafana/Loki/metrics APIs.

The control plane should remain the source of truth for:

- customers
- tenants
- hosts
- deployments
- backup status
- restore status
- billing/customer mapping

Grafana/Loki/metrics should be treated as queryable observability infrastructure.

Useful control-plane UI:

```text
Tenant: acme
Host: ks-1842
Vibe64 version: 0.1.22
Last heartbeat: 30s ago
CPU: 42%
RAM: 71%
Disk: 64%
Last backup: OK, 02:13 UTC
Last deploy: OK
Recent errors: 12 in last hour
Open logs
Open metrics
```

Example Loki labels:

```text
tenant_id
host_id
service
severity
vibe64_version
environment
```

Example Loki query:

```text
{tenant_id="acme", service="vibe64-daemon"} |= "error"
```

Example metrics:

```text
node_cpu_seconds_total
node_memory_MemAvailable_bytes
node_filesystem_avail_bytes
vibe64_backup_last_success_timestamp
vibe64_daemon_up
```

Vibe64 UI should provide simple status/errors directly, with "Open in Grafana" for deeper investigation.

## Local Log Retention

Do not let hosts store long-lived logs.

Target policy:

```text
local host logs: 1 hour
local log buffer cap: 2-6 GB
central searchable logs: 7-30 days
cold raw logs: optional, object storage only
```

Reason:

```text
host disk should be used by users, not logs
```

Prefer stdout/stderr into systemd journal. Avoid growing app log files.

Suggested journald policy:

```ini
[Journal]
Storage=persistent
SystemMaxUse=2G
SystemKeepFree=20G
MaxRetentionSec=1h
Compress=yes
```

If logs do not need to survive reboot:

```ini
[Journal]
Storage=volatile
RuntimeMaxUse=2G
MaxRetentionSec=1h
Compress=yes
```

Persistent with 1 hour retention is usually safer because a short network outage or reboot does not erase everything immediately.

For file-based logs that cannot be avoided:

```text
rotate hourly
keep 1-2 rotations
compress
hard cap per service
```

The log shipper must have a bounded local queue:

```text
if central Loki is unavailable:
  buffer locally up to configured cap
  drop oldest after cap
  report alert: logs dropping
```

Do not allow a failed logging system to fill tenant disks.

Vibe64-specific rule:

```text
Do not keep long logs under /var/lib/vibe64/<tenant>
Do not put logs in project roots
Do not let Codex/app-server/MySQL logs grow in /tmp
Do not count local logs as backup state
```

## Host Agent Responsibilities

Each Vibe64 host should eventually run a small Vibe64 management/agent service.

Responsibilities:

- report heartbeat
- report Vibe64 version
- report service health
- report disk/RAM/CPU summary
- run doctor checks
- run backup jobs
- upload backup manifests
- accept deploy/update commands
- expose current tenant/host identity
- expose whether logs are shipping and whether drops occurred

It should not be a hidden source of truth. Its state should be reconstructable from the control plane plus host-local facts.

## Operational Rules

1. Hosts are disposable.
2. Tenant data is durable only when backed up off-host.
3. Restore must be automated and regularly tested.
4. Customers bring provider credentials.
5. One tenant per production host is the default.
6. One database daemon per tenant/host, not per project.
7. Local logs are short-lived.
8. Central logs and metrics are self-hosted open source.
9. Support scope is limited and documented.
10. Heavy work needs fair-use controls.

## Practical Next Steps

1. Choose the baseline production host class.
   - Prefer KS-7-class EPYC with 256 GB RAM and larger NVMe if available.

2. Define the host bootstrap.
   - Linux base packages.
   - Nix.
   - Vibe64.
   - systemd services.
   - journald limits.
   - Alloy/metrics agent.

3. Define the tenant state layout.
   - `/var/lib/vibe64/<tenant>/...`
   - `/home/v64d_<tenant>/.local/state/vibe64`
   - service data under tenant service roots.

4. Build backup agent flow.
   - DB dumps.
   - durable filesystem snapshot.
   - object storage upload.
   - manifest upload.
   - control-plane status.

5. Build restore flow.
   - provision fresh host.
   - install Vibe64.
   - restore tenant state.
   - run doctor.
   - switch DNS.

6. Stand up observability.
   - Grafana.
   - Loki.
   - Alloy on hosts.
   - Prometheus or VictoriaMetrics.

7. Add host/resource governance.
   - concurrency limits.
   - build/test/Playwright limits.
   - log buffer caps.
   - disk alerts.
   - Nix/cache cleanup policy.

8. Validate the 100-user target.
   - Run synthetic workloads.
   - Measure CPU saturation.
   - Measure RAM pressure with zram.
   - Measure disk growth.
   - Measure backup and restore time.

## Bottom Line

The model is viable:

```text
100 comfortable total users per roughly A$100/month host
BYO AI/provider credentials
strict support boundaries
central backups and observability
hosts treated as disposable
```

At 100,000 users, the unit economics are still plausible, but only with a real control plane and automated provisioning, backup, restore, deploy, health, and log/metrics management.

