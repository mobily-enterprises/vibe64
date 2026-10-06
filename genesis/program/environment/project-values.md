# Project environment

People can supply the environment values a project needs while Vibe64 and its
host provide managed system values separately.

## Sources

- `packages/vibe64-project/src/server/service.js`
- `packages/vibe64-project/src/server/actions.js`
- `packages/vibe64-project/src/server/inputSchemas.js`
- `packages/vibe64-project/src/server/settingsAssistantContracts.js`
- `tests/server/vibe64SettingsActionTools.unit.test.js`
- `packages/vibe64-project/src/server/resourceEnvironment.js`
- `packages/vibe64-project/src/server/projectEnvironmentFiles.js`
- `packages/vibe64-terminals/src/server/projectExecutionEnv.js`
- `packages/vibe64-terminals/src/server/agentPreviewCommand.js`
- `packages/vibe64-terminals/src/server/agent/providers/claudeConversationHost.js`
- `packages/vibe64-terminals/src/server/opencodeServerProcess.js`
- `packages/vibe64-terminals/src/server/agentCommandEnvironment.js`
- `packages/vibe64-terminals/src/server/agentEnvCommand.js`
- `src/components/studio/EnvPanel.vue`
- `src/components/studio/vibe64-session/Vibe64ProjectOnboarding.vue`
- `src/components/studio/RuntimeConfigRecordsTable.vue`

## Public contract

The environment view distinguishes editable user values from host-owned system
values, masks secrets, supports explicit add, replace, and confirmed removal,
and applies values to session preparation, checks, launches, and agent work.
Codex, Claude, and OpenCode session commands receive the resolved development
environment. Managed browser workers and Playwright commands resolve it in their
registered project's context at process startup, using the owning session source.
This read does not provision resources or project environment files. A failed
read prevents execution. Existing browser workers retain their startup values;
closing the managed browser lets the next command start it with current values.
Values remain process input rather than generated wrapper or browser metadata.
Integration setup can prefill an Env key without supplying a value. Public
values start empty and unmasked; secret entries start empty and masked.
Navigation never saves a value automatically.
Colleague shares the canonical Env read action with current project and source
authority. Its bounded result includes names, ownership, editability, secret
classification, value presence and missing status, never values or private source
paths. Missing totals include records outside the first 100 entries; truncation,
inspection warnings and unavailability prevent a claim of complete setup.
Names longer than the presentation bound also mark the result incomplete.
The returned source identifies the exact session inspected. The `prod` scope
on this project action describes project-stored configuration, not the hosted
deployment's production environment. Colleague opens the ordinary Env view for
secret entry or stored-value inspection. This metadata read neither prepares
resources nor materializes files, and an empty or complete list does not prove
application readiness.

Colleague applies explicitly requested user Env changes through the existing
save action. Its input describes a patch keyed by variable name, with literal
`value`, optional `secret` classification and explicit `remove`. Unrequested
entries and omitted secret classifications are preserved; whitespace and empty
strings remain exact. A removal request supplies the same intent as Env's
confirmation and removes only the user override, possibly exposing a default.
The shared service rejects host-owned or non-editable records before any values
in that request are stored. Session source-work admission, reserved-key checks,
normal file projection and project refresh events remain in their existing owners.
Both read and save return metadata only to Colleague. Stored-secret reveal stays
in the existing owner-only UI flow. Saving does not restart an app, commit source
or establish readiness. A failure after persistence may leave values saved even
if projection failed; Colleague directs inspection in Env before retrying because
presence alone cannot establish exact value equality.
When Genesis declares an environment-file projection, Vibe64 writes it outside
ordinary Git tracking with restrictive permissions and preserves a pre-existing
user file before taking ownership.
Both readiness inspection and materialization reject symbolic links in projected
file paths and the local Git exclude path, including its `info` directory.

The shared value table preserves readable value and action columns in narrow
panes, scrolling within the table rather than collapsing a revealed value or
widening the page.

Execution startup explicitly prepares resources and environment files under the
session source lock. Preview startup may reuse preparation after a read-only
check confirms that the host reports its exact resources prepared and the
declared dotenv files and local Git excludes match current values. Otherwise it
resolves the declarations again under the lock before provisioning or writing.
An unreadable resource state is not evidence that preparation can be skipped.
Preview status, assistant profile discovery, and helper
conversation cleanup resolve existing values through the inspection API; they
do not provision resources or materialize project environment files.
An explicitly unprepared host response may omit resource values during
inspection. Starter application, setup reads, and chat remain available without
inventing credentials or treating preparation as complete. Execution still
requires every declared resource value, and malformed supplied values remain
errors in either path.
Constructing a session runtime or reading session state does not resolve the
project environment. Prompt rendering and command execution resolve it when
needed and share one resolution within that runtime.

Internal setup/output callers may request `includeResourceConfiguration` from
the same environment read. Its result contains the execution environment and a
separate SHA-256 configuration fingerprint. The existing environment owner
hashes effective non-secret project values and logical resource/binding
declarations. It excludes managed session addresses/credentials and uses the
existing scoped secret classification; a masked value is never substituted as
configuration. User overrides supersede defaults. Inherited host variables and
generated launch ports/tokens are not project settings.
The fingerprint selects comparable resource observations across sessions;
changing application settings selects a new generation, while rotating a
secret or receiving a different managed resource address does not. Failed
declaration inspection returns an unavailable fingerprint, not proof of empty
configuration. An unconfigured project can still use its supplied values.
No additional inspection, provisioning, file projection or persistent store is
introduced. Ordinary environment reads retain their environment-only result.

Stack declarations are inspected only from a real baseline checkout or an
explicit session source. A hosted catalog project's metadata namespace is not
source and is never passed to Genesis merely because no baseline checkout is
available; Env values remain usable without one.

Project agents receive the managed `vibe64-helper env` command. It reads configuration
metadata without exposing values and delegates explicit development mutations
to the project Env service. A host may contribute a production Env provider
through the terminal service; public/local Vibe64 otherwise reports production
as unavailable. Mutations require an explicit scope, accept values only on
stdin, never copy values between scopes, and never reveal stored values.
Successful development Env mutations publish the shared project refresh hint,
so other tabs reread the protected project state without receiving values or
secrets over realtime.

Project onboarding uses the same read-only environment resolution and alternative
binding rules as Env to report missing variable names, including for projects
with no runnable output. Existing host values, defaults, and allowed empty values
count toward satisfaction. The setup notice links to Env and can be rechecked;
it does not provision resources, expose values, or replace the output area.
Pending host-managed resources are left to application preparation rather than
presented as credentials the person must enter.
