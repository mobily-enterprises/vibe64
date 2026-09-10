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
skill inspection and explicit synchronization. Genesis owns freshness,
project-pinned source selection, and preservation of customizations. Callers
own source-write exclusion and the assistant's context refresh lifecycle.

## Resource estimates

`inspectVibe64ResourceEstimates()` reads the optional project-owned
`Resource estimates` section as `vibe64.resource-estimates.v1`. Outputs and
Workspace setup inspections include the same normalized `resourceEstimates`
value. These are initial planning estimates, not observed usage, reservations,
minimum requirements or granted memory limits. Execution hosts own those choices.

An interactive output declares separate startup and running typical/high pairs:

```markdown
## Resource estimates

### Output `app`

- Startup typical MiB: `1024`
- Startup high MiB: `1536`
- Running typical MiB: `768`
- Running high MiB: `1536`

### Workspace setup

- Typical MiB: `1024`
- High MiB: `1536`
```

Output ids must already exist in Outputs. Finite outputs use only `Typical MiB`
and `High MiB`, just like Workspace setup. Setup estimates require declared
preparation steps. Each phase requires both values; typical cannot exceed high.
Values are integer MiB from 1 through 1048576, normalized to bytes. Duplicate
operations/fields, unknown fields and executable entries are rejected. The section
is bounded to 64 KiB and 2048 lines. `- Nothing.` explicitly declares no estimates.

The result contains `ready`, `unconfigured` or `invalid` status, exact Stack and
section identities, a normalized `estimatesHash`, project provenance, output and
setup estimates, and diagnostics. Missing/invalid hints have no numeric fallback
invented here: `fallbackReason` explains why the host's generic policy is needed.
Invalid estimates never change Outputs availability or setup readiness. Changing
only estimates does not change the preparation recipe identity. Mixed Stack
identities throw `VIBE64_STACK_CHANGED` so callers re-inspect instead of using
hints for a different source snapshot. Inspection never rewrites project source.
