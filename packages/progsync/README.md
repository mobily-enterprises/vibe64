# ProgSync

ProgSync keeps readable Program modules and their managed implementations
synchronized. It currently incubates inside Vibe64 as an independent workspace
package. It has no Vibe64 runtime dependency: the default runner starts Codex
directly, and the package can be moved to its own repository without changing
its public API.

Program and managed implementation are complementary source. Program owns
observable meaning and intentional public composition. Managed implementation
owns compatible accumulated realization knowledge, including private structure,
optimizations, visual refinement, and verified repairs to synthesis errors.
ProgSync reconciles both against their last accepted pair; it does not treat a
working implementation as disposable compiler output.

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
npm run progsync -- author-prompt
```

A bare Program or implementation path is the normal command. ProgSync resolves
the pair and automatically selects the synchronization direction. `status`
performs the same discovery without invoking AI or writing anything.

`import` is a dry run unless `--write` is supplied. `compile` and `sync` are
retained as explicit compatibility commands and apply validated candidates
unless `--dry-run` is supplied. Every operation accepts `--project-root` and
`--base`. An explicit `--base` bypasses private accepted state for that
invocation, including every recorded context or dependency hash. `check`
validates the complete Program graph and materializes any
missing or stale deterministic `.program/index/**/*.md.json` projections
while removing orphaned per-file projections, without invoking AI. It does not
build the project or prove behavioral
idempotence; those remain project-verification responsibilities.

`author-prompt` prints the strict default Program-authoring prompt directly to
stdout. It requires no project or Git repository, performs no writes, and can
be composed with any project-aware agent runner.

## Library

The package exports:

- `synchronizeFile()`
- `statusFile()`
- `syncChanged()`
- `checkProgram()`
- `parseProgram()`
- `buildProgramProjection()`
- `readProgramAuthorPrompt()` for the strict default project-programming prompt

Every project operation requires an explicit `projectRoot`. Library callers can
inject a synchronizer runner for tests; the default starts an ephemeral
`codex exec` process pinned to `gpt-5.6-sol` with `xhigh` reasoning and a
60-minute bound. A timeout or output-limit failure terminates the complete
subprocess group so a native Codex descendant cannot outlive its wrapper.

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

Mass discovery respects Git's standard ignore rules. Runtime reports, build
output, caches, and any other non-source tree containing supported extensions
must be listed in `.gitignore` or kept outside the project source set. A common
prototype setup ignores `.program/` and the application's runtime `output/`
directory.

The strict default prompt for a project-aware AI that authors Program is
`prompts/program-author.txt`. It is distinct from the atomic synchronization
prompt. `progsync check` performs the deterministic part of the Program doctor:
it validates the canonical Parameters/What it does/Returns structure, links,
implicit shared types, projections, and the production-consumer rule. A future
semantic review may supplement those checks without replacing them.

The Codex runner receives a complete capsule in an ephemeral invocation, with
shell, web search, connectors, and collaboration disabled. Codex edits only a
disposable candidate tree through its patch mechanism. ProgSync rejects any
candidate path outside the selected module boundary, validates the result, and
only then applies it to the project. A repairable deterministic rejection keeps
that candidate tree intact and gives a fresh runner the complete diagnostic so
it can repair the candidate in place; no rejected write reaches the project.

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

Each target-bound Program module owns one primary target and a deterministic
private auxiliary root: remove the target's final extension and append `/`.
For example, `program/src/index.js.md` owns `src/index.js` and every regular
file below `src/index/`. The Atomic Synchronizer may create and minimally
maintain those files in the same transaction, while its public conformance
surface remains the primary target. Auxiliary exports and imports are private
implementation links and never become Program Provides or Uses.

Source-to-Program synchronization may additionally update `program/types.md`
when the implementation establishes a new or changed complex public type. It
may change only definitions used by that module and preserves unrelated shared
types. Standalone CSS normally remains an owned auxiliary of a Vue, HTML, or
shared presentation module rather than receiving a `.css.md` counterpart.

JavaScript facts come from Babel's parser rather than regular expressions. Vue
uses the compiler SFC/DOM parsers and accepts `<script setup>` regardless of
attribute order, including TypeScript, plus scriptless components. HTML and
inline JavaScript are parsed before a candidate can be applied.

This is a trusted-local prototype, not yet a hostile-source security boundary.
The current host disables the user namespaces required by Codex's normal Linux
sandbox, so the runner uses a patch-only full-access invocation inside the
disposable candidate workspace. A production release must add an externally
enforced filesystem sandbox or another hardened execution backend.
