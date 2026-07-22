# ProgSync

ProgSync keeps readable Program modules and their managed implementations
synchronized. It currently incubates inside Vibe64 as an independent workspace
package. Core synchronization is isolated in this package; its temporary
`command.js` adapter uses Vibe64's execution gateway. Extracting the package
requires replacing that single process-execution seam.

## CLI

From the Vibe64 repository:

```bash
npm run progsync -- src/lib/clipboard.js
npm run progsync -- program/src/lib/clipboard.js.md
npm run progsync -- status src/lib/clipboard.js
npm run progsync -- import src/lib/clipboard.js
npm run progsync -- import src/lib/clipboard.js --write
npm run progsync -- compile program/src/lib/clipboard.js.md
npm run progsync -- sync src/lib/clipboard.js
npm run progsync -- sync --changed
npm run progsync -- check
```

A bare Program or implementation path is the normal command. ProgSync resolves
the pair and automatically selects the synchronization direction. `status`
performs the same discovery without invoking AI or writing anything.

`import` is a dry run unless `--write` is supplied. `compile` and `sync` are
retained as explicit compatibility commands and apply validated candidates
unless `--dry-run` is supplied. Every operation accepts `--project-root` and
`--base`. An explicit `--base` bypasses private accepted state for that
invocation. `check` validates the complete Program graph and materializes any
missing or stale deterministic `.program/index/**/*.md.json` projections
while removing orphaned per-file projections, without invoking AI. It does not
build the project or prove behavioral
idempotence; those remain project-verification responsibilities.

## Library

The package exports:

- `importProgram()`
- `compileProgram()`
- `syncFile()`
- `statusFile()`
- `syncChanged()`
- `checkProgram()`
- Program path, parser, validation, and projection functions
- `createCodexExecRunner()` for non-interactive Codex execution

Every project operation requires an explicit `projectRoot`. Library callers can
inject a synchronizer runner for tests; the default invokes `codex exec` through
the host execution adapter.

## Prototype boundaries

The prototype supports `.js`, `.mjs`, `.html`, and Vue files using
`<script setup>` or no script. Target selection is inferred from the Program
filename. Application JSON remains retained JSON, and standalone CSS has no
independent Program counterpart.

ProgSync records accepted pairs in one worktree-local private Git ref:
`refs/worktree/progsync/state`. The ref points to a private checkpoint history
containing exact accepted Program and implementation blobs for all pairs. It
does not create a Git worktree, change `HEAD`, touch the project index, alter
`git status`, add branch commits, or get included in an ordinary push.

An applicable private checkpoint supplies the default accepted baseline. Git
`HEAD` is the conservative bootstrap/fallback baseline when no applicable pair
checkpoint exists. This distinction allows both files to remain dirty against
`HEAD` after synchronization while a repeated invocation correctly reports
`NO_CHANGE` and makes no AI call. Supplying `--base` explicitly requests a Git
baseline instead. Deletion and rename are not inferred.

The CLI reports Git changes and ProgSync changes separately. A pair may be
Git-dirty while fully synchronized.

`sync --changed` synchronizes directly changed supported pairs and follows
Program `Uses` links to schedule the transitive consumers of changed Program
providers such as `types.md` and root libraries. It also schedules modules that
consume changed retained assets and modules whose retained `package.json`
context changed. City Explorer integration is still deferred; the materialized
projections are its intended input.

The Codex runner receives a complete capsule in an ephemeral invocation, with
shell, web search, connectors, and collaboration disabled. Codex edits only a
disposable candidate tree through its patch mechanism. ProgSync rejects any
candidate path outside the selected module boundary, validates the result, and
only then applies it to the project.

Each pair is locked from snapshot through checkpoint. ProgSync rechecks that
neither real file changed while Codex was working, stages candidate writes,
checks each file again while installing it without overwriting a concurrent
path-level edit, rolls back ordinary apply failures, re-reads the final pair,
and advances the private ref only after final conformance validation. The
private accepted state is all-or-nothing; several filesystem operations are not
crash-atomic, so a process or machine crash during the short apply window can
require another sync.

The ephemeral candidate is a small standalone temporary Git repository, not a
`git worktree`. It is removed after each invocation. Persistent accepted state
uses the single private ref above, so synchronizing hundreds of files does not
create hundreds of worktrees or refs.

Declared auxiliary ownership is not implemented in this first package. The
current write boundary is exactly one Program file and one primary target.
Standalone CSS and other auxiliary artifacts are preserved because ProgSync
does not touch them; creating or synchronizing them awaits an explicit
ownership format.

JavaScript facts come from Babel's parser rather than regular expressions. Vue
uses the compiler SFC/DOM parsers and accepts `<script setup>` regardless of
attribute order, including TypeScript, plus scriptless components. HTML and
inline JavaScript are parsed before a candidate can be applied.

This is a trusted-local prototype, not yet a hostile-source security boundary.
The current host disables the user namespaces required by Codex's normal Linux
sandbox, so the runner uses a patch-only full-access invocation inside the
disposable candidate workspace. A production release must add an externally
enforced filesystem sandbox or another hardened execution backend.
