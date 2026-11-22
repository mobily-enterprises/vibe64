# @local/vibe64-genesis

The single Vibe64 integration boundary around `genesis-compiler`. It validates
the exact versioned Genesis contracts for environment, workspace preparation,
launch, and deployment so the rest of Vibe64 never parses Stack source or
feature-detects compiler APIs.

Vibe64 explicitly supplies the optional `genesis-stack` catalog through this
boundary. The compiler remains technology-neutral; projects record the catalog
when a piece is selected so they remain portable outside Vibe64.

It initializes Genesis projects, selects Stack pieces, generates Codex task prompts, reads launch declarations, refreshes both Cities, and places the Genesis executable on Codex's PATH. Vibe64 packages use this boundary instead of reproducing Genesis prompts, skills, indexes, or explanatory contracts. Project verification runs through the Genesis CLI inside Vibe64's managed execution environment.

`inspectGenesisSkills()` and `syncGenesisSkills()` expose Genesis's read-only
skill inspection and explicit synchronization. Genesis owns freshness, source
selection (Vibe64's own Genesis for every project, whatever `genesis-compiler`
its `package.json` declares; only Genesis's own source repository serves its
own skills), and preservation of customizations. Callers
own source-write exclusion and the assistant's context refresh lifecycle.

## Resources a Development run needs

`./shared/resourceKinds` owns which declared Stack resources development needs
before the application runs: every kind but a `bucket`, without whose settings
the application uses its own default storage (`resourceRequiredInDevelopment`;
`resourceKindIsPersonSupplied` says a bucket is always the person's own). The
project's Env reads it through `@local/vibe64-project/server/resourceEnvironment`.
Genesis counts every declared resource as required, so the Outputs inspection
drops Genesis's `STACK_RESOURCE_MISSING` for a resource development does without,
by its id among the Stack's resources; every other diagnostic still disables the
targets.

## Resource estimates

`inspectVibe64ResourceEstimates()` reads the optional project-owned
`Resource estimates` section as `vibe64.resource-estimates.v1`. Outputs and
Workspace setup inspections include the same normalized `resourceEstimates`
value. These are initial planning estimates, not observed usage, reservations,
minimum requirements or granted memory limits. Execution hosts own those choices.

The section grammar, limits and a worked example are the agent spec printed by
`vibe64 spec resource-estimates` (`src/server/agentSpecs.js`).

The result contains `ready`, `unconfigured` or `invalid` status, exact Stack and
section identities, a normalized `estimatesHash`, project provenance, output and
setup estimates, and diagnostics. Missing/invalid hints have no numeric fallback
invented here: `fallbackReason` explains why the host's generic policy is needed.
Invalid estimates never change Outputs availability or setup readiness. Changing
only estimates does not change the preparation recipe identity. Mixed Stack
identities throw `VIBE64_STACK_CHANGED` so callers re-inspect instead of using
hints for a different source snapshot. Inspection never rewrites project source.

## Staging data

`inspectVibe64StagingData()` reads the optional project-owned `Staging data`
section as `vibe64.staging-data.v1`: the database resource of `## Resources`
it is for (a `mysql` or `postgresql` one, whose kind the result names as
`engine`), its mode (an own copy, empty, full or sampled, or production's
database, shared or with its structure frozen), the application's command that
writes production's dump to `{dump}`, and a sampled copy's table rules, links,
keep-together entries and contact columns. An absent section is `unconfigured`,
mode `empty`; a refusal throws `VIBE64_STAGING_DATA_INVALID` at its line. The
grammar is `vibe64 spec staging-data`; the Program page is
`genesis/program/projects/staging-data.md`.

## Agent specs

`./server/agentSpecs` holds the agent-readable spec of every Vibe64 Stack
section this package parses. Entry forms and limits come from the parsers' own
tables, and parser errors end with `Exact grammar: vibe64-helper spec <name>.`
Sessions read them with `vibe64-helper spec [<name>]`; outside a session use
`vibe64 spec [<name>]`. The Architecture inspection grammar, including the
optional Required files prerequisite that the System Graph consumer checks before
scanning source, is `vibe64 spec architecture-inspection`. Its optional Preview
locator names a technology's element-to-component script;
`readArchitecturePreviewLocator(sourceRoot, path)` reads it only as a regular
project `.js` file of at most 64 KiB. Its path may pass one linked package
folder under `node_modules`, as node resolution does, and no other symlink.
