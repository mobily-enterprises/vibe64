# Project environment

People can supply the environment values a project needs while Vibe64 and its
host provide managed system values separately.

## Sources

- `packages/vibe64-project/src/server/service.js`
- `packages/vibe64-project/src/server/projectEnvironmentFiles.js`
- `packages/vibe64-terminals/src/server/projectExecutionEnv.js`
- `packages/vibe64-terminals/src/server/agentEnvCommand.js`
- `src/components/studio/EnvPanel.vue`
- `src/components/studio/RuntimeConfigRecordsTable.vue`

## Public contract

The environment view distinguishes editable user values from host-owned system
values, masks secrets, supports explicit add, replace, and confirmed removal,
and applies values to session preparation, checks, launches, and agent work.
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

Project agents receive the managed `vibe64-env` command. It reads configuration
metadata without exposing values and delegates explicit development mutations
to the project Env service. A host may contribute a production Env provider
through the terminal service; public/local Vibe64 otherwise reports production
as unavailable. Mutations require an explicit scope, accept values only on
stdin, never copy values between scopes, and never reveal stored values.
Successful development Env mutations publish the shared project refresh hint,
so other tabs reread the protected project state without receiving values or
secrets over realtime.
