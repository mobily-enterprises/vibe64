# Real OS User Credential Architecture Plan

This plan replaces the provider-home credential model with real VM user homes.
It is intentionally separate from `GIT_PLAN.md`.

## Decision Summary

Vibe64 runs on a real VM. Provider credentials must belong to real OS users on
that VM, not to Vibe64-owned synthetic directories.

Core decisions:

- Remove `providerHomesRoot` completely.
- Do not replace it with another app-owned credential root.
- The Node appserver runs as the owner OS user.
- Codex/AI provider authentication is single and daemon-runner-scoped.
- Codex/AI provider credentials live in the daemon runner's real home.
- Each Vibe64 user is an actual OS user.
- Per-user credentials, such as GitHub CLI auth, live in that OS user's real home.
- Vibe64 has no database-backed user identity mapping.
- The OS username is the Vibe64 user identity.
- Vibe64 Online control-plane login uses host OS authentication through PAM
  or an equivalent host login helper. Supabase must not be used as the
  Vibe64 Online identity provider.
- Vibe64 stores only daemon-scoped Online membership metadata keyed by username.
- Containers provide tools and runtimes only. They do not own credentials.
- Shared npm/php/ruby/python caches are explicit cache mounts/env vars, never home directories.
- Each Vibe64 Online daemon has exactly one owner OS user.
- The owner OS user runs the appserver and owns the single Codex auth.
- Vibe64 app-private state lives in the daemon runner's real home directory.
- Online repositories live under `/var/lib/vibe64/<owner>/projects/<project>`.
- CLI/local mode has no Vibe64 owner or membership model. It uses the invoking
  OS user and the opened repository.

## Legal / Compliance Driver

The primary driver is AI provider terms of service. Vibe64 must not store other
users' AI provider credentials or keys in app-owned storage.

The compliant model is:

```text
owner OS user home
  -> single Codex / AI provider auth
  -> Vibe64 app-private state for the online daemon

acting OS user home
  -> that user's GitHub and user-specific provider auth

repository/source roots
  -> checked-out source, Git metadata, committed project files
  -> no provider credential homes
```

This works because Vibe64 Online runs on a real VM, so real Unix users and real
home directories are available.

## Runtime Modes And Storage Roots

Vibe64 Online and CLI/local mode should use the same state-vs-source split.

The daemon runner is the OS user running the Vibe64 process:

- in Online, this is the owner OS user
- in CLI/local mode, this is the invoking OS user

Vibe64 app-private state belongs in the daemon runner's real home state root,
for example:

```text
${XDG_STATE_HOME:-~/.local/state}/vibe64
```

This state root contains private Vibe64 metadata such as:

- project catalog records
- session records and workflow state
- chats/conversation logs
- command/action metadata
- user membership metadata for Online
- runtime bookkeeping
- logs and locks

It must not contain provider credentials. Credentials still use the selected
real OS user home through each provider's normal location.

For Vibe64 Online:

- there is exactly one Vibe64 owner OS user for the daemon instance
- the Node appserver runs as that owner
- app-private state lives under the owner user's Vibe64 home state root
- online repositories live under `/var/lib/vibe64/<owner>/projects/<project>`
- user membership metadata lives under the owner user's Vibe64 home state root,
  for example `~/.local/state/vibe64/users/<username>.json`
- GitHub/Codex credentials still live in real OS homes, not under
  Vibe64 state or repository roots

For CLI/local mode:

- there is no Vibe64 owner concept
- there is no Vibe64 user membership list
- the process user is simply the OS user who launched Vibe64
- the opened directory is the target repository/source root
- the target repository remains the canonical local source for
  `repository.mode = "local_source"`
- committed/shareable Vibe64 project config lives under
  `<target-root>/.vibe64`
- unshared local runtime/session state lives under the invoking user's Vibe64
  home state root, keyed by the opened repository path
- the opened directory is the only CLI/local source exception; Vibe64-created
  session source copies use the managed source root
- GitHub/Codex credentials use the invoking OS user's real home

The important distinction is that Vibe64 always has both a state root and a
source root. Online creates/manages source roots under `/var/lib/vibe64`; CLI
uses the source root the user opened.

Session source copies are source roots, not chat/state roots. They should
follow the repository/source placement rule:

- Online session source copies live under the Online repository area in
  `/var/lib/vibe64/<owner>/...`
- CLI/local session source copies live under the invoking user's managed source
  area, for example `/var/lib/vibe64/<user>/projects/<project-key>/...`
- if CLI/local runs commands as another OS user, the daemon runner must verify
  that the source root it hands to that user is writable by that user

Public Vibe64 must not know that Vibe64 Online exists. The different defaults
must be supplied by the launcher/composer:

- CLI/local launcher supplies:
  - daemon state root in the invoking user's home
  - canonical source root as the opened directory
  - session source root under the invoking user's managed source root
- Vibe64 Online supplies:
  - daemon state root in the owner user's home
  - canonical source root under `/var/lib/vibe64/<owner>/projects/<project>`
  - session source root under the online repository area

Core session code should consume this root contract and use the shared resolver
to derive final paths. It should not branch on `online`, import online
packages, or hard-code online filesystem defaults.

## Identity Model

There is no Vibe64 user database and no separate mapping table.

The OS user is the identity.

Vibe64 Online authentication must therefore authenticate an OS username, not an
email address or external provider subject. The browser session may store a
session token and the OS username. It must not store or require Supabase ids,
Google ids, OAuth subjects, or any other external identity mapping.

For v0, Online login should use a root-owned, narrow host helper that validates
`username + password` with PAM and returns OS facts from `getpwnam()`. Passwords
must be passed over stdin only, never argv/env/logs/files. If an external login
provider is needed later, it belongs behind the OS/PAM/NSS layer; Vibe64 should
still see only an authenticated OS username with a real uid, gid, and home.

Supabase may still be used by generated applications as an application auth
provider. That is separate from Vibe64 Online control-plane login.

Vibe64 Online may keep daemon-scoped membership files, for example:

```text
~/.local/state/vibe64/users/<username>.json
```

Those files contain only Vibe64-specific metadata:

```json
{
  "role": "owner",
  "status": "active",
  "createdAt": "2026-07-04T00:00:00.000Z"
}
```

They must not store:

- UID
- GID
- home directory
- shell
- GitHub identity
- Codex auth state
- provider auth paths
- copied OS account data

Those facts are resolved from the OS at runtime by username.

## Users UI / Management

The Online Users page should distinguish OS availability from Vibe64 membership
without duplicating identity data.

It should support:

- listing current Vibe64 users from daemon-scoped membership files
- resolving OS facts for those usernames live from the OS
- listing eligible existing OS users that are not enabled for Vibe64
- enabling an existing OS user for Vibe64
- creating a new system user and enabling it for Vibe64
- disabling Vibe64 membership without deleting the OS account

Adding a Vibe64 user means:

```text
create or select OS user
write daemon-scoped membership file keyed by username
```

Removing a Vibe64 user means:

```text
remove/disable daemon-scoped membership file
do not delete the OS account
```

## Owner User

The Node appserver should run as the owner OS user.

The owner user is special because:

- it owns the appserver process
- it owns the single Codex/AI provider authentication
- Codex appserver and agent operations use the owner user's real home

There is still only one Codex auth for the appserver.

There is also only one owner for a Vibe64 Online daemon instance.
Startup/install should derive the owner from the appserver process user. If an
owner marker is needed for the managed Online service, it may store the owner
username only; UID, GID, home, and shell are still resolved from the OS at
runtime.

It should be technically possible for two OS users to run independent daemon
instances on the same computer. This is not the normal product workflow, but it
is required for initial testing on one VPS and it keeps the architecture clean.
Separate users naturally get separate home state roots, separate repository
roots under `/var/lib/vibe64/<owner>/...`, and separate runtime namespaces.

The Online launcher/install contract must therefore support multiple daemon
instances on the same VPS without collisions. In the normal install the
instance namespace may simply be derived from the owner username. For test
installs, the launcher may require explicit unique ports and/or an explicit
instance name, but it must not rely on singleton host resources.

## Acting User

GitHub and other per-user operations should run using the acting OS user's home.

Examples:

- GitHub repository creation
- GitHub repository linking
- GitHub collaborator/status checks
- PR creation/merge
- Git operations requiring that user's credentials

These must not use owner auth or synthetic provider homes for acting-user work.

## Execution Model

Node should not directly read another user's home and run arbitrary commands as
owner. User-specific commands require a controlled user-context execution path.

Required helper:

```text
root-owned narrow helper
  -> validates username is enabled for Vibe64
  -> validates operation kind
  -> validates project/session paths
  -> launches allowed tool/container as target OS user
```

Possible implementation:

```text
owner appserver
  -> sudo NOPASSWD only for /usr/local/libexec/vibe64-exec-as-user
  -> helper runs as root
  -> helper validates request
  -> helper drops to target UID/GID or starts container as target UID/GID
```

Do not allow arbitrary `sudo -u <user> bash`.

Start with direct UID/GID drop in the helper. `systemd-run --uid=...` can be
added later if process supervision, cgroup boundaries, or host policy require
it, but it should not be the initial dependency.

The helper should support narrow operation kinds, such as:

- `github-toolchain`
- `project-git`
- `create-system-user`
- `enable-system-user`
- `disable-system-user`

Codex operations do not use the acting user's home. They run as the daemon
runner/home. In Online, that daemon runner is the owner OS user.

## Container Model

Containers are tool/runtime providers only.

The purpose of containers in Vibe64 is "no need to install this tool or service
on the host by hand." They are not a persistence abstraction, not an ownership
boundary for credentials, and not a place where durable data should become
hard to locate.

Every durable object must have an obvious host location:

```text
credentials
  -> real OS user homes

Vibe64 private state
  -> daemon owner's home state root

managed source repositories and Vibe64-created session source copies
  -> /var/lib/vibe64/<owner-or-user>/projects

opened CLI/local canonical source repositories
  -> wherever the user opened them

service data
  -> /var/lib/vibe64/<owner>/services/<project>/<service>
```

The UI, logs, cleanup tools, and backup guidance should use those same paths.
There should be no "where is my data?" layer hidden behind Docker named volumes
or broad writable bind mounts.

They may provide:

- Node
- PHP
- Ruby
- Python
- Laravel tooling
- MariaDB tooling
- Codex executable
- GitHub CLI executable
- Git executable

They must not own provider credentials.

Architecturally, Vibe64 should have only three container primitives:

```text
tool container
  -> runs tools and commands
  -> supports one-shot, interactive, and daemon lifecycles

service container
  -> runs project dependencies such as databases, queues, cache services
  -> owns service volumes, never provider credentials

app container
  -> runs the user's application
  -> supports preview, launch, and release lifecycles
```

Current container categories should collapse into those primitives:

```text
Toolchain command containers  -> tool container, one-shot
Terminal containers           -> tool container, interactive
Setup doctor containers       -> tool container, one-shot
Git/GitHub containers         -> tool container, one-shot/interactive
Codex terminal containers     -> tool container, interactive
Codex app-server containers   -> tool container, daemon
Deployment build containers   -> tool container, one-shot

Database containers           -> service container

Launch/preview containers     -> app container, preview/launch
Deployment release containers -> app container, release
```

Project database processes may run inside service containers on the VM, but
their durable data must live on the host VPS filesystem. It must never live in
the container writable layer, a credential home, or the repository/source tree.

Use a dedicated host service-data root, namespaced by daemon owner and project,
for example:

```text
/var/lib/vibe64/<owner>/services/<project>/<service>
```

Do not use Docker named volumes for this. Do not give containers a broad
writable VPS volume. If a database remains containerized, it gets one explicit
host bind mount for its own data directory only, mounted at the database data
path. If the architecture must have literally no writable host mount into a
container, then the database must run directly on the host VM instead of inside
a container.

This is a separate storage category:

```text
real OS homes
  -> provider credentials only

daemon home state root
  -> Vibe64 metadata, chats, sessions, membership, locks

/var/lib/vibe64/<owner>/projects
  -> source repositories, Git metadata, session source copies

/var/lib/vibe64/<owner>/services
  -> persistent project service data such as MariaDB/Postgres files
```

This keeps database backups, cleanup, permissions, and source/runtime
boundaries clear. Service data can be deleted by explicit project/service
cleanup, but it must not be swept by source cleanup and must not be treated as
credential material.

GitHub, Codex, setup doctor, command terminal, shell terminal, and deployment
builds must not become separate container architectures. They are tool
execution modes sharing the same launcher, root contract, user context, cache
mounts, and runtime namespace rules.

Multiple images are still acceptable when they reflect real toolchain needs,
for example:

```text
vibe64-base-toolchain
vibe64-jskit-toolchain
vibe64-laravel-toolchain
vibe64-cpp-toolchain
postgres/mysql/mariadb official images
```

Image choice is an implementation detail of a primitive, not a new primitive.

For a command, the orchestrator must choose the correct real home:

```text
Codex / AI agent operation
  HOME = daemon runner home
  user = daemon runner UID/GID

GitHub user operation
  HOME = acting OS user home
  user = acting UID/GID

Managed Git / local Git without GitHub
  no GitHub auth required
  file ownership must still be correct
```

## Shared Dependency Caches

Shared caches are allowed, but they are not homes and not credential sources.

Use `/var/cache/vibe64` as the shared cache root. Use explicit cache env vars
and mounts, for example:

```text
NPM_CONFIG_CACHE=/var/cache/vibe64/npm
YARN_CACHE_FOLDER=/var/cache/vibe64/yarn
PNPM_STORE_PATH=/var/cache/vibe64/pnpm-store
COMPOSER_CACHE_DIR=/var/cache/vibe64/composer
PIP_CACHE_DIR=/var/cache/vibe64/pip
UV_CACHE_DIR=/var/cache/vibe64/uv
GEM_SPEC_CACHE=/var/cache/vibe64/gem/specs
```

Do not set:

```text
HOME=/var/cache/vibe64/...
XDG_CONFIG_HOME=/var/cache/vibe64/...
GNUPGHOME=/var/cache/vibe64/...
```

Tool auth/config still comes from the selected real OS user home.

Cache directories should be owned by the shared `vibe64` group with setgid
permissions so Vibe64 users can share artifacts without sharing credentials.

## State Root And Repository Root

Vibe64 should stop treating one root as both app state and project source.

App-private state belongs in the daemon runner's home state root:

```text
${XDG_STATE_HOME:-~/.local/state}/vibe64
```

For the Online owner, that contains:

```text
~/.local/state/vibe64/projects/<project-key>/project.json
~/.local/state/vibe64/projects/<project-key>/sessions/...   # records, chats, workflow state
~/.local/state/vibe64/projects/<project-key>/runtime/...
~/.local/state/vibe64/users/<username>.json
~/.local/state/vibe64/logs/...
~/.local/state/vibe64/tmp/...
~/.local/state/vibe64/locks/...
```

For CLI/local, the same shape lives under the invoking user's home state root,
keyed by the opened repository path.

Repository/source roots are separate:

```text
CLI/local source root
  -> user-opened path, for example /home/alice/code/my-app

Online source root
  -> /var/lib/vibe64/<owner>/projects/<project>
```

Committed/shareable project config, such as `<source-root>/.vibe64`, remains in
the repository because it is part of the project source contract. Chats,
session records, command metadata, UI state, logs, and membership metadata stay
in the daemon runner's home state root. Session source copies are repositories,
so they follow the source-root placement rule rather than the metadata rule.

Neither root is a credential home. GitHub/Codex credentials remain in real OS
user homes.

Global Vibe64 locations should be limited to things that are genuinely
whole-computer:

```text
/usr/local/libexec/vibe64-exec-as-user
/var/cache/vibe64/npm
/var/cache/vibe64/composer
/var/cache/vibe64/pip
/var/cache/vibe64/gem
```

Shared caches are explicitly cache paths, not homes and not auth sources.

## Host Runtime Namespace

Filesystem roots are not enough. Every daemon instance also needs a stable host
runtime namespace so independent daemons do not collide outside the filesystem.

The namespace should be derived at the composition boundary:

- CLI/local: invoking OS user plus a local/runtime discriminator
- Online: owner OS user by default, or an explicit installed instance name for
  same-VPS test installs

Public Vibe64 may consume a runtime namespace, but it must not know that Online
exists or hard-code Online names.

Every host resource that can outlive one request must include the daemon
runtime namespace or an owner/instance-derived equivalent:

- listen ports and Unix socket paths
- public origins and browser callback endpoints
- systemd unit names and process supervisor names
- helper authorization/sudoers rules
- Docker container names
- Docker network names
- Docker volume names
- Docker labels used for cleanup and ownership checks
- deployment release container names
- preview/runtime host aliases when globally visible
- lock files
- pid files
- temporary directories
- log directories
- cleanup scans and archive/delete operations
- database/service data paths when services are shared by one daemon instance

The existing Docker naming already has a `VIBE64_RUNTIME_NAMESPACE` concept.
The architectural requirement is that the Online launcher supplies a namespace
that separates owners/instances, and cleanup must filter by that namespace
before removing containers, networks, volumes, locks, or generated runtime
files.

For initial same-VPS Online testing, every daemon must be started with:

- a unique owner OS user or explicit Online instance namespace
- a unique HTTP port and callback origin
- a unique daemon home state root by virtue of the owner home, or by explicit
  instance root if same-owner testing is ever allowed
- a unique managed repository root under `/var/lib/vibe64/<owner>/projects`
  or an instance-qualified equivalent
- a unique service-data root under `/var/lib/vibe64/<owner>/services`
  or an instance-qualified equivalent
- namespace-scoped Docker containers, networks, labels, logs, locks, and pid
  files

Normal installs should still remain simple: one owner, one daemon, one
owner-derived namespace. The additional namespacing exists so testing several
Online daemons on one VPS is practical and deterministic, not because the
product has a tenant model.

This preserves two things at once:

- Product/legal can still support one managed Online owner in normal installs.
- The architecture remains clean if two OS users run independent daemons on the
  same host.

## Online Repository Root Permissions

There is no separate per-customer group or root. The Online daemon owner is the
repository namespace.

Online repositories live under a Linux app data path, partitioned by owner:

```text
/var/lib/vibe64/<owner>/projects/<project>
```

They must not live in the owner user's home directory when multiple users need
to work on them. The owner home is for credentials and Vibe64 app-private
state, not shared source writes.

Important distinction:

- Current non-GitHub online projects are still Git-backed. They use
  `repository.mode = "managed_git"` and a canonical bare repository at
  `<project>/git-cache/repository.git`.
- Current CLI/local projects use `repository.mode = "local_source"` and the
  opened local source repository as canonical source.
- There is not currently a "no Git at all" repository mode. The product
  invariant remains one canonical Git repository per project.
- The `/var/lib/vibe64/<owner>/projects/<project>` tree must contain source
  files, Git metadata, canonical bare repositories, and session source copies
  only. It must not contain chats, workflow records, UI state, user membership,
  provider credentials, or other Vibe64 app-private state.

For shared online projects:

- repository roots should be owned by the owner/appserver user or a controlled
  project owner
- Vibe64-enabled OS users should be members of the global `vibe64` Unix group
- repository roots should use group `vibe64`
- directories should be setgid so new files inherit the group
- Vibe64-launched user processes should use `umask 002`
- managed bare repositories should use group sharing, for example
  `git init --bare --shared=group`
- non-bare work trees that need shared writes should set
  `git config core.sharedRepository group`

Example target shape:

```text
/var/lib/vibe64/alice/projects/my-project
  owner: <owner-user>
  group: vibe64
  mode: 2770 for directories
```

Credential homes are different:

- `/home/<user>` should not be made group-writable for Vibe64 sharing
- GitHub/Codex credentials stay in real user homes
- only repository/source roots and shared caches use shared project/cache
  permissions
- Vibe64 app-private state in the daemon runner's home is written by the daemon
  runner, not by acting users

This is intentionally simple for the normal one-owner-one-machine deployment.
It means Vibe64-enabled OS users on that machine can write online repository
roots through the shared group. If strict separation between two independent
online owners ever becomes a hard requirement, the permission model can be
tightened later with owner-specific groups without changing the root contract.

For local mode:

- if a user opens a repo under their own home, that repo is their local source
  and should not be automatically shared
- if multiple users need to work on that local-source project, the daemon
  runner must verify the repository permissions before running commands as
  those users
- Vibe64 should detect inaccessible project roots and explain the required
  ownership/group/mode changes rather than chmodding arbitrary home directories

## What Must Be Removed

Remove `providerHomesRoot` from public Vibe64 and Vibe64 Online.

This includes:

- `VIBE64_PROVIDER_HOMES_ROOT`
- provider-home path derivation
- app-owned GitHub homes
- app-owned Codex homes
- per-user synthetic GitHub homes
- app-owned terminal provider homes
- tests that assert provider-home paths
- docs that describe provider homes as credential storage

Any remaining use of the phrase "provider home" should refer only to deleted
legacy behavior or migration notes.

## New Core Layers

Add small explicit layers instead of a large abstraction.

### OS User Identity

Responsibilities:

- resolve OS user by username
- read UID/GID/home/shell/display name from OS
- classify eligibility for Vibe64 enablement
- reject system/service accounts unless explicitly allowed
- never persist duplicated OS facts in membership files

Likely implementation sources:

- `/etc/passwd` via Node APIs or `getent passwd`
- `id`
- `getent group`

Eligibility is not the same as membership.

Membership is explicit daemon-scoped Vibe64 metadata. Eligibility only decides
which OS accounts the owner is allowed to enable from the UI/helper.

A UID threshold is only a weak system-account filter. It does not prove an
account is a person, because later command-line-created users can have normal
UIDs while still being service accounts, automation users, or accounts the
owner should not enable accidentally.

The safer eligibility rule is:

- username must resolve through the OS
- account must have a real home directory
- account must not be locked/disabled
- shell must not be a known non-login shell such as `/usr/sbin/nologin` or
  `/bin/false`
- account must not be an obvious system/service account
- owner still explicitly chooses to enable that OS user for this Vibe64 daemon

This avoids duplicating OS identity while still preventing the UI from treating
every passwd entry as a candidate Vibe64 user.

### Vibe64 Membership Store

Responsibilities:

- list Vibe64 membership files
- read/write role/status metadata
- validate username exists in OS
- validate membership paths stay inside the daemon runner's Vibe64 home state root
- no provider credentials

### Project Root Contract

Responsibilities:

- resolve daemon home state root
- resolve project state root inside the daemon home state root
- resolve source/repository root separately
- resolve session state root separately from session source root
- validate state paths stay inside the daemon home state root
- validate managed source paths stay inside the supplied managed source base
  root
- validate CLI/local source paths are the opened repository or an allowed
  session source copy
- prevent code from treating app-private state paths as writable project source
  paths
- keep public Vibe64 independent from online-specific path defaults

Public Vibe64 should expose and consume a small root contract, for example:

```json
{
  "daemonStateRoot": "/home/alice/.local/state/vibe64",
  "managedSourceBaseRoot": "/var/lib/vibe64/alice/projects",
  "openedSourceRoot": "/home/alice/code/my-app",
  "sourceLayout": "opened_source",
  "sessionSourceLayout": "managed_project_key_active_session"
}
```

The online package may pass the same baseline shape with managed source roots:

```json
{
  "daemonStateRoot": "/home/owner/.local/state/vibe64",
  "managedSourceBaseRoot": "/var/lib/vibe64/owner/projects",
  "sourceLayout": "managed_project_source",
  "sessionSourceLayout": "project_slug_session"
}
```

Public Vibe64 should then derive final paths from the root contract plus the
project key, project slug, and session id:

```text
projectStateBaseRoot
  = <daemonStateRoot>/projects

usersRoot
  = <daemonStateRoot>/users

projectStateRoot
  = <projectStateBaseRoot>/<project-key>

sessionStateRoot
  = <projectStateRoot>/sessions/active/<session-id>

CLI canonicalSourceRoot
  = <openedSourceRoot>

CLI projectSessionSourceRoot
  = <managedSourceBaseRoot>/<project-key>

CLI sessionSourceRoot
  = <managedSourceBaseRoot>/<project-key>/sessions/active/<session-id>/source

Managed canonicalSourceRoot
  = <managedSourceBaseRoot>/<project-slug>

Managed projectSessionSourceRoot
  = <managedSourceBaseRoot>/<project-slug>

Managed sessionSourceRoot
  = <managedSourceBaseRoot>/<project-slug>/sessions/active/<session-id>/source
```

The only source-path exception is CLI/local canonical source: if a user opens
`/home/alice/code/my-app`, that opened directory remains the source of truth.
Vibe64-created session source copies still live under `managedSourceBaseRoot`,
not under daemon-private state.

This layer replaces the current overloaded use of `projectRuntimeRoot` /
`projectLocalRoot` where one path can mean project metadata, session metadata,
Git cache, runtime files, and source root depending on mode.

### Privileged Helper Client

Responsibilities:

- call the root-owned helper
- pass structured operation inputs
- surface failures clearly
- never fall back to owner-home auth for user operations

### Tool Home / Execution Context

Replace `toolHomeSource` semantics with explicit execution context:

```json
{
  "runAs": {
    "username": "alice",
    "uid": 1001,
    "gid": 1001,
    "home": "/home/alice"
  },
  "credentialHome": "/home/alice",
  "cacheMounts": {
    "npm": "/var/cache/vibe64/npm"
  }
}
```

For Codex:

```json
{
  "runAs": {
    "username": "owner",
    "home": "/home/owner"
  },
  "credentialHome": "/home/owner",
  "authScope": "owner_codex"
}
```

## Public Vibe64 Areas To Change

Expected public repo areas:

- `packages/vibe64-core/src/server/studioRoots.js`
  - replace mode-specific implicit roots with explicit state/source root
    resolution
  - keep Online out of public code while still exposing a generic managed
    source root default for Vibe64-created source copies
- `packages/vibe64-core/src/server/studioProjectContext.js`
  - stop treating online project root as both runtime state and source root
  - expose separate project state root and repository/source root
  - accept externally supplied roots from the embedding runtime
- `packages/vibe64-runtime/src/server/sessionStore.js`
  - keep session records/chats under state root
  - support session source paths that are separate from session state paths
  - consume a resolved session source root instead of deciding where online
    workspaces belong
- `packages/studio-terminal-core/src/server/providerHomes.js`
  - remove or replace with real OS home resolution
- `packages/studio-terminal-core/src/server/terminalOwnership.js`
  - replace provider-home ownership with OS-user execution ownership
- `packages/studio-terminal-core/src/server/studioToolHome.js`
  - stop mounting synthetic tool homes as credential homes
- `packages/setup-doctor-core/src/server/doctorToolchain.js`
  - accept execution context and cache mounts
- `packages/setup-doctor-core/src/server/doctorToolchainCommands.js`
  - run GitHub checks under acting OS user context
- `packages/vibe64-accounts/src/server/service.js`
  - account readiness checks real homes
  - Codex readiness checks daemon runner home
  - GitHub readiness checks acting user home
- `packages/vibe64-terminals/src/server/*`
  - Codex terminals use daemon runner home
  - GitHub command terminals use acting user home through helper
  - non-GitHub terminals avoid GitHub auth
- `packages/project-setup-doctor/src/server/*`
  - GitHub setup checks acting OS user auth
  - Codex setup checks owner auth
- self-target JSKIT adapter launch code
  - remove provider-homes mounts
  - add cache mounts explicitly

## Vibe64 Online Areas To Change

Expected online repo areas:

- `bin/vibe64-online.js`
  - stop deriving/creating `providerHomesRoot`
  - derive the daemon owner's Vibe64 home state root
  - derive the online repository root as `/var/lib/vibe64/<owner>/projects`
  - add shared cache root derivation
  - add owner username/home/runtime facts
- host setup tooling
  - remove old multi-instance user creation/removal as a product concept
  - stop creating `provider-homes`
  - create daemon-scoped `users` membership root in the daemon owner's home
    state root
  - create `/var/lib/vibe64/<owner>/projects` with owner/group/setgid
    permissions
  - ensure Vibe64-enabled OS users are in the `vibe64` group
  - install/configure helper if appropriate
- new host helper, likely:
  - `tooling/host/vibe64-exec-as-user`
  - or `/usr/local/libexec/vibe64-exec-as-user` install target
- online auth/user service
  - list OS users
  - create system user
  - enable existing OS user
  - write daemon-scoped membership metadata in the daemon owner's home state
    root
- `packages/private-online-core/src/server/githubProjectService.js`
  - GitHub toolchain uses acting OS user context, not provider homes
- `packages/private-online-core/src/server/githubProjectAccessService.js`
  - access checks use acting OS user home
- `packages/private-online-core/src/server/projectRoutes.js`
  - route actor must carry OS username, not email provider-home key
- online deployment service/runner
  - GitHub mode clones with acting OS user home
  - managed Git mode no GitHub home
  - supplies online source roots to public Vibe64 instead of requiring public
    Vibe64 to know online paths
  - cache dirs explicit
- online managed app auth
  - decide whether this is owner/app credential state or Vibe64 app-private
    state
  - do not store AI provider credentials there

## Authentication UI Changes

Codex setup:

- Online owner-only
- checks daemon runner home, which is the owner OS home in Online
- makes clear there is one Codex auth for the appserver

GitHub setup:

- per OS user
- checks that user's real home
- login flow uses the existing GitHub device-code flow
- helper-mediated execution must write GitHub CLI auth to that user's real home

Users setup:

- owner can create OS user
- owner can enable existing OS user
- owner can take Vibe64 access away
- owner cannot delete OS users from the Vibe64 UI
- Vibe64 membership is daemon-scoped to the Online appserver owner
- no duplicated identity mapping

## Migration Strategy

No silent migration of credentials from provider homes into real homes.

If legacy provider homes exist:

- detect them
- report them as legacy/incompatible
- tell owner which real OS user must log in again
- optionally provide a manual owner-run migration script, but do not do it silently

For existing installs:

- create daemon-scoped users directory in the daemon owner's home state root
  if missing
- seed owner membership from current owner identity
- remove provider-homes requirement from startup
- leave old provider-home directories untouched until an explicit cleanup command

## Testing Plan

Use fake OS homes and helper stubs for deterministic tests.

Required tests:

- OS user resolver reads username/home/uid/gid from test fixtures or injectable command output
- Vibe64 membership files store only Vibe64 metadata
- user list joins OS users and Vibe64 membership in memory without persisting OS facts
- GitHub account status checks acting user home
- Codex account status checks daemon runner home
- toolchain args mount selected real home as `HOME`
- shared cache mounts are present and separate
- no code writes GitHub/Codex auth under Vibe64 app-private state, project
  source state, or runtime state
- `providerHomesRoot` env/config is no longer required
- legacy `providerHomesRoot` references are rejected or ignored explicitly
- helper client rejects unknown operation kinds
- helper client rejects users not enabled for Vibe64
- helper client rejects state paths outside the daemon home state root
- helper client rejects managed source paths outside the supplied managed source
  base root
- online repository roots use owner/group/setgid permissions
- Vibe64-enabled OS users are added to the shared `vibe64` group
- CLI/local repositories are not chmodded or group-managed by Vibe64

Real verification:

- create a test OS user on the VM
- enable that user in daemon-scoped membership
- authenticate GitHub as that user
- verify GitHub route operations use that user's home
- verify Codex operations still use daemon runner home
- verify shared npm/composer/pip/gem caches are used without becoming `HOME`
- verify no provider credential files appear under Vibe64 app-private state or
  repository roots
- verify online repository roots contain only source files, Git metadata,
  canonical bare repositories, and session source copies

Later container-path verification:

- preview currently appears broken; treat it as a separate follow-up container
  path/runtime issue, not as resolved by the managed Git save fix
- verify preview launch containers mount and run source paths with the same
  absolute host/container path invariant
- verify Online publish also works after the same-path container cleanup,
  including publish build/migrate/release containers for managed Git and GitHub
  projects

## Open Questions

- Exact OS user eligibility rule:
  - how strict the system/service account exclusion list should be
  - whether to expose an owner override for unusual real users
- Whether the current install user is always the owner appserver user or whether install can choose another owner OS user.

## Non-Negotiable Invariants

- No app-owned provider credential homes.
- No AI provider credentials for non-owner users stored by Vibe64.
- No synthetic home directories for GitHub/Codex.
- OS username is the identity.
- Vibe64 membership files are metadata only.
- Codex auth is daemon-runner-scoped and singular.
- GitHub auth is acting-user-scoped.
- Containers are tools only.
- Shared caches are never homes.
