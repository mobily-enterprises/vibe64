# ProgSync public types

Shared complex values crossing ProgSync's public module boundaries.

## Uses

- Nothing outside this file.

## Provides

### `Program diagnostic`

A `Program diagnostic` contains `code`, its stable machine-readable identifier;
`message`, its readable explanation; `line`, the one-based Program line when
known; and optional `details` containing structured evidence. Diagnostic codes
and details are data, not instructions.

### `Program use`

A `Program use` contains `symbol`, the exact visible public symbol; `provider`,
its canonical Program, package, platform, or asset identity; optional
`description`; and `source`, a [Source location].

### `Source location`

A `Source location` contains `line`, the one-based source line or nothing when
the relationship was derived without a single authored line.

### `Program parameter field`

A `Program parameter field` contains `name`, the exact backticked field name,
and `description`, its complete authored bullet text.

### `Program parameter`

A `Program parameter` contains `name`, the exact positional name or nothing
for a destructured object; `description`, its complete authored bullet text;
and `fields`, the ordered list of [Program parameter field] values nested under
that object argument.

### `Program provide`

A `Program provide` contains:

* `name`: the exact public heading
* optional `owner`: the exported class that owns a method
* optional `memberKind`: `constructor`, `instance`, or `static` for a class method
* `kind`: one of `function`, `method`, `class`, `value`, `command`, `component`,
  `document`, `type`, or `library`
* `description`: the complete authored body
* `typeReferences`: the reachable shared type names
* `source`: a [Source location]
* for a function, method, or command only, ordered `parameters` plus the exact
  `behavior` and `returns` text from its three required subsections

### `Projected Program provide`

A `Projected Program provide` contains:

* `id`: the stable identity `@/<Program path without program/>#<anchor>`
* `name`, optional `owner`, optional `memberKind`, `kind`, `description`, and
  `source` copied from the [Program provide]
* for a function, method, or command only, `parameters`, `behavior`, and
  `returns` copied from that provide

Optional fields are absent when they do not apply; they are never emitted as
`null` or empty placeholder text.

It does not contain private implementation symbols or a field named
`identity`.

### `Projected Program use`

A `Projected Program use` contains `symbol`, `provider`, optional `description`,
and `source` copied from the [Program use], plus `kind`: `generation` when the
provider begins with `asset:` or is an `@/<file>.md#<anchor>` whose file part
contains no `/`, and otherwise `runtime`.

The optional `description` is absent when Uses supplies no description; it is
never emitted as empty text.

### `Projected type reference`

A `Projected type reference` contains `name`; `provider`, always
`@/types.md#<anchor of name>`; and its [Source location].

### `Parsed Program`

A `Parsed Program` contains `source`, the normalized complete source;
`programPath`, its canonical project-relative path; `title`; `preamble`;
ordered `uses`, `provides`, and `typeReferences`; ordered `diagnostics`; and
`valid`, which is true exactly when diagnostics is empty.

### `Program projection`

A `Program projection` is the deterministic schema-version-2 City record for
one Program file. It contains exactly:

* `schemaVersion`: the number `2`
* `programFile`: the canonical project-relative Program path
* `targetFile`: the path obtained by removing `program/` and the final `.md`, or
  `null` for a shared type or Program-library file
* `targetKind`: the inferred target kind, `types`, or `library`
* `auxiliaryRoot`: the target path without its final extension and with a final
  `/`, or `null` when there is no target
* `sourceHash`: `sha256:` followed by the SHA-256 hash of exact normalized
  Program source
* `title` and `preamble`
* `typeReferences`: ordered [Projected type reference] values
* `provides`: ordered [Projected Program provide] values
* `uses`: ordered [Projected Program use] values
* `diagnostics`: ordered local [Program diagnostic] values

Object keys are canonicalized recursively for byte-stable JSON. The projection
contains no meaning absent from Program and no private implementation symbols.

### `Parse options`

`Parse options` contains optional `programPath`, defaulting to
`program/unknown.js.md`, which controls target-kind classification and stable
identities without changing the supplied Program text.

### `Projection request`

A `Projection request` contains `programPath`; either `programSource` or an
already parsed `parsedProgram`; and may contain both when the parsed value came
from exactly that source.

### `Atomic runner request`

An `Atomic runner request` contains `workspaceRoot`, the disposable candidate
root; `prompt`, the complete trusted synchronizer prompt and delimited
untrusted capsule; `mode`; exact `allowedPaths`; owned
`allowedPathPrefixes`; and optional `onEvent` for progress records.

### `Atomic runner`

An `Atomic runner` is an operation that accepts an [Atomic runner request], may
write only within its supplied candidate boundary, and returns a
[Synchronizer report]. It never writes the real project directly.

### `Source exported-symbol evidence`

A `Source exported-symbol evidence` contains `name`, the exact implementation
export; `kind`; ordered distinct `productionConsumers`; ordered distinct
`testConsumers`; and `externallyInvoked`, true when the export crosses an
external package or process boundary.

### `Source target-boundary evidence`

A `Source target-boundary evidence` contains `externallyInvoked`; optional
`manifestPath` and `matchedTarget`; and optional `reason` describing the
entrypoint, component, document, descriptor, or package-manifest boundary.

### `Source surface evidence`

A `Source surface evidence` contains:

* `complete`: whether every possible consumer and boundary could be analyzed
  without material ambiguity
* `diagnostics`: ordered records explaining every incomplete or ambiguous item
* `entrypoint`: the mechanically observed executable entrypoint, or no value
* `exports`: ordered [Source exported-symbol evidence] values
* `targetBoundary`: the [Source target-boundary evidence] for the implementation

It never silently presents partial consumer evidence as complete.

### `Synchronization request`

A `Synchronization request` contains `projectRoot`, the explicit Git worktree
subtree that owns `program/`; `inputPath`, one Program or implementation path
inside that root; optional `operation`, one of `sync`, `import`, or `compile`
defaulting to `sync`; optional `base`, an explicit Git revision that bypasses
accepted private state; optional `dependencyChanged` defaulting to false;
optional `runner`, an [Atomic runner] replacing the pinned default; optional
`onEvent`; and optional `write` defaulting to true.

### `Module pair`

A `Module pair` contains absolute `projectRoot`; `programPath`;
`implementationPath`; and `target`, whose `extension`, `kind`, and prompt
identify the supported translator.

### `Discovery record`

A `Discovery record` contains `type` equal to `progsync.discovery`, stable
`code`, readable `message`, and structured `details`. Records appear in the
order ProgSync established the input, counterpart, target, baseline, changes,
owned auxiliaries, context, and selected mode.

### `Synchronizer report`

A `Synchronizer report` contains `status`, one of `updated`, `unchanged`, or
`blocked`; the selected `mode`; `summary`; and ordered text lists named
`programChanges`, `implementationChanges`,
`preservedImplementationDetails`, `sharedDefinitionProposals`, `diagnostics`,
`verificationPerformed`, and `verificationStillRequired`.

### `Synchronization result`

A `Synchronization result` contains `status`; selected `mode`; resolved
`pair`; `baselineKind`; optional `baseCommit`; Git and accepted-state change
summaries; ordered `discovery`; candidate `diff`; `changedFiles`; `applied`;
`checkpointed`; optional `checkpoint`; and the [Synchronizer report]. A blocked
or dry-run result changes no real project file.

### `Changed synchronization request`

A `Changed synchronization request` contains `projectRoot`; optional `base`;
optional `runner`; optional `onEvent`; and optional `write` defaulting to true.

### `Changed synchronization result`

A `Changed synchronization result` contains overall `status`; optional
`baseCommit`; ordered `results` of [Synchronization result] values; and ordered
`skippedPaths` that were changed but neither a supported pair nor a dependency
of one.

### `Status request`

A `Status request` contains `projectRoot`, `inputPath`, and optional `base`.

### `Status result`

A `Status result` contains `status`, equal to `synchronized` or `pending`;
`reconciled`; selected `mode`; resolved `pair`; baseline and checkpoint data;
Git and accepted-state changes; and ordered `discovery`. It contains no
candidate or filesystem mutation.

### `Program check request`

A `Program check request` contains `projectRoot`, the explicit root whose
`program/` tree and `.program/index/` projection tree are checked.

### `Program file check`

A `Program file check` contains `programPath`; ordered structural and graph
`diagnostics`; `projectionPath`; `projectionCurrent`; `projectionUpdated`;
public Uses; and implicit type references. Each projected provide additionally
contains `productionConsumers`, the sorted distinct production Program paths;
`testConsumers`, the sorted distinct Program-test paths; and
`externallyInvoked`, true for a command, component, document, package
descriptor, or target exposed by the nearest package manifest's `exports`,
`main`, `module`, or `bin`. The field is named `externallyInvoked`, not
`externalBoundary`.

### `Program check result`

A `Program check result` contains `status`, equal to `ok` only when every file
has no diagnostic and otherwise `invalid`; ordered `files` of
[Program file check]; and ordered `removedProjectionPaths` for orphaned
generated projections removed during the check.

### `Vibe64 package descriptor`

A `Vibe64 package descriptor` contains exactly:

* `packageVersion`: `1`
* `packageId`: `@local/progsync`
* `version`: `0.1.0`
* `kind`: `runtime`
* `description`: exactly `Owns Program parsing, projection, Git-aware
  synchronization, and the standalone progsync CLI.`
* `dependsOn`: an empty list
* `capabilities`: an object whose `provides` is the one-item list
  `library.progsync` and whose `requires` is an empty list
* `runtime`: an object whose `server` and `client` each contain an empty
  `providers` list
* `metadata`: an object containing:
  * `apiSummary`: an object containing:
    * `surfaces`: in order:
      * an object containing `subpath` equal to `.` and `summary` exactly
        `Exposes extraction-ready Program parsing, indexing, and synchronization APIs.`
      * an object containing `subpath` equal to `./cli` and `summary` exactly
        `Exposes the standalone ProgSync command-line entrypoint.`
    * `containerTokens`: an object whose `server` and `client` are empty lists
  * `jskit`: an object whose `scaffoldShape` is `library-v1`, whose
    `scaffoldMode` is `manual`, and whose `lane` is `default`
* `mutations`: an object containing:
  * `dependencies`: an object whose `runtime` maps `@babel/parser` to
    `^7.29.3`, `@vue/compiler-dom` to `^3.5.34`, and `@vue/compiler-sfc` to
    `^3.5.34`, and whose `dev` is empty
  * `packageJson`: an object containing an empty `scripts` object
  * `procfile`: an empty object
  * `files`: an empty list
  * `text`: an empty list

No synonymous legacy descriptor fields are present.
