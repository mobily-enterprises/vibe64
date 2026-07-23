# ProgSync v2 architecture

This document records the production-surface audit and the deliberately small
Program-module map used by the first self-hosting experiment. It is a design
decision, not an inventory that makes the current JavaScript decomposition
authoritative.

## Audit rules

- A production consumer is a non-test source file that imports or forwards the
  named export today. A forwarding export is shown but does not, by itself,
  prove that the symbol deserves to remain public.
- Test consumers never count toward Program architecture.
- `External` means that the symbol is intentionally retained as a package,
  command, or host-framework boundary in v2. Merely being reachable through
  today's broad `src/index.js` barrel does not make an export intentional.
- `Two modules` is evaluated against the proposed production Program modules,
  not the number of private JavaScript files in the old realization.
- `private` means the behavior is absorbed into an owning Program operation.
  The implementation may retain, rename, combine, or remove the helper.
- `auxiliary` means the file may remain as precious private implementation
  owned by another Program module; it receives no Program counterpart.

## Definition export audit

`src/index.js (forward)` in a consumer column is the current package barrel,
not an independent semantic consumer.

| Defining file | Export | Production consumers | Test-only consumers | External | Two modules | Disposition | Proposed owner |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `package.descriptor.mjs` | `default` | none | none | yes, JSKIT loader | exception | Program value | Package descriptor |
| `candidate.js` | `applyCandidates()` | `service.js` | none | no | no | private | ProgSync library |
| `candidate.js` | `installStagedWrite()` | none | `safety.test.js` | no | no | private; remove export | ProgSync library |
| `candidate.js` | `runCandidateSynchronization()` | `service.js` | none | no | no | private | ProgSync library |
| `candidate.js` | `validateImplementationCandidate()` | none | `structural.test.js` | no | no | private; remove export | ProgSync library |
| `checkpoint.js` | `checkpointPair()` | `service.js`, `index.js (forward)` | none | no | no | private | ProgSync library |
| `checkpoint.js` | `pairId()` | `index.js (forward)` | none | no | no | private; remove export | ProgSync library |
| `checkpoint.js` | `readCheckpointPair()` | none | none | no | no | private; remove export | ProgSync library |
| `checkpoint.js` | `readPairSnapshot()` | `service.js`, `index.js (forward)` | none | no | no | private | ProgSync library |
| `checkpoint.js` | `receiptPathForPair()` | `index.js (forward)` | none | no | no | private; remove export | ProgSync library |
| `cli.js` | `HELP` | none | none | no | no | private | Command-line interface |
| `cli.js` | `parseArguments()` | none | `cli.test.js` | no | no | private; remove export | Command-line interface |
| `cli.js` | `runCli()` | `bin/progsync.js` | none | yes, `./cli` package API | exception | Program function | Command-line interface |
| `codexRunner.js` | `DEFAULT_CODEX_MODEL` | none | `codexRunner.test.js` | no | no | private; remove export | ProgSync library |
| `codexRunner.js` | `DEFAULT_CODEX_REASONING_EFFORT` | none | `codexRunner.test.js` | no | no | private; remove export | ProgSync library |
| `codexRunner.js` | `DEFAULT_TIMEOUT_MS` | none | `codexRunner.test.js` | no | no | private; remove export | ProgSync library |
| `codexRunner.js` | `codexRunnerProfile()` | `context.js` | `codexRunner.test.js` | no | no | private | ProgSync library |
| `codexRunner.js` | `createCodexExecRunner()` | `service.js`, `index.js (forward)` | `codexRunner.test.js` | no | no | private | ProgSync library |
| `codexRunner.js` | `parseJsonResult()` | none | none | no | no | private; remove export | ProgSync library |
| `codexRunner.js` | `validateRunnerResult()` | `candidate.js` | `codexRunner.test.js` | no | no | private | ProgSync library |
| `command.js` | `runProgSyncCommand()` | `candidate.js`, `codexRunner.js`, `git.js` | four test files | no | no; all consumers collapse | private | ProgSync library |
| `conformance.js` | `validatePairConformance()` | `candidate.js`, `service.js` | none | no | no; consumers collapse | private | ProgSync library |
| `constants.js` | `DEFAULT_GIT_BASE` | `checkpoint.js`, `git.js` | none | no | no; consumers collapse | private | ProgSync library |
| `constants.js` | `PROGRAM_DIRECTORY` | `paths.js` | none | no | no | private | ProgSync library |
| `constants.js` | `PROGRAM_INDEX_DIRECTORY` | `paths.js` | none | no | no | private | ProgSync library |
| `constants.js` | `SHARED_TYPES_PATH` | `candidate.js`, `context.js`, `service.js` | none | no | no; consumers collapse | private | ProgSync library |
| `constants.js` | `PROGSYNC_STATE_REF` | `checkpoint.js` | three test files | no | no | private | ProgSync library |
| `constants.js` | `PROGSYNC_STATE_SCHEMA_VERSION` | `checkpoint.js` | none | no | no | private | ProgSync library |
| `constants.js` | `SYNCHRONIZATION_MODES` | `codexRunner.js` | none | no | no | private | ProgSync library |
| `constants.js` | `TARGETS` | `paths.js` | none | no | no | private | ProgSync library |
| `context.js` | `allowedPathsForMode()` | none | none | no | no | private; remove export | ProgSync library |
| `context.js` | `buildContextCapsule()` | `service.js` | none | no | no | private | ProgSync library |
| `context.js` | `extractSourceFacts()` | none | none | no | no | remove duplicate forwarding export | ProgSync library |
| `context.js` | `resolveProgramReferences()` | none | none | no | no | private; remove export | ProgSync library |
| `context.js` | `sourceFactUses()` | `conformance.js` | none | no | no | private | ProgSync library |
| `errors.js` | `ProgSyncError` | fourteen private files, `index.js (forward)` | none | no public type required | no; consumers collapse | private implementation class | ProgSync library |
| `errors.js` | `asDiagnostic()` | `cli.js`, `service.js`, `index.js (forward)` | none | no | no; library and CLI need only diagnostic data | private | ProgSync library |
| `files.js` | `stageFileWrite()` | `candidate.js` | none | no | no | private | ProgSync library |
| `files.js` | `writeFileAtomic()` | `program.js` | none | no | no | private | ProgSync library |
| `git.js` | `assertGitRepository()` | `checkpoint.js`, `service.js` | none | no | no; consumers collapse | private | ProgSync library |
| `git.js` | `changedGitPaths()` | `service.js` | none | no | no | private | ProgSync library |
| `git.js` | `currentGitContext()` | `checkpoint.js` | none | no | no | private | ProgSync library |
| `git.js` | `gitResult()` | `checkpoint.js` | none | no | no | private | ProgSync library |
| `git.js` | `isGitAncestor()` | `checkpoint.js` | none | no | no | private | ProgSync library |
| `git.js` | `readGitFile()` | `checkpoint.js` | none | no | no | private | ProgSync library |
| `git.js` | `parseNulPaths()` | `candidate.js` | none | no | no | private | ProgSync library |
| `git.js` | `readWorkingFile()` | four private files | none | no | no; consumers collapse | private | ProgSync library |
| `git.js` | `resolveGitBase()` | `checkpoint.js` | none | no | no | private | ProgSync library |
| `git.js` | `resolveOptionalCommit()` | `checkpoint.js` | none | no | no | private | ProgSync library |
| `git.js` | `runGit()` | `checkpoint.js`, `lock.js` | none | no | no; consumers collapse | private | ProgSync library |
| `lock.js` | `acquirePairLock()` | `service.js` | `safety.test.js` | no | no | private | ProgSync library |
| `paths.js` | `absoluteProjectPath()` | seven private files | none | no | no; consumers collapse | private | ProgSync library |
| `paths.js` | `implementationToProgramPath()` | `structural.js`, `index.js (forward)` | none | no | no | private | ProgSync library |
| `paths.js` | `isSupportedImplementationPath()` | `service.js` | none | no | no | private | ProgSync library |
| `paths.js` | `isTargetBoundProgramPath()` | `service.js` | none | no | no | private | ProgSync library |
| `paths.js` | `programToImplementationPath()` | `program.js`, `index.js (forward)` | none | no | no | private | ProgSync library |
| `paths.js` | `projectRelativePath()` | `service.js` | none | no | no | private | ProgSync library |
| `paths.js` | `projectRootPath()` | `service.js` | none | no | no | private | ProgSync library |
| `paths.js` | `projectionPathForProgram()` | four private files, `index.js (forward)` | none | no | no; consumers collapse | private | ProgSync library |
| `paths.js` | `resolveModulePair()` | `service.js`, `index.js (forward)` | `safety.test.js` | no | no | private | ProgSync library |
| `paths.js` | `slashPath()` | six private files | none | no | no; consumers collapse | private | ProgSync library |
| `paths.js` | `targetForImplementationPath()` | `program.js`, `index.js (forward)` | none | no | no | private | ProgSync library |
| `program.js` | `assertValidProgram()` | four private files, `index.js (forward)` | none | no | no; validation is part of public operations | private | ProgSync library |
| `program.js` | `buildProgramProjection()` | two private files, `index.js (forward)` | none | yes, retained public projection API | exception | Program function | ProgSync library |
| `program.js` | `parseProgram()` | three private files, `index.js (forward)` | none | yes, retained public parser API | exception | Program function | ProgSync library |
| `program.js` | `projectionStatus()` | `service.js`, `index.js (forward)` | none | no | no | private | ProgSync library |
| `program.js` | `stableJson()` | three private files, `index.js (forward)` | none | no | no; canonicalization is realization | private | ProgSync library |
| `program.js` | `symbolAnchor()` | four private files, `index.js (forward)` | none | no | no | private | ProgSync library |
| `program.js` | `writeProgramProjection()` | `service.js`, `index.js (forward)` | none | no | no | private | ProgSync library |
| `prompts.js` | `composeAtomicPrompt()` | `service.js` | `prompts.test.js` | no | no | private | ProgSync library |
| `prompts.js` | `promptFingerprint()` | `context.js` | none | no | no | private | ProgSync library |
| `prompts.js` | `readProgramAuthorPrompt()` | `cli.js`, `index.js (forward)` | none | yes, retained package API and CLI output | exception | Program function | ProgSync library |
| `prompts.js` | `synchronizerSchemaPath()` | `codexRunner.js` | none | no | no | private | ProgSync library |
| `service.js` | `checkProgram()` | `cli.js`, `index.js (forward)` | none | yes, package API | exception | Program function | ProgSync library |
| `service.js` | `compileProgram()` | `cli.js`, `index.js (forward)` | none | no; directed mode is an option | no | private wrapper; remove export | ProgSync library |
| `service.js` | `importProgram()` | `cli.js`, `index.js (forward)` | none | no; directed mode is an option | no | private wrapper; remove export | ProgSync library |
| `service.js` | `syncChanged()` | `cli.js`, `index.js (forward)` | none | yes, package API | exception | Program function | ProgSync library |
| `service.js` | `syncFile()` | `cli.js`, `index.js (forward)` | none | no; duplicates synchronizer | no | private wrapper; remove export | ProgSync library |
| `service.js` | `statusFile()` | `cli.js`, `index.js (forward)` | none | yes, package API | exception | Program function | ProgSync library |
| `service.js` | `synchronizeFile()` | `index.js (forward)` | none | yes, package API | exception | Program function | ProgSync library |
| `state.js` | `classifyPair()` | `service.js`, `index.js (forward)` | none | no | no | private | ProgSync library |
| `state.js` | `fileChanged()` | `candidate.js`, `checkpoint.js` | none | no | no; consumers collapse | private | ProgSync library |
| `state.js` | `pairDigest()` | `checkpoint.js`, `lock.js` | `safety.test.js` | no | no; consumers collapse | private | ProgSync library |
| `state.js` | `snapshotSummary()` | `context.js` | none | no | no | private | ProgSync library |
| `state.js` | `sourceHash()` | `checkpoint.js` | none | no | no | private | ProgSync library |
| `structural.js` | `extractJavaScriptFacts()` | none | none | no | no | private; remove export | ProgSync library |
| `structural.js` | `extractSourceFacts()` | three private files | `structural.test.js` | no | no; consumers collapse | private | ProgSync library |
| `structural.js` | `extractVueFacts()` | none | none | no | no | private; remove export | ProgSync library |
| `structural.js` | `javascriptAst()` | none | none | no | no | private; remove export | ProgSync library |

## Current barrel export audit

The root barrel currently forwards 28 names. The disposition of each is
explicit here so removal is not mistaken for an omission.

| `src/index.js` forwarded export | v2 disposition |
| --- | --- |
| `checkProgram()` | keep as a ProgSync library Program function |
| `compileProgram()` | remove; select `compile` through `synchronizeFile()` |
| `importProgram()` | remove; select `import` through `synchronizeFile()` |
| `syncChanged()` | keep as a ProgSync library Program function |
| `syncFile()` | remove; duplicate of `synchronizeFile()` |
| `statusFile()` | keep as a ProgSync library Program function |
| `synchronizeFile()` | keep as a ProgSync library Program function |
| `assertValidProgram()` | remove; private validation mechanism |
| `buildProgramProjection()` | keep as a ProgSync library Program function |
| `parseProgram()` | keep as a ProgSync library Program function |
| `projectionStatus()` | remove; private synchronization mechanism |
| `stableJson()` | remove; private realization detail |
| `symbolAnchor()` | remove; private identity realization detail |
| `writeProgramProjection()` | remove; performed by synchronization/checking |
| `implementationToProgramPath()` | remove; private path rule |
| `programToImplementationPath()` | remove; private path rule |
| `projectionPathForProgram()` | remove; private path rule |
| `resolveModulePair()` | remove; private path rule |
| `targetForImplementationPath()` | remove; private target rule |
| `classifyPair()` | remove; private state-machine mechanism |
| `checkpointPair()` | remove; private acceptance mechanism |
| `pairId()` | remove; private identity mechanism |
| `readPairSnapshot()` | remove; private state mechanism |
| `receiptPathForPair()` | remove; private state layout |
| `createCodexExecRunner()` | remove; default translation is part of synchronization |
| `readProgramAuthorPrompt()` | keep as a ProgSync library Program function |
| `ProgSyncError` | remove; callers rely on stable diagnostic data, not a class identity |
| `asDiagnostic()` | remove; private presentation mechanism |

## Approved v2 Program module map

The self-hosting production corpus has four target-bound Program modules and
one shared type registry. This is intentionally not a mirror of the old
nineteen-file `src/` implementation.

| Program module | Primary target | Public surface | Private implementation ownership |
| --- | --- | --- | --- |
| ProgSync library | `src/index.js` | `synchronizeFile()`, `syncChanged()`, `statusFile()`, `checkProgram()`, `parseProgram()`, `buildProgramProjection()`, `readProgramAuthorPrompt()` | Any files below `src/index/` |
| Command-line interface | `src/cli.js` | `runCli()` | Any files below `src/cli/` |
| ProgSync command | `bin/progsync.js` | executable `progsync` command | Any files below `bin/progsync/` |
| Vibe64 package descriptor | `package.descriptor.mjs` | default structured descriptor | Any files below `package.descriptor/` |
| Shared types | no implementation target | complex public types referenced by the four modules | none |

The deterministic auxiliary root removes any need to expose private filenames
in Program: strip the primary target's final extension and append `/`.
`src/index.js`, for example, owns `src/index/`. A file under that root cannot be
owned by another module. Existing implementation outside the conventional root
requires explicit migration before it can participate in v2 synchronization.
The mature ProgSync implementation has now completed that migration: its public
`src/index.js` remains stable and every root-module helper lives below
`src/index/`.

The retained, non-Program inputs are `package.json`, the prompt text files, the
result schema, README material, and independent JavaScript tests. They are not
silently writable by an atomic synchronizer.

## Consequences for tests

The v2 oracle may import only the seven root library functions and `runCli()`.
It may invoke the `progsync` executable. It must not import files below
`src/index/` or `src/cli/`, and it must not require a particular auxiliary file,
helper name, parser library, lock algorithm, temporary directory layout, or
Git command sequence. Safety, rollback, parsing, projection, synchronization,
and checkpoint behavior remain testable through those public boundaries.
