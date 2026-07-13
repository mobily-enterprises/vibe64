# JSKIT Premade Seed Repositories

Status: draft product and implementation specification
Last updated: 2026-07-11

## Summary

Vibe64 should let a user start an empty JSKIT project from a complete premade
GitHub repository. This is the fast path for common projects. The existing
configuration screens and conversational AI seeding remain available as the
advanced path and must continue to work exactly as they do now.

The initial repositories are:

- `vibe64-dev/jskit-seed-public`
- `vibe64-dev/jskit-seed-accounts`
- `vibe64-dev/jskit-seed-database`
- `vibe64-dev/jskit-seed-workspaces`

Every selectable seed is a complete, independently usable repository. Vibe64
does not install a base seed and then apply packages, patches, or child seeds.
It fetches the repository selected by the user and turns its complete tree into
the user's project.

```text
Selected repository tree
          |
          v
Fresh destination repository with one parentless initial commit
          |
          v
Normal Vibe64 session; the user builds from there
```

There is no npm package or `.tgz` transport layer in this design.

## Product Decision: Full Repositories, Provenance Graph

The seed graph records provenance only. It is not a dependency graph and it is
not a composition system.

For example:

```text
jskit-seed-database
|-- jskit-app-todo
|   `-- jskit-app-todo-for-law-firms
`-- jskit-app-crm
```

`jskit-app-todo-for-law-firms` is a complete repository. Selecting it does not
make Vibe64 clone Todo and apply a law-firm layer. Its metadata merely says that
it was originally built from Todo, which was originally built from the Database
foundation.

The graph exists so the product can show useful information such as:

- "Based on Database"
- "Specialised from Todo"
- foundation, example, and vertical categories
- breadcrumbs and related seeds

Vibe64 must never need to traverse the graph in order to materialize a seed.
Only the selected repository and revision are required.

## Terminology

- **Foundation**: one of the four minimal starting repositories.
- **Example app**: a complete application based on a foundation, such as Todo.
- **Vertical app**: a complete specialised application based on an example or
  another vertical, such as Todo for law firms.
- **Seed**: any foundation, example app, or vertical app offered by the picker.
- **Seed index**: the small trusted list used to populate the picker. It is menu
  data, not a package registry or build system.
- **Source seed**: the GitHub repository and exact revision chosen by the user.
- **Destination project**: the user's local, managed-Git, or GitHub project.

## Initial Foundation Matrix

The four initial foundations preserve the four common JSKIT configurations:

| Repository | Authentication | App database | Workspaces |
| --- | --- | --- | --- |
| `jskit-seed-public` | None | None | No |
| `jskit-seed-accounts` | Local, file-backed | None | No |
| `jskit-seed-database` | Local, database-backed | MariaDB | No |
| `jskit-seed-workspaces` | Local, database-backed | MariaDB | Yes |

The following product invariants apply:

```text
workspaces => database => database-backed authentication
```

These invariants describe what the four foundation repositories contain. They
do not instruct Vibe64 to construct one foundation from another.

Supabase is not an initial seed permutation. It is a later upgrade to an
existing local-auth application.

### Database wording that must be confirmed

The statement "each seed will also need to provide a database" conflicts with
the earlier Public and Accounts permutations if it means that all four apps
must use MariaDB. This draft interprets it as follows:

- every database-backed seed must cause Vibe64 to provide a real isolated app
  database;
- the repository contains schema migrations and optional deterministic starter
  data, never credentials or a database volume;
- Public and Accounts remain genuinely database-free;
- Database and Workspaces use Vibe64's existing managed MariaDB runtime.

If every foundation must literally use a database, the role and names of
Public, Accounts, and Database need to be redefined before the repositories are
generated.

## Repository Contract

Every seed repository must be usable outside Vibe64 as a normal JSKIT GitHub
repository. It must not depend on hidden files from a seed build service.

Each seed repository includes:

- complete JSKIT application source;
- `package.json` and the chosen package-manager lockfile;
- all required JSKIT package and bundle registrations;
- database migrations when the seed uses a database;
- deterministic starter data only when it improves the example;
- `vibe64.project.json` with a complete JSKIT project configuration;
- `vibe64.runtime-lock.json` matching that configuration;
- `vibe64.seed.json` with seed identity and provenance;
- a concise `README.md` describing the app and local development commands;
- tests and verification commands appropriate to the seed.

Each seed repository excludes:

- `.env` files and secrets;
- database credentials, database dumps, and runtime database volumes;
- real user accounts or personal information;
- `node_modules` and generated caches;
- GitHub or Vibe64 access tokens;
- environment-specific deployment state.

Seed repositories may accumulate maintenance history. A destination project
still receives a fresh one-commit history, so the source seed's maintenance
commits never become the user's project history.

## Seed Metadata

`vibe64.seed.json` is committed at the repository root. This requires adding it
to Vibe64's committed source contract. Version one has one optional parent:

```json
{
  "schema": "vibe64.seed",
  "schemaVersion": 1,
  "id": "jskit-todo",
  "name": "Todo",
  "description": "A complete personal todo application.",
  "kind": "example",
  "repository": "vibe64-dev/jskit-app-todo",
  "basedOn": {
    "id": "jskit-database",
    "repository": "vibe64-dev/jskit-seed-database"
  },
  "capabilities": {
    "authentication": "local-db",
    "database": "mariadb",
    "workspaces": false
  }
}
```

Allowed `kind` values in version one are:

- `foundation`
- `example`
- `vertical`

Foundation repositories use `"basedOn": null`. Example and vertical
repositories name the one repository from which their current design was
derived. Multiple-parent composition is deliberately out of scope.

The seed name describes the template, not the user's project. Selecting Todo
does not rename an online project or local directory to `todo`. The committed
metadata remains available so Vibe64 can continue to display "Started from
Todo" after the project has been renamed.

## Seed Index

The picker needs a trusted, ordered list of available seeds. Version one should
use a public `vibe64-dev/jskit-seeds` repository containing an `index.json`.
That repository is not itself a seed and is never copied into a user project.

An index entry contains the stable seed ID, GitHub repository, exact Git commit,
display order, and optional preview assets:

```json
{
  "schema": "vibe64.seed-index",
  "schemaVersion": 1,
  "seeds": [
    {
      "id": "jskit-todo",
      "repository": "vibe64-dev/jskit-app-todo",
      "revision": "0123456789abcdef0123456789abcdef01234567",
      "featured": true,
      "order": 100,
      "previewImage": "previews/jskit-todo.webp"
    }
  ]
}
```

The exact commit makes selection reproducible and prevents a seed from changing
between preview and installation. Updating a seed means publishing a commit and
then updating its index entry. Existing user projects are never changed.

The index is intentionally boring. It does not describe installation steps,
calculate dependencies, or merge repositories. Vibe64 resolves a trusted seed
ID to one trusted repository revision and fetches that tree.

Vibe64 should cache the last valid index and ship a small built-in fallback for
the four foundations so a temporary GitHub outage does not make empty projects
unusable.

## Empty-Project Gateway

Premade seeds are part of the shared public Vibe64 editor. Local and online
projects use the same gateway.

```text
Empty project
|-- Start from a ready-made app
|   `-- Pick seed -> materialize -> normal session
`-- Advanced setup
    `-- existing project type -> config -> empty app -> AI seeding questions
```

The online add-project flow may create the project record, managed bare
repository, or empty GitHub repository first. When that empty project is
opened, the shared gateway offers the same two choices as a local editor opened
on an empty directory.

The Advanced branch is the existing behavior. This work must not redesign its
screens, questions, or workflow.

An imported or existing repository with source bypasses this picker. It must
never be asked to replace its contents with a seed.

## Eligibility and Safety

Vibe64 may apply a premade seed only when all of the following are true:

- the destination source tree is empty, allowing only repository bookkeeping
  such as `.git`;
- the destination has no commit and no branch containing a commit;
- a destination GitHub remote, when present, has no branch or tag;
- no source session or worktree has been created for the project;
- the caller is allowed to write the destination project;
- the seed ID resolves through the trusted seed index;
- the source revision is a full pinned Git commit.

The server must take a project-scoped materialization lock and repeat the
eligibility checks after acquiring it. Two browser tabs must not be able to
seed the same project twice.

The apply endpoint accepts a seed ID, never an arbitrary clone URL. Repository
and revision resolution happens on the server. This prevents the feature from
becoming a general remote-code cloning endpoint.

## Materialization

The implementation uses Git directly against the selected GitHub repository.
It does not download an npm package or introduce a `.tgz` cache layer.

For every repository profile, the observable result is the same:

1. Resolve the seed ID through the trusted index.
2. Fetch the pinned source commit into temporary storage.
3. Validate `vibe64.seed.json`, `vibe64.project.json`, and the expected JSKIT
   application markers.
4. Validate that the metadata repository and seed ID match the index.
5. Recheck destination emptiness while holding the project lock.
6. Copy the source commit's tree without its `.git` directory.
7. Create a new parentless commit on destination branch `main`.
8. Store the source seed ID, repository, and revision in project metadata.
9. Push the single destination commit when the destination is GitHub-backed.
10. Re-read committed project configuration and enter the normal session flow.

The initial commit message should be stable and human-readable, for example:

```text
Start from Vibe64 seed: Todo
```

The destination must satisfy:

```text
git rev-list --count HEAD == 1
git rev-list --parents -n 1 HEAD has no parent commit
```

The destination retains its own GitHub remote. It must not retain the seed
repository as `origin`.

The implementation must support all current repository profiles:

- local source;
- Vibe64-managed canonical Git;
- GitHub-backed Git/PR workflow.

Materialization should be validated in temporary storage before the destination
is changed. A failure before destination commit creation leaves the project
empty and retryable. If a remote push succeeds but the response is interrupted,
the next request reconciles the existing commit instead of creating another.

## Database Provisioning

For a seed whose metadata declares `"database": "mariadb"`:

- `vibe64.project.json` selects the JSKIT MariaDB runtime;
- local authentication uses the database backend;
- Vibe64 provisions an isolated database through its existing managed database
  path before the first normal session starts;
- normal runtime environment injection provides credentials;
- committed migrations create the schema;
- optional starter rows are deterministic, non-sensitive, and safe to rerun;
- no database password or environment-specific database name is committed.

Provisioning failure keeps the project in a clear setup-error state with a
retry action. It must not fall through into conversational seeding.

Database contents are not part of the Git seed and are not copied from GitHub.
The repository provides migrations and seed-data code; Vibe64 provides the
actual database service and credentials.

## Ready-State Behavior

A successfully materialized repository already contains complete committed
project configuration and a complete JSKIT app. Consequently:

- project-type setup is skipped;
- project-config setup is skipped;
- conversational AI seeding questions are skipped;
- the first session is a normal development session on top of the initial
  commit;
- preview and database behavior are the same as for any already-seeded app.

The system should derive this from committed readiness and app markers, not
from a permanent special-case "pretend seeded" flag.

## Picker Experience

The empty-project experience should feel like choosing a strong starting point,
not configuring infrastructure.

The first screen presents two clear paths:

- **Start with a ready-made app**: the prominent default action.
- **Advanced setup**: the existing custom configuration and AI seeding flow.

The ready-made picker should include:

- a visually distinct section for the four foundations;
- a section for complete example apps;
- a section or filter for vertical apps when they exist;
- a strong name, short plain-language description, and preview image per seed;
- capability badges for accounts, database, and workspaces;
- a visible lineage label such as "Based on Database";
- a details view with provenance breadcrumbs;
- an obvious selected state and one primary "Use this seed" action;
- responsive keyboard-accessible cards, focus states, and screen-reader labels;
- polished light and dark themes;
- loading, unavailable-index, apply-progress, failure, and retry states.

Applying a seed should show real stages rather than an indefinite spinner:

```text
Preparing project -> Getting Todo -> Creating initial commit
                  -> Preparing database -> Ready
```

Only applicable stages are shown. The UI must not claim that a database is
being prepared for a database-free seed.

Because the operation is restricted to demonstrably empty projects, it does not
need a frightening destructive-action dialog. It should still clearly state
that the selected repository will become the project's starting point.

## Failure and Recovery

- An unavailable remote index uses the last valid cached index or built-in
  foundations.
- A missing or invalid pinned revision marks that seed temporarily unavailable.
- Invalid seed metadata prevents applying that seed and records an actionable
  server error.
- Loss of destination eligibility returns a conflict and refreshes the project
  normally; it never overwrites files.
- A failed database provision exposes retry and diagnostics without asking the
  AI to reseed the source.
- A browser refresh during materialization reconnects to or reconciles the same
  operation.
- Existing nonempty projects are always allowed to proceed normally even when
  the seed service or GitHub is unavailable.

## Seed Publishing Workflow

Publishing or updating a seed should be repeatable:

1. Generate or update the full JSKIT repository using official JSKIT tooling.
2. Pin deliberate JSKIT and package versions through committed manifests and
   lockfiles.
3. Add or update project and seed metadata.
4. Run formatting, unit tests, JSKIT verification, and production build.
5. For database seeds, run verification against a disposable MariaDB service.
6. Inspect the repository for secrets and ignored runtime files.
7. Push the seed commit to `vibe64-dev`.
8. Update the pinned revision and preview in the seed index.
9. Run index validation and a Vibe64 materialization smoke test.
10. Publish the index change.

An update affects only future selections. User projects are independent forks
of a tree, not subscribers to a seed release channel.

## Acceptance Criteria

The feature is complete when all of the following are demonstrably true:

- an empty local project can choose and apply every initial foundation;
- an empty managed-Git project can choose and apply every initial foundation;
- an empty GitHub project can choose and apply every initial foundation;
- every resulting destination has exactly one parentless commit;
- every resulting app opens directly into a normal development session;
- Database and Workspaces receive functioning isolated databases and pass
  migrations;
- Workspaces contains database-backed authentication and workspace support;
- Public and Accounts do not claim or require database configuration under the
  current matrix;
- Todo can be added as a complete second-level repository without changing the
  materialization protocol;
- a vertical Todo repository can point at Todo without runtime composition;
- the picker displays seed identity and lineage correctly;
- Advanced setup behaves exactly as it did before this feature;
- nonempty and imported repositories never see a destructive seed offer;
- concurrent apply requests cannot produce multiple commits;
- interrupted and failed operations recover without losing user source;
- no seed or destination repository contains credentials or database volumes.

## Checkable Implementation Plan

### Product contract

- [x] Use complete GitHub repositories as seeds.
- [x] Use direct Git fetch/clone semantics; do not use npm or `.tgz` transport.
- [x] Use `vibe64-dev` as the GitHub organization.
- [x] Choose the four initial foundation repository names.
- [x] Define the graph as provenance rather than runtime composition.
- [x] Keep Supabase out of the initial permutation matrix.
- [ ] Confirm the database wording in the foundation matrix before generating
  repositories.
- [ ] Approve the seed metadata and index schemas in this document.

### Seed infrastructure

- [ ] Create `vibe64-dev/jskit-seeds` for the public seed index.
- [ ] Add index schema validation and a four-foundation fallback index.
- [ ] Add preview-asset conventions and size limits.
- [ ] Add CI that verifies each pinned repository and revision is reachable.
- [ ] Add CI that checks index data against each repository's
  `vibe64.seed.json`.
- [ ] Document the seed publishing and revision-update procedure in the index
  repository.

### Foundation repositories

- [ ] Create `vibe64-dev/jskit-seed-public`.
- [ ] Create `vibe64-dev/jskit-seed-accounts`.
- [ ] Create `vibe64-dev/jskit-seed-database`.
- [ ] Create `vibe64-dev/jskit-seed-workspaces`.
- [ ] Generate each foundation with current official JSKIT tooling.
- [ ] Commit valid `vibe64.project.json` and `vibe64.runtime-lock.json` files.
- [ ] Commit valid `vibe64.seed.json` identity and provenance files.
- [ ] Add README, license, tests, screenshots, and verification workflows.
- [ ] Verify that no repository commits `.env`, credentials, database volumes,
  or dependency directories.
- [ ] Verify Database and Workspaces against disposable MariaDB in CI.
- [ ] Publish the four exact commit revisions in the seed index.

### Public Vibe64 server

- [ ] Extend the committed source contract to allow `vibe64.seed.json`.
- [ ] Add seed metadata and seed-index normalization/validation.
- [ ] Add cached index loading with the built-in foundation fallback.
- [ ] Add a read endpoint returning available seeds and destination eligibility.
- [ ] Add a write endpoint that accepts only a trusted seed ID.
- [ ] Add project-scoped locking and post-lock eligibility rechecks.
- [ ] Add materialization for local-source repositories.
- [ ] Add materialization for managed canonical-Git repositories.
- [ ] Add materialization for GitHub-backed repositories through the central
  execution and credential gateway.
- [ ] Create one fresh parentless destination commit from the selected tree.
- [ ] Preserve destination remotes and discard source-seed Git history/remotes.
- [ ] Store source seed ID, repository, and exact revision in project metadata.
- [ ] Reconcile interrupted remote pushes idempotently.
- [ ] Re-read committed readiness after materialization so normal setup gates are
  skipped naturally.
- [ ] Provision required databases through the existing managed database path.

### Shared public UI

- [ ] Add the ready-made-versus-Advanced choice to the shared empty-project
  gateway.
- [ ] Preserve the existing Advanced setup implementation and copy.
- [ ] Build the foundation, example, and vertical seed picker.
- [ ] Show preview, capabilities, and provenance on every seed card/detail view.
- [ ] Build real materialization and database progress states.
- [ ] Build empty, offline, unavailable-seed, error, and retry states.
- [ ] Make the picker responsive and fully keyboard accessible.
- [ ] Verify light and dark themes.
- [ ] Ensure nonempty/imported repositories bypass the picker.
- [ ] Ensure successful premade seeds bypass conversational AI seeding.

### Tests

- [ ] Unit-test metadata and index normalization.
- [ ] Unit-test trusted-ID resolution and rejection of arbitrary URLs.
- [ ] Unit-test empty-project eligibility and every disqualifying condition.
- [ ] Unit-test project locking and concurrent requests.
- [ ] Integration-test all three repository profiles.
- [ ] Assert exactly one parentless commit for every profile.
- [ ] Test seed validation failure before destination mutation.
- [ ] Test interrupted push reconciliation and retry behavior.
- [ ] Test MariaDB provisioning, migrations, and failure recovery.
- [ ] Test that committed readiness skips type, config, and AI seed gates.
- [ ] Add regression coverage for the unchanged Advanced flow.
- [ ] Add regression coverage for existing and imported repositories.
- [ ] Browser-test desktop, mobile, keyboard, light, and dark experiences.

### First example and vertical

- [ ] Create a complete Todo repository based on the approved foundation.
- [ ] Record Todo's parent in `vibe64.seed.json`.
- [ ] Add Todo to the index and verify it requires no Vibe64 protocol change.
- [ ] Create one complete vertical Todo repository.
- [ ] Record Todo as the vertical repository's parent.
- [ ] Verify the UI renders both provenance levels correctly.

### Release

- [ ] Run the complete public Vibe64 verification suite.
- [ ] Commit and push the public Vibe64 implementation.
- [ ] Update the deployment-managed public-editor reference in Vibe64 Online.
- [ ] Run the complete Vibe64 Online verification suite.
- [ ] Commit and push the Vibe64 Online integration.
- [ ] Deploy through the normal Vibe64 Online release process after explicit
  deployment approval.
- [ ] Smoke-test local and hosted empty projects after release.

## Explicitly Out of Scope for Version One

- Supabase as a foundation permutation;
- npm packages or tarballs as the seed transport;
- applying patches or child layers over a parent seed;
- merging more than one parent repository;
- automatic updates to projects created from older seed revisions;
- applying a seed over existing source;
- arbitrary user-supplied seed URLs;
- publishing database credentials, dumps, or runtime volumes in Git.
