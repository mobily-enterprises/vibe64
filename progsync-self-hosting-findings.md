# ProgSync self-hosting findings

Status: active experiment. The current source-free implementation passes 51 of
73 untouched original tests after Program and compiler improvements. This is a
failure ledger and structural-improvement record, not a claim that self-hosting
already passes. A second clean generation has not yet been attempted.

## Purpose

The experiment describes every JavaScript-family file in ProgSync as Program,
removes the original implementation, generates the package from Program with
fresh atomic Codex runs, and executes both the generated tests and the untouched
original test suite.

The objective is not to nurse one generated tree into passing. Every material
failure must improve at least one reusable layer:

1. the Program authoring rules and creator prompt;
2. the atomic compiler prompt and context capsule;
3. deterministic extraction, validation, or orchestration; or
4. the authored Program when it omitted genuine program meaning.

Generated JavaScript is never patched directly to make this experiment pass.
After the repair cycle succeeds, the generated tree must be discarded and a
second clean generation must pass from Program alone. That clean repetition is
the evidence that the system improved structurally.

## Executive finding

ProgSync has demonstrated that a fresh model can generate a complete,
installable JavaScript package from Program, and that relatively small Program
and compiler-contract improvements can remove broad classes of failures. It has
not yet demonstrated dependable behavioral reconstruction of a complex package.

The main weakness is not JavaScript syntax generation. The generated package
usually parses, exports plausible symbols, and runs. The weakness is preserving
exact data contracts at module boundaries:

- how several values are grouped into arguments;
- the exact fields and provenance of returned objects;
- callback input field names;
- exact status, mode, reason, diagnostic, and discriminator literals;
- the shape of shared structural records;
- the depth and contents of bounded dependency context; and
- small but observable parser and filesystem edge cases.

These omissions compound. A single wrong field in a central snapshot object, or
one collapsed call to a Git command runner, can fail dozens of tests in modules
that are otherwise correct. The first failure count therefore overstated the
number of independent defects, but it accurately exposed that the prototype did
not yet make those contracts mechanically explicit.

The correct conclusion is:

> The programming model is viable enough to continue, but Vibe64 should not yet
> depend on one-shot natural-language regeneration. ProgSync first needs a
> stronger deterministic semantic spine, behavioral verification as a mandatory
> compilation phase, and a clean-generation conformance benchmark.

The natural-language body should remain readable. The answer is not to turn it
into pseudocode. The answer is to make the small set of facts that software must
link across files—symbols, argument groups, object fields, return shapes, exact
literals, effects, and providers—available to deterministic tooling.

## Repositories used

- Original package and compiler under test:
  `/home/merc/Development/current/vibe64/packages/progsync`
- Assimilation repository containing original source and creator-authored
  Program: `/home/merc/Development/current/progsync-selfhost`
- Source-free generation repository:
  `/home/merc/Development/current/progsync-selfhost-genesis`
- Independent verifier containing untouched original tests:
  `/home/merc/Development/current/progsync-selfhost-original-tests`

The original package passed all 73 original tests before assimilation. The
creator produced Program counterparts for 33 JavaScript-family files plus
`program/types.md`; deterministic Program validation passed all 34 files. The
first source-free generation created all 33 target files without copying old
source.

## First-generation result

- Generated test suite: 15 passed and 56 failed out of 71 tests.
- Untouched original test suite against the generated implementation: 14
  passed and 59 failed out of 73 tests.

The untouched original suite is the decisive behavioral oracle. Generated
tests are useful evidence, but cannot certify their own generator.

## First repair-pass result

After repairing exported object boundaries, command permissions, entrypoint
surfaces, and shared source-fact types, all 33 pairs were accepted again. Only
five implementation/test files required a patch in the final pass; the rest
were accepted unchanged.

- Generated test suite: 14 passed and 57 failed out of 71 tests.
- Untouched original test suite: 17 passed and 56 failed out of 73 tests.

This is only a small oracle improvement, so the package is still far from
self-hosting. Inspection of the first shared stack trace found another central
boundary defect: `gitResult()` passes one object to `runProgSyncCommand()`,
although the latter accepts `command`, `args`, and one options object. That
single bad edge breaks nearly every Git-backed operation and therefore accounts
for a large portion of the remaining failures.

## Structural findings and fixes

### 1. Argument grouping was missing from the semantic boundary

Symptom: object parameters such as `{ projectRoot, programPath, ... }` were
described as lists of names and regenerated as several positional arguments.
Callers still passed one object, producing widespread failures far from the
actual defect.

Root cause: extraction retained parameter names but discarded which names
belonged to one argument. English signatures sometimes listed object fields
without explicitly saying that they formed one object.

Reusable fixes:

- JavaScript source facts now expose `parameterGroups`; each group records one
  actual argument, its kind, public names, default status, and rest status.
- The creator prompt requires the canonical phrase “one object containing ...”
  and forbids flattening its public fields into positional parameters.
- The JavaScript compiler prompt states that `parameterGroups` is a binding
  contract and requires generated definitions and call sites to preserve it.
- Candidate conformance now rejects a positional implementation when Program's
  opening signature declares an object group, and the retry diagnostic prints
  the candidate's actual argument grouping.
- Public destructuring keys are now reported instead of local aliases. For
  `{ projection: suppliedProjection }`, Program owns the public field
  `projection`, not the private local name `suppliedProjection`.
- Focused tests prove grouped extraction, alias handling, rejection, diagnostic
  propagation, and successful retry.

Authoring rule: an ordinary named parameter must retain its exact name. A
destructured boundary must say “one object containing” and name its public
fields. Whether the implementation uses private aliases remains a realization
detail.

### 2. Opening signatures must survive punctuation inside symbols

Symptom: a signature containing a symbol such as `process.argv` was cut at the
dot and incorrectly diagnosed as lacking a return value.

Root cause: the Program parser treated the first dot as the end of the opening
sentence without respecting inline-code spans.

Reusable fix: opening-sentence extraction ignores punctuation inside Markdown
code spans, with parser regression coverage.

### 3. Exported classes need one deterministic readable structure

Symptom: creator and parser could disagree about whether a class, its methods,
or both belonged directly beneath `## Provides`.

Reusable fixes:

- The creator and atomic prompts now require a class link under `## Provides`,
  a `## Class `ClassName`` section, and intentionally public methods as `###`
  headings beneath that class.
- Private and convention-private methods remain implementation details.
- Structural validation checks exact exported class and public-method surfaces.

### 4. Commands and test modules have public behavior without exports

Symptom: files under `bin/` and `*.test.js` could appear to provide nothing
because their meaningful surface is execution rather than a JavaScript export.

Reusable fixes:

- A shebang JavaScript file under `bin/` deterministically provides one command
  named by its filename stem.
- A `name.test.js` or `name.test.mjs` file provides one `name tests` suite.
- Creator and compiler prompts describe arguments, registered tests, effects,
  failures, assertions, and exit behavior without inventing fake exports.
- Candidate validation recognizes these entrypoint surfaces.

### 5. Executable permissions are compiler responsibility

Symptom: a correctly generated command had mode `0644`, so it was not a usable
command. Asking Codex to run `chmod` failed because the isolated editing
interface only writes content.

Reusable fixes:

- ProgSync deterministically gives command candidates executable bits after
  generation and before validation/installation.
- An already-correct command with only a mode mismatch is normalized without
  invoking an LLM.
- The compiler prompt says to preserve the shebang and not block merely because
  its file-editing tools cannot alter modes.
- Tests cover fresh generation and deterministic repair of an existing command.

### 6. Direct interface closure must stay bounded

Symptom: compiling a forwarding/index module pulled substantial dependency
implementation into what should have been an atomic interface capsule.

Root cause: context resolution followed implementation dependencies too far.

Reusable fix: direct imported Program interfaces and reachable types are
resolved, but dependency implementations are not recursively supplied. Tests
cover the bounded closure.

### 7. A rejected candidate needs a repair-grade diagnostic

Symptom: the terminal originally reported only `PAIR_SURFACE_MISMATCH`, making
it appear that the retry AI had received equally little information.

Reusable fixes:

- Retry prompts receive the full normalized diagnostic object, including every
  missing or contradictory symbol fact.
- CLI output now prints the diagnostic message and formatted detail object, so
  humans see the same actionable reason.
- A deterministic rejection permits exactly one informed retry; neither
  rejected candidate is installed.

### 8. Shared structural types must specify their complete public shape

Symptom: Program referred to broad objects such as `[Source facts]`, but their
definitions did not determine fields needed by consumers. Different modules
then generated mutually incompatible records.

Reusable authoring fix: `program/types.md` now describes the externally shared
shape of source facts, parameter groups, exports, imports, ambient uses,
diagnostics, and HTML resource facts. Private temporary records remain absent.

This is a Program sufficiency fix rather than a request for target-language
types. JavaScript may erase semantic type declarations while still preserving
the object fields and meanings at module boundaries.

### 9. Imported-call argument groups are part of Program

Symptom: the exported signature of `runProgSyncCommand()` was corrected to
three arguments, but generated `gitResult()` called it with one object. The
compiler knew the provider interface and the names of values being passed, yet
the caller's prose did not explicitly partition those values into arguments.
The resulting object reached `path.basename()` as the command and caused the
same `ERR_INVALID_ARG_TYPE` across most Git, checkpoint, context, safety, and
service tests.

Root cause: deterministic conformance currently verifies imported symbol
identity, but not the argument grouping of call expressions at imported
boundaries. The creator prompt told the AI to preserve grouping, but the
authored sentence “calls ... with command, arguments, working directory, and
option fields” was still compatible with more than one call shape.

Required reusable fixes:

- Program must state exact outside-call groups. For this call it should say:
  “calls `runProgSyncCommand()` with three arguments: `git`; `args`; and one
  object containing ...”.
- The creator prompt must require explicit argument counts/grouping whenever an
  imported callable has more than one argument or an object argument.
- The compiler prompt must treat that grouping as architecture, not target
  syntax.
- JavaScript source facts should eventually record imported call sites with
  callee identity and argument groups. Candidate conformance can then reject a
  caller whose imported-call arity/grouping contradicts Program or the resolved
  provider interface.
- A focused cross-module regression fixture must prove that the caller cannot
  collapse `(command, args, options)` into one object or flatten `options`.

Until deterministic imported-call validation exists, exact caller prose and
integration tests are carrying too much of this responsibility.

The first corrected call edge raised the untouched oracle from 17 to 27 passing
tests out of 73, confirming that many apparent failures were cascades rather
than independent defects.

### 10. Complex return types need exact field provenance

Symptom: generated `readPairSnapshot()` returned `previousProgram`,
`currentProgram`, `previousImplementation`, and `currentImplementation`.
Consumers read the contractually required `P0`, `P1`, `I0`, and `I1`, causing
`undefined.exists` failures across synchronization, context, safety, and
service tests. Checkpoint reason strings were also plausibly paraphrased, for
example `continued-history` instead of `same-branch-history-continues`.

Root cause: the shared type named the compact fields, while the operation prose
only said “previous and current files.” It did not map every returned key to its
data source, and it described reason categories without preserving their exact
machine-observed literals. The compiler chose readable but incompatible names.

Reusable fixes:

- `[State snapshot]` now enumerates every public field.
- `readPairSnapshot()` Program maps `P0`, `P1`, `I0`, `I1`, Git-base fields,
  both change classifications, and baseline metadata to their exact sources.
- `readCheckpointPair()` Program names every exact reason literal.
- The creator prompt now requires field-level provenance for complex returns
  and exact status/mode/reason/discriminator literals.
- The compiler prompt treats resolved complex types and those literals as
  field-level data contracts rather than naming suggestions.

Future deterministic conformance should compare returned object keys against
resolved shared types where static analysis can establish them.

The exact field repair raised the untouched oracle from 27 to 28 passing tests.
It removed the `undefined.exists` cascade, exposing the next caller-boundary
defect: `runCandidateSynchronization()` supplied `workspacePath` to a runner
whose public input is `workspaceRoot`. Its Program had said only “the workspace
path.” The candidate Program now names the complete runner input object and the
compiler must preserve those exact callback-boundary keys just as it preserves
ordinary imported-call keys.

That repair removed the undefined workspace-path failure but did not yet raise
the pass count, because execution immediately reached a generated
`validatePairConformance()` whose calls to `extractSourceFacts()`,
`sourceFactUses()`, and `parseProgram()` also used obsolete positional groups.
Its Program named the data but not the argument partitions. The conformance
Program now states each imported call's exact argument count and object fields,
and also includes executable entrypoints and canonical object-parameter
grouping in the surface it validates.

The conformance repair raised the untouched oracle from 28 to 30 passing
tests. Its remaining simple-module mismatches were traced to `structural.js`:
the first generated extractor called a locally declared function exported via
`export { name }` a value, called forwarding exports `forwarding` instead of
the contracted `forward`, returned parameter records where the contract
requires name texts, omitted CommonJS exports and `ambientUses`, and used
noncontract field names for imports. The structural Program now enumerates
these public syntax-to-fact mappings, Vue diagnostic identities, and HTML asset
rules explicitly. These are observable compiler outputs, not private parser
helpers.

The resulting structural rewrite raised the untouched oracle from 30 to 42
passing tests out of 73. JavaScript exports, CommonJS exports, platform uses,
import shapes, runtime Vue macro diagnostics, and most source-fact contracts
then passed without directly editing generated JavaScript.

## What the progression proves

| Untouched tests passing | Change that exposed or removed the defect class |
| ---: | --- |
| 14/73 | First source-free generation. |
| 17/73 | First Program repair pass, entrypoint handling, executable mode, and shared source-fact types. |
| 27/73 | Exact three-argument grouping for the central Git command call. |
| 28/73 | Exact state-snapshot fields, provenance, and checkpoint reason literals. |
| 30/73 | Exact argument groups for conformance's imported calls. |
| 42/73 | A substantially more complete structural-extraction contract. |
| 48/73 | Exact Program parser diagnostics, projection fields, ownership omission, and provider validation. |
| 51/73 | Local Vue type resolution, HTML resource behavior, and completion-aware candidate validation. |

This progression is important for two reasons.

First, most generated failures were not random hallucinations. They were
reasonable implementations of prose that left more than one observable choice
open. When the Program named an exact boundary, a fresh atomic compilation was
usually able to implement it.

Second, prose alone did not reliably signal which details were semantically
load-bearing. The generated implementation often chose nicer names or simpler
structures that were locally sensible and globally incompatible. That means
prompt improvements are necessary but insufficient. Repeatedly saying “be
exact” cannot replace deterministic contract data.

## Why the package needed so much repair

### The experiment selected a difficult self-hosting subject

ProgSync is not ordinary CRUD or business logic. It is a compiler-like tool
whose observable behavior includes parsing, graph closure, Git ancestry,
atomic filesystem installation, concurrency, executable modes, stable JSON,
exact diagnostics, and adversarial path handling. Many details that would be
private in an application are public behavior in this package because other
modules and tests consume them.

That makes it a useful benchmark, but a poor expectation for effortless first
generation. Passing it would provide stronger evidence than generating a small
application; failing it does not mean the model cannot help with simpler
software.

### The creator compressed away essential information

The creator correctly removed loops, temporary variables, helper functions, and
syntax. It also removed some facts that were not implementation details:

- argument grouping at imported call sites;
- exact public object keys;
- where each returned field came from;
- exact machine-observed literals;
- callback and runner object shapes;
- parser diagnostic identities; and
- state transitions used across modules.

The distinction must be sharper:

> A private mechanism may disappear. A fact read by another module, user,
> process, file, test, or tool is observable Program meaning and must remain.

### Shared types were initially names rather than complete contracts

A reference such as `[Source facts]` helps a reader only when the shared type
defines every public field needed by its consumers. Early definitions captured
the concept but not the complete record. Each generated module then made a
plausible independent choice, producing incompatible records.

Shared types must stay selective—ordinary scalar variables do not belong in
`types.md`—but every complex type that crosses a file boundary must be complete.
In untyped JavaScript this is even more important, not less: Program is the only
portable declaration of the shape.

### Structural validation covered exports before it covered data flow

The first validator could reject a missing or renamed export. It could not
reject a correct export whose callers passed the wrong argument groups, whose
return object used different keys, or whose exact status strings differed.
Those candidates therefore installed and failed later in integration tests.

Export parity is a useful first gate, not sufficient conformance.

### One retry cannot compensate for missing evidence

The diagnostic-informed retry is valuable when a candidate has a local,
deterministically identifiable defect. It cannot recover behavior that neither
Program, the context capsule, nor a verifier states. More retries against the
same incomplete input would merely sample more guesses.

Retries should be reserved for repairable synthesis defects. Missing meaning
must produce a Program diagnostic or a request for bounded evidence.

### The generated tests are not an independent oracle

The first generated tests omitted some of the same behavior that the generated
implementation omitted. The untouched original suite consistently found more
defects. This confirms that tests produced from the same Program are useful for
traceability but cannot prove that assimilation preserved a legacy system.

Importing an existing project requires an independent behavioral oracle:
retained tests, recorded traces, fixtures, protocol examples, or other evidence
not synthesized from the same compressed representation.

### 11. Exact names and absence are part of structured output

Symptom: the generated Program parser returned plausible but incompatible
projection fields such as `programPath`, `typeReferences`, and `relationship`
where consumers require `programFile`, `types`, and `kind`. It emitted an
unprefixed source digest, represented absent class ownership as null, and used
different diagnostic identifiers.

Reusable fixes:

- Shared Program types now enumerate exact parser and projection fields.
- Program states which optional fields are omitted rather than set to null.
- Machine-consumed diagnostic identifiers are listed as exact literals.
- Projection examples distinguish exact public names from equivalent prose.

One atomic regeneration then passed all eight untouched Program parser tests
and raised the full oracle from 42 to 48 passing tests.

### 12. Behavioral evidence needs an atomic repair path

Symptom: generated HTML extraction parsed correctly but gave a private helper
and a local result collection the same name. JavaScript's temporal dead zone
caused a runtime `ReferenceError`. Structural conformance could not observe the
defect, and an ordinary synchronization correctly—but unhelpfully—reported
that the implementation already expressed the Program example.

The exact failing example and stack message were appended to a fresh atomic
candidate prompt. The candidate could edit only `src/structural.js`; normal
write-boundary and pair conformance checks still applied. It made the one
private binding change required and preserved Program. No generated JavaScript
was manually patched.

This validates the repair-loop architecture and exposes a missing product
surface: project verification evidence must be feedable into a bounded
reconciliation without manufacturing a semantic Program change. Such repairs
remain implementation knowledge unless the evidence reveals omitted behavior.

The same pass made locally declared Vue interface and type-alias members
explicit Program behavior and required candidate validation to finish source
fact extraction before returning. All nine untouched structural tests passed,
raising the full oracle from 48 to 51.

## Current remaining failure clusters

The latest untouched run has 22 failures. These are clusters, not 22 independent
design problems:

| Cluster | Failing tests | Current indication |
| --- | ---: | --- |
| Context assembly and invalidation | 13 | Provider interfaces, retained assets, type closure, and changed-dependency scheduling remain incomplete or use incompatible record shapes. |
| Checkpoint, CLI, and projection reports | 5 | Several returned report booleans or file-installation paths are missing or named differently; one dry-run path is read before installation. |
| Safety and filesystem metadata | 2 | Shared-type concurrent modification detection and executable-mode preservation remain incomplete. |
| Candidate/service rejection behavior | 2 | Surface-mismatch tests reach a different failure boundary than the API contract expects. |

Some context and service failures are consequences of the Program parser or
structural extractor. Repair should therefore continue from the lowest shared
layer upward rather than patching tests in numerical order.

## How to make ProgSync dependable enough for Vibe64

### 1. Add a deterministic semantic contract beside the prose

Keep `## Uses`, `## Provides`, linked symbols, and readable English as the
authoring surface. Extend the deterministic `.md.json` projection so it can
represent only the cross-file facts that the experiment proved necessary:

- provided symbol kind and exact identity;
- parameter count and grouping;
- public object-field names for grouped parameters;
- returned complex type and, where needed, field provenance;
- imported callable identity and call argument groups;
- exact externally observed literals;
- declared mutation, filesystem, process, network, and logging effects;
- meaningful failure behavior; and
- source locations back into Program.

The projection must be derived from Program, never hand-edited and never contain
meaning absent from Program. If the prose cannot be deterministically projected,
`progsync doctor` should reject it before an LLM compiles anything.

This is the smallest formal spine consistent with “programming in English.” It
does not record loops, maps, helpers, temporary names, parser implementation, or
target syntax.

### 2. Make shared complex types first-class compiler inputs

For each compiled module, resolve only the reachable definitions from
`program/types.md`. Validate that every field used at a public boundary exists,
and that required fields are neither silently renamed nor omitted.

The compiler should compare:

1. Program parameter and return references;
2. resolved complex type fields;
3. mechanically extracted implementation boundary shapes; and
4. consumer usage where static analysis can establish it.

This also fixes scaling: unrelated edits elsewhere in `types.md` must not alter
a module's context hash or schedule it for recompilation.

### 3. Extract and validate imported call sites

JavaScript source facts should record calls to imported symbols with:

- resolved provider identity;
- argument count;
- argument group kinds;
- object keys supplied at the boundary;
- whether the result is awaited or otherwise consumed when that is observable;
- result fields read by the caller; and
- source location.

Candidate conformance can then catch `(command, args, options)` becoming one
object before tests run. Calls to private helpers remain erased.

### 4. Treat compiler output as a candidate until layered verification passes

One atomic synchronization should have four explicit gates:

1. **Program gate:** deterministic format, symbol, provider, type, and ambiguity
   checks.
2. **Candidate gate:** parse/build, export parity, imported-call compatibility,
   return-shape compatibility, allowed-path enforcement, and metadata checks.
3. **Module gate:** tests or properties derived from Program and resolved
   interfaces.
4. **Integration gate:** retained project tests, targeted consumer tests, and
   runtime or browser evidence where applicable.

Only a candidate that passes the applicable gates may replace managed
implementation or advance the accepted checkpoint.

### 5. Use targeted evidence, not unrestricted repository access

Atomicity should continue to constrain writes to one Program module and its
owned artifacts. When the capsule cannot close the module, the compiler may
request a specific bounded item:

- the Program interface of one imported symbol;
- one reachable complex type;
- a retained fixture or asset explicitly referenced by Program;
- one consumer boundary needed to disambiguate an exported record; or
- one relevant retained test or trace during legacy assimilation.

The request and supplied evidence should be recorded in the compilation report.
The model should not browse the repository freely.

### 6. Separate assimilation confidence from normal synchronization

For a new project authored in Program, Program defines the behavior from the
beginning. For a legacy import, the creator is compressing an existing program
and can omit meaning. The tool should report assimilation coverage rather than
immediately treating imported Program as proven authoritative.

Suggested states:

- `draft`: Program parses but has not regenerated a candidate;
- `structurally-closed`: symbols, types, and providers resolve;
- `behaviorally-checked`: retained module evidence passes;
- `integration-checked`: affected project verification passes; and
- `clean-generation-proven`: a source-free rerun passes the retained oracle.

Vibe64 can display these states without pretending that an LLM confidence score
is proof.

### 7. Let diagnostics drive bounded iterative repair

The current one diagnostic-informed retry is safe but arbitrary. A better
compilation workspace can iterate while each attempt makes measurable progress:

- never install a rejected candidate;
- provide the full normalized diagnostic, relevant Program sentence, resolved
  interface, and failing assertion or trace;
- allow only owned implementation artifacts to change;
- stop on repeated diagnostics, no progress, a small attempt budget, or evidence
  that Program is missing meaning; and
- elevate semantic discoveries into a proposed Program change rather than
  silently encoding them in implementation.

This is not permission to retry until tests happen to pass. Every successful
repair must still conform to Program and preserve unrelated managed details.

### 8. Establish a permanent conformance corpus

Before Vibe64 depends on ProgSync, the repository should contain representative
Program modules and untouched or independently authored oracles for:

- pure transformations;
- complex object boundaries;
- multiple imported-call argument groups;
- classes and forwarding exports;
- commands and executable metadata;
- Git and filesystem effects;
- concurrency and race protection;
- Vue components, HTML documents, assets, and visual preservation;
- retained JSON and package context;
- exact diagnostics and status literals; and
- missing-side, one-side-changed, both-sides-changed, rename, and conflict cases.

Every compiler-prompt, parser, projection, or conformance change must run this
corpus. Model and prompt versions should be pinned in the result so a model
upgrade cannot silently change compiler behavior.

### 9. Roll Vibe64 out in increasing-risk stages

Recommended adoption order:

1. Read-only Program import, projection, City visualization, and doctor checks.
2. Program-to-implementation suggestions shown as reviewable diffs.
3. Automatic synchronization for low-risk, strongly tested modules.
4. Vue and application modules with browser and visual verification.
5. Compiler, persistence, authentication, deployment, and other critical
   modules only after the clean-generation corpus is consistently green.

Managed implementation must remain inspectable and recoverable throughout.
ProgSync should never auto-accept a behavior-changing patch solely because the
model says it is correct.

## Production-readiness gates

Vibe64 should not make ProgSync its default write path until all of the following
are true:

- A clean source-free generation passes the complete untouched 73-test oracle.
- Repeating that clean generation with fresh model sessions passes again.
- All generated package tests pass, while remaining explicitly secondary to the
  untouched oracle.
- No generated JavaScript was manually repaired between Program and passing
  output.
- Every discovered omission has a regression test in creator, parser,
  projection, conformance, or compilation behavior.
- Running synchronization again with unchanged inputs produces no patch.
- An implementation-only realization change survives a later Program change.
- A Program-only behavioral change produces the smallest compatible
  implementation patch.
- Concurrent edits, modes, symlinks, paths, and accepted checkpoints retain
  their safety properties.
- Context closure and hashing operate on reachable dependencies rather than an
  ever-growing global prompt.
- Failure output identifies the module, Program location, violated boundary,
  expected facts, actual facts, and the evidence needed to continue.

Passing once is a milestone, not the final reliability claim. The corpus should
also pass across multiple fresh compilations and after a pinned model or prompt
upgrade.

## Direct recommendation

Continue the experiment and integrate the read-only parts with Vibe64 early.
Do not yet base Vibe64's authoritative editing workflow on automatic ProgSync
installation.

The first self-hosting run did not invalidate the idea. It identified the
compiler work that the initial prototype had deferred: natural-language source
needs deterministic boundary contracts and independent behavioral evidence.
Those are finite, testable engineering problems. The clean second generation
will determine whether the current approach solves them without making Program
unreadable.

## Open findings

### Over-broad context invalidation

A change to `program/types.md` currently schedules modules that do not refer to
the changed types because the complete shared-types file contributes to their
context hash. This is correct but unnecessarily expensive. Context hashing
should eventually use only the reachable type closure so a large project does
not recompile unrelated modules.

### Natural-language signature validation remains intentionally narrow

The current deterministic grouping check recognizes the canonical creator
phrase “one object containing ...”. The prompts must continue emitting that
form. If future Program permits several equivalent phrasings, signature parsing
will need a structured semantic projection rather than increasingly loose
regular expressions.

During the repair pass this gate caught an older creator sentence that called
`base` both the parameter and a field of an “optional options object.” The
candidate itself correctly retained one object, but the noncanonical Program
wording made the first validator revision infer zero object groups. The
candidate was not installed. The Program sentence was corrected to
“one optional object containing `base`,” reinforcing that creator conformance
must be checked before compiler conformance.

## Superseded assimilation-format example

Recorded on 2026-07-23 during the stopped pinned Sol/xhigh generation. The
three-heading function structure below was accepted, but the example's content
was subsequently found to expose private mechanisms, single-consumer helpers,
low-level APIs, and internal error construction. It is retained only as the
evidence that led to the correction. It is not a canonical Program function
and must not be fed back into the author or compiler prompts.

The normative decision is
[`software_development_revolution.md`, section 0](software_development_revolution.md#0-authoritative-abstraction-boundary).
That decision requires a deliberately minimal public Program architecture,
observable guarantees instead of mechanisms, public Uses only, owned private
implementation artifacts, and tests that do not determine Program symbols.

Each provided function should use three explicit subsections beneath its
symbol heading:

- `#### Parameters` gives the exact parameter grouping, fields, types, and
  defaults.
- `#### What it does` contains the ordered semantic data flow and outside
  calls.
- `#### Returns` gives the result independently of the parameter sentence.

The proposed canonical rendering of `applyCandidates()` is:

### `applyCandidates()`

#### Parameters

* an object containing:
  * `candidates`: a list of [Candidate file write] values
  * `expectedFiles`: a list of [Expected file state] values defaulting to an
    empty list
  * `expectedPair`: an optional [Expected pair] value defaulting to absent
  * `pair`: a [Module pair]
  * `programSourceForProjection`: optional Program source text defaulting to
    absent

#### What it does

1. It begins with every candidate write. When a Program candidate exists, or
   otherwise when `programSourceForProjection` is present, it obtains the
   Program projection with
   [`buildProgramProjection()`](@/src/program.js.md#buildprogramprojection),
   obtains its path with
   [`projectionPathForProgram()`](@/src/paths.js.md#projectionpathforprogram),
   and adds a write containing canonical JSON from
   [`stableJson()`](@/src/program.js.md#stablejson). When a candidate targets
   [`SHARED_TYPES_PATH`](@/src/constants.js.md#shared-types-path), it likewise
   adds that Program's projection write.
2. For every resulting write, it obtains the current [Source file state]
   through [`readWorkingFile()`](@/src/git.js.md#readworkingfile). It also reads
   any expected path not already covered. If any expected state differs in
   existence, content, tracked mode, or available permission bits, it raises
   [`ProgSyncError()`](@/src/errors.js.md#progsyncerror) with code
   `PAIR_CHANGED_DURING_SYNCHRONIZATION` before installing any write. The same
   failure occurs when either state in `expectedPair` differs from the current
   Program or implementation state.
3. It excludes writes whose source and effective permissions already match.
   For each remaining write in order, it obtains the target with
   [`absoluteProjectPath()`](@/src/paths.js.md#absoluteprojectpath), stages the
   source and effective permissions through
   [`stageFileWrite()`](@/src/files.js.md#stagefilewrite), then installs the
   staged write with the same displacement and recovery behavior as
   `installStagedWrite()`. Effective permissions are the candidate permissions,
   otherwise existing permissions, otherwise `0644`.
4. If staging fails, it removes every staged temporary file through
   [`fs()`](package:npm/node:fs/promises#default) and propagates the failure. If
   installation or post-installation verification fails, it rolls completed
   writes back in reverse order only while each target still equals the
   attempted state, restores available backups, removes remaining staged files,
   and propagates the original failure. When rollback cannot safely finish, it
   instead raises [`ProgSyncError()`](@/src/errors.js.md#progsyncerror) with code
   `APPLY_ROLLBACK_INCOMPLETE` and diagnostics describing untouched or
   unrestored paths.
5. After all writes are installed, it verifies that every displaced backup
   still equals its original state, including permission bits. A mismatch
   raises `PAIR_CHANGED_DURING_SYNCHRONIZATION` and identifies the recovery
   path. Otherwise it removes the backups and returns the paths of the effective
   writes in their installation order.

#### Returns

A list of project-relative paths actually written.

Accepted format conclusions:

- Every provided function uses `Parameters`, `What it does`, and `Returns` H4
  headings.
- Object parameter grouping uses an outer bullet with nested field bullets;
  positional parameters use one bullet each.
- A no-result operation says `No value.` under `Returns`.
- The author prompt, parser, projection, compiler prompt, and conformance rules
  migrate together.
- The prose under those headings is rewritten from Program meaning. The
  implementation-heavy `applyCandidates()` example above is not reused.

## Replacement completion loop

The old thirty-three-target experiment was stopped after nine accepted targets.
Its repository, checkpoints, and log remain evidence; it must not be resumed as
the authoritative experiment.

1. Define the intended external package, command, component, and service
   surfaces without consulting JavaScript exports as authority.
2. Build a production-only consumer graph and classify every assimilated symbol
   as externally invoked, used by at least two production Program modules,
   single-consumer, test-only, or unused.
3. Keep only externally invoked and deliberately shared symbols, subject to the
   narrow boundary exception in the normative specification.
4. Rewrite every surviving function into the accepted three-heading format,
   removing low-level calls and replacing mechanisms with observable guarantees
   and important reasons.
5. Add deterministic ownership for private implementation files so removing a
   Program module does not require flattening or discarding mature code.
6. Remove the one-to-one `program/test/*.md` corpus. Retain the existing
   JavaScript tests separately as an assimilation oracle.
7. Rewrite or remove oracle tests that import test-only helpers; preserve valid
   black-box behavioral tests.
8. Update the author prompt, parser, projection, compiler prompt, conformance
   rules, City graph, and atomic write boundary for the new model.
9. Generate only the production implementation from the rewritten Program with
   fresh pinned Sol/xhigh invocations.
10. Run the independent adapted oracle suite against that generated production
    implementation without manually repairing generated source.

Only the final two steps test the intended invention: whether a small readable
Program architecture can produce a correct implementation without inheriting
the original target's private decomposition.
