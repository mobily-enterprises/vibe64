# Single-Server Slug-Scope Migration

## Objective

Move Vibe64 from a local-editor model with one process-global selected project to a
single-server model that can run on a VPS and manage multiple workspaces.

The target app has two major modes:

- Management mode: workspace list, machine setup, shared AI account setup, and
  user administration.
- Development mode: the current Vibe64 app, always scoped to one workspace slug.

The whole app is behind authentication. First run creates the owner identity
from local file-backed auth state, without a database.

## Target URL Contract

Management mode is unscoped:

- `/app/manage`

Development mode is always slug-scoped:

- `/app/:slug`
- `/app/:slug/dashboard/...`

Every development API request must also be slug-scoped, either directly in the
route or through a single server-side request context derived from the route.

The app has one JSKIT surface:

- `app`

There is no backward compatibility requirement for legacy `/home` URLs. This is
version 0 of the new architecture.

## Workspace Root Contract

Workspace slugs resolve to exactly:

- `~/vibe64/<slug>`

Slug characters are lowercase letters, numbers, dashes, and underscores.

The slug resolver must reject:

- Empty slugs.
- Absolute paths.
- Path traversal.
- Any path that resolves outside `~/vibe64`.
- Symlink escapes, if symlinked workspace paths are supported.

No published runtime code may depend on a repo-local or machine-specific path.

## Non-Negotiable Invariants

- Development mode always has a slug in the URL.
- Server-side development state is request-scoped by slug, not process-global.
- The old process-global selected project must not be used for development APIs.
- Management mode can list and create workspaces without selecting one globally.
- Session truth remains under the workspace root:
  `~/vibe64/<slug>/.vibe64/sessions/active/<session_id>/`.
- Terminal, preview, Codex, and fix-job namespaces include the workspace scope.
- GitHub identity is not workspace-global or environment-global. GitHub
  authentication belongs to the authenticated Vibe64 user.
- Codex authentication is app-global in version 0. All Vibe64 users share the
  same Codex account/toolchain identity.
- GitHub repository access is checked per workspace/project using the active
  Vibe64 user's GitHub credentials.
- Client query keys and local storage keys include the workspace slug where they
  hold development-mode state.
- CLI argument handling accepts slugs, not arbitrary target paths.
- The app, APIs, and WebSocket routes require an authenticated Vibe64 user except
  for explicit auth/bootstrap endpoints, health, static assets, and tokenized
  preview proxy entrypoints.
- Raw preview/dev-server ports are not an access-control boundary. If a target
  dev server binds to a public VPS interface and the firewall allows the port,
  outsiders can view it.

## Session Runtime Contract

Session APIs must distinguish durable session state from ephemeral process and
terminal state.

- Listing sessions is a pure read of the session store plus creation metadata.
- Listing sessions must not create seed sessions, advance workflow steps,
  prepare Codex threads, inspect Codex terminal state, or run setup readiness
  checks.
- Creating a session is the explicit operation that may validate setup
  readiness, choose the seed/default workflow, create the durable session, and
  start required runtime preparation.
- Abandoning a session writes the durable `abandoned` status first and returns
  the closed session without requiring live Codex terminal state.
- Terminal cleanup after abandon is best-effort and backgrounded. Failure to
  close stale or missing terminal processes must not undo or hide the abandoned
  status.
- Full session inspection may enrich active sessions with terminal state, but
  stale terminal state must be surfaced as recoverable UI state rather than
  trapping the user in an uncancellable session.

## Implementation Quality Bar

This migration must be done carefully. The code should be gorgeous, expressive,
and easy to reason about.

- Do not create workarounds that hide the real design problem.
- Do not write ugly or temporary-looking solutions into the new architecture.
- Before adding any helper, service, route, composable, store, proxy, validator,
  or shared abstraction, inspect what already exists in JSKIT, Vibe64, local
  packages, and generated code.
- Avoid at all costs developing the same thing again under a different name.
  Duplicated ownership is a migration defect, even if both copies work.
- Do not reimplement helpers that already exist in JSKIT, Vibe64, or local
  packages.
- Do not duplicate logic across server, client, runtime, or adapter layers.
- Prefer one clear owner for each concept, such as slug resolution, auth state,
  preview token validation, and workspace context.
- Keep abstractions purposeful: add them when they remove real complexity or
  prevent drift, not to decorate the code.
- Keep code paths explicit enough that future slices can extend them without
  guessing hidden behavior.
- If the clean solution requires a larger slice than expected, record the
  tradeoff in this tracker instead of shipping a workaround.

## Access Control Contract

Vibe64 uses local file-backed authentication for version 0. There is no database.

User records:

- Live in a global Vibe64 app-data `users/` folder, outside the
  `~/vibe64/<slug>` workspace namespace.
- Are named directly from the canonical lowercase user email as
  `<email>.json`.
- Contain user metadata and a salted password hash.
- Must not contain plaintext passwords or reversible encrypted passwords.
- Are deterministic text files so they can be inspected, backed up, and moved
  with the VPS home directory.

Auth data:

- Defaults to `~/.vibe64`.
- Can be overridden for deployments with `VIBE64_DATA_ROOT`.
- Stores user records under `users/`.
- Stores login sessions under `auth-sessions/`.
- Login sessions are file-backed, survive server restarts, and expire after 30
  days by default.

First run:

- If no users exist, the app shows an owner setup screen.
- The owner enters an email address and a password twice.
- Vibe64 creates the first user record with owner role and a password hash.
- The owner is logged in after successful setup.

Invites:

- The management interface includes an invite-users screen.
- Inviting a user creates a user record for that identity with no password hash.
- Invited users cannot change the email or identity during claim.
- When an invited user logs in before setting a password, they see the same
  password-entry flow as first-run setup, but with the identity fixed.
- After entering the password twice successfully, the invited user record is
  updated with a password hash and the user is logged in as that identity.

Normal login:

- Existing users with a password hash log in with email and password.
- Sessions are cookie-backed and server-verifiable.
- Logout clears the browser session.

Route protection:

- API routes and WebSocket routes require a valid Vibe64 auth session unless
  they are explicit auth/bootstrap, health, static, or tokenized preview
  endpoints.
- The SPA shell can be served for unauthenticated `GET`/`HEAD` requests so the
  login/setup UI can render.
- The old local-only Studio request guard accepts authenticated Vibe64 requests
  from non-loopback hosts. Unauthenticated non-loopback requests remain blocked.

Account UI:

- The top-right app chrome shows an avatar-like identity control.
- The avatar uses Gravatar from the user's email address.
- The avatar opens an account screen.
- The account screen lets a user change their password only after the old
  password verifies.
- Users cannot change their email address in version 0.

## Provider Account Identity Contract

This is a required correction before continuing the migration.

GitHub and Codex deliberately have different identity scopes in version 0:

- GitHub is user-scoped.
- Codex is app-scoped and shared by all Vibe64 users.

Rationale:

- On a commercial VPS, the owner may be the only Vibe64 user, but the same
  architecture must also work when friends or collaborators are invited as app
  users on one VPS.
- Git commits, GitHub issue work, pull request creation, review, and merge
  operations must happen as the logged-in Vibe64 user, not as a shared
  environment account.
- A shared `HOME`/tool-home GitHub login would make every Vibe64 user appear as
  the same GitHub user and would leak repository access decisions across users.
- Codex is different: all users intentionally share the same Codex account in
  version 0, so Codex auth must not be split per Vibe64 user.

Management mode owns shared AI account setup:

- `/app/manage` should expose an `AI Accounts` view.
- The `AI Accounts` view shows shared app-level AI provider status only.
- GitHub must not appear in Management `AI Accounts`; it is per-user provider
  state, not shared management state.
- Starting Codex login authenticates the shared app-level Codex identity.
- Codex logout clears the shared app-level Codex identity.
- Starting or clearing GitHub login authenticates only the active Vibe64 user's
  GitHub identity and belongs to a user/workspace/project setup surface, not the
  Management `AI Accounts` surface.

Machine setup owns only common environment readiness:

- Docker/runtime availability.
- Base toolchain availability.
- Git executable availability.
- Toolchain image availability.
- Shared services that truly are machine-level.

Workspace/project setup owns project-specific checks:

- The workspace directory exists and is usable.
- The target is a Git repository when the selected project type requires it.
- Remotes, current branch, ignore rules, checkpoint state, project type, and
  project config are valid.
- The active Vibe64 user's GitHub identity can read and, when needed, write to
  the specific repository for that workspace.
- Codex access is not checked per workspace user; Codex uses the shared
  app-level account.

Implementation direction:

- Prefer isolating GitHub CLI state by Vibe64 user instead of parsing and
  storing GitHub tokens directly in app-owned user records.
- The clean version-0 shape is a per-user GitHub tool home under app data, for
  example `~/.vibe64/provider-homes/github/<stable-user-id>/`, with GitHub and
  Git commands launched using that directory as `HOME` or equivalent provider
  config root.
- GitHub CLI can then store its own auth material in the per-user GitHub home,
  while Vibe64 stores only user metadata and password hashes in `users/`.
- Codex CLI uses the shared managed toolchain home/account state. It must not
  use the per-user GitHub provider home.
- If Vibe64 later stores OAuth tokens itself, tokens must be encrypted or stored
  through a supported secret-store design with explicit revocation and audit
  behavior. Plain token JSON inside user records is not acceptable.
- Git operations, GitHub project tools, GitHub terminal launches, and GitHub
  setup checks must receive the active Vibe64 user context and select that
  user's GitHub provider home.
- Codex runtime actions and Codex terminals use shared Codex auth, while their
  runtime/session namespaces remain workspace-scoped.
- Session/workspace truth remains under `~/vibe64/<slug>/.vibe64/...`; provider
  credentials do not.

Current implementation note:

- The account service now treats Codex as shared app-level auth and GitHub as
  per-user auth.
- GitHub status, login terminals, logout, and Git credential-helper checks use
  `~/.vibe64/provider-homes/github/<stable-user-id>/` as the managed tool home.
- Codex status, login, logout, and Codex runtime auth continue to use the
  shared managed tool home.
- Accounts status is read live instead of using persisted ready caches, because
  shared Codex auth can change independently of per-user GitHub state.
- Project Setup receives the authenticated Vibe64 user from doctor routes and
  uses the active user's GitHub provider home for GitHub repository access,
  remote credential checks, Git identity, mirror, and checkpoint repair
  terminals.
- Project Setup ready caches are scoped by active GitHub user key so one user's
  repository access cannot satisfy another user's setup readiness.

## Preview Exposure Policy

Version 0 uses explicit browser-facing ports for previews, but the raw
Vite/Next/Laravel dev-server port must stay private to the host or runtime
network.

The intended flow is:

1. Vibe64 starts the target app on a private bind address or private runtime
   network.
2. Vibe64 allocates a browser-facing preview proxy port from `49100-49999`.
3. Vibe64 exposes the browser-facing preview through a Vibe64-owned proxy or
   gateway port.
4. The preview proxy validates an unguessable per-preview token before
   forwarding traffic.

Preview tokens:

- Are generated by Vibe64 when the preview proxy is created.
- Are embedded in preview URLs or set through a preview-specific browser flow.
- Are scoped to a concrete preview target, workspace slug, session, and terminal.
- Are stored server-side only as verifiable token material or token hashes.
- Are revoked when the preview terminal stops or the server shuts down.
- Use preview-specific cookie names derived from the proxy origin so different
  preview ports on the same host do not overwrite each other's browser cookie.

The authenticated app is the authority that can mint and reveal preview links.
The preview proxy is the authority that can forward preview traffic.

Version 0 preview proxy implementation:

- Extends `packages/vibe64-terminals/src/server/launchPreviewProxy.js`; there is
  still one launch-preview proxy owner.
- Allocates browser-facing proxy ports from `49100-49999`.
- Uses `VIBE64_PREVIEW_PROXY_HOST` for the listen host and
  `VIBE64_PREVIEW_PROXY_PUBLIC_HOST` for the browser-facing host when needed.
- Defaults preview proxy listening to `127.0.0.1` until a VPS deployment chooses
  an explicit public bind/proxy policy.
- Keeps raw target URLs loopback-constrained.
- Requires a per-preview token in the preview URL or that preview's scoped
  cookie before forwarding traffic.
- Strips the preview token from the target request URL before proxying.
- Preserves the rest of the target request query string byte-for-byte when
  stripping the preview token. This matters for framework-owned valueless query
  flags such as Vue Router/Vite `?definePage&vue&lang.tsx`; rewriting them as
  `?definePage=&vue=&lang.tsx=` breaks the target app's module transform.
- Preserves target `Set-Cookie` headers when appending the scoped preview token
  cookie.
- Preserves the existing HTML bridge injection, unavailable-target fallback,
  and same-origin redirect rewriting behavior.

## Current Root Cause

The durable session model is already target-root scoped, but the app selects the
target root through process-global mutable state. That makes one server with
multiple active workspaces unsafe because one request can change the effective
workspace for another request.

The migration must remove that hidden selection contract and make workspace
identity explicit.

## Architecture Slices

### 1. Worktree And Tracker

Status: completed

- Create `~/Development/current/vibe64Next`.
- Add this tracker.
- Keep the migration work isolated from the current app branch.

Verification:

- `git worktree list`
- `git status --short`

### 2. Workspace Slug Foundation

Status: completed for managed workspace resolution

- Add one canonical slug validator.
- Add one canonical `~/vibe64/<slug>` resolver.
- Add tests for valid slugs, invalid slugs, traversal, absolute paths, and
  non-canonical roots.
- Enforce lowercase letters, numbers, dashes, and underscores.

Implemented:

- `packages/vibe64-core/src/server/studioProjectContext.js` remains the owner
  for Studio/Vibe64 project-root resolution instead of adding a second resolver.
- Managed workspace slugs must match `^[a-z0-9][a-z0-9_-]*$`.
- Explicit slug input is validated exactly; only name-based creation is
  slugified.
- Workspace roots resolve through the existing Studio projects-root owner and
  then append the canonical slug as one path segment.
- Managed workspace listing filters out non-canonical folder names and sorts
  results by slug.
- Managed workspace creation does not select or mutate the process-global
  target root.
- Existing legacy managed-project APIs still work for current tests but are now
  backed by the canonical workspace helpers.
- Existing workspace paths that are symlinks are rejected for managed
  workspaces.

Deferred:

- Final CLI enforcement of slug-only startup arguments belongs to slice 10.
- Final removal or deployment-policy decision for the existing projects-root
  environment override remains tracked under open questions.

Verification:

- Server unit tests for slug/root resolution.

### 3. Management Mode

Status: completed for the version-0 management shell; provider-account backing
service requires the per-user refactor tracked above

- Add management route at `/app/manage`.
- List workspace slugs from `~/vibe64`.
- Allow creating a workspace folder by slug.
- Add navigation from management mode into `/app/:slug`.
- Move machine setup, shared AI account setup, and user administration surfaces
  here.

Implemented:

- `/app/manage` exists on the `app` JSKIT surface.
- `/` redirects to `/app/manage`; server startup now publishes `/app/manage` as
  the browser entry URL.
- Authenticated `GET /api/vibe64/workspaces` lists managed workspace slugs.
- Authenticated `POST /api/vibe64/workspaces` creates a managed workspace by
  slug without selecting it globally.
- Management UI lists workspace slugs, shows the managed workspace root, creates
  new slugs, and navigates to `/app/<slug>`.
- `/app/manage` renders the global Studio setup doctor.
- `/app/manage` has an `AI Accounts` view for shared Codex provider status and
  login controls.
- `/app/manage` renders user administration without personal password-change
  controls. Personal password changes live on the avatar-owned account page.

Deferred:

- Future generic adapter setup, if needed, remains a Management-mode extension.
  The old workspace-scoped Adapter Setup gate is not part of the active app
  graph.

Verification:

- Management page lists existing workspace folders deterministically.
- Creating a workspace creates only `~/vibe64/<slug>`.
- Management mode works with no selected workspace.
- The `AI Accounts` view shows shared AI provider identity only and does not
  render GitHub.

### 4. Development Route Shell

Status: completed for route and surface shell

- Move the current development app under `/app/:slug`.
- Keep a workspace selector in development mode.
- Add a clear route back to management mode.
- Remove old `/home` compatibility.

Implemented:

- The former `/home` development page tree now lives under `/app/:slug`.
- Dashboard routes now live under `/app/:slug/dashboard/...`.
- The JSKIT surface is now `app`; placement ownership and generated route types
  use the new surface and slugged route tree.
- Development chrome includes a workspace selector populated from the management
  workspace API.
- Development chrome includes navigation back to `/app/manage`.
- Dashboard links preserve the current slug instead of using global `/home`
  paths.
- `/` redirects to management mode instead of an implicit development workspace.

Deferred:

- Historical `/home` E2E route coverage still needs to be ported or replaced
  for the new `/app/:slug` contract.

Verification:

- Opening `/app/<slug>` renders the current Vibe64 workspace UI.
- Switching workspace changes the URL and reloads slug-scoped data.
- `/app/<slug>` does not mutate a process-global selected project.
- `tests/e2e/single-server-slug-scope.spec.ts` covers management workspace
  creation, development navigation, dashboard setup navigation, and absence of
  the old Adapter Setup tab.

### 5. Backend Request Scoping

Status: completed for HTTP development APIs

- Replace global project selection with a request-scoped workspace context.
- Ensure session/project/config/tool services resolve target root from the slug.
- Keep runtime creation target-root scoped.
- Add tests proving two slugs can be read and mutated without cross-talk.

Implemented:

- `packages/vibe64-core/src/server/workspaceRequestContext.js` owns the
  request-scoped workspace context with one AsyncLocalStorage owner.
- Development API routes are mounted under `/api/app/:slug/...`.
- The shared feature-route wrapper resolves the workspace slug, validates the
  canonical workspace root, and runs route handlers inside the request context.
- Setup-doctor routes use the same request-context wrapper instead of a separate
  slug resolver.
- Project service target-root reads first consult the request workspace context,
  then fall back to the legacy configured context for still-unmigrated call
  paths.
- Terminal WebSocket route setup enters the same request workspace context.
- Route tests distinguish Fastify route templates (`/api/app/:slug/...`) from
  concrete request URLs (`/api/app/<slug>/...`).
- Smoke coverage creates two slugs, writes project type in one slug, and proves
  the second slug remains untouched.

Deferred:

- WebSocket runtime behavior still needs direct slug-scoped integration coverage
  once terminal namespace scoping is completed in slice 9.

Verification:

- `GET` session list for slug A cannot see slug B sessions.
- Project config/type writes for slug A do not affect slug B.

### 6. Client State Scoping

Status: completed for development-mode query and browser-storage keys

- Include slug in query keys for sessions, project type, project config,
  capabilities, setup status, launch targets, artifacts, and conversations.
- Include slug in local storage keys for selected session and preview toolbar
  preferences.
- Remove client assumptions that there is one global current project.

Implemented:

- `src/lib/vibe64WorkspaceScope.js` owns client workspace-scope parsing and key
  construction from the canonical `/app/:slug` URL.
- `src/composables/useVibe64WorkspaceScope.js` exposes the current route slug
  as a reactive client composable.
- Development query-key owners now include `["workspace", "<slug>"]`.
- Session list/detail, conversation log, artifact preview, launch targets,
  target scripts, project selection, project type, project config, current app,
  and capabilities query keys are workspace-scoped.
- Accounts query keys are user-scoped/global to the authenticated Vibe64 user,
  not workspace-scoped.
- Selected-session sessionStorage keys include the workspace scope.
- Launch floating-terminal and embedded preview-toolbar localStorage keys include
  the workspace scope.
- Development route gates and module-level project caches are keyed by
  workspace slug to avoid stale cross-slug UI state.
- `studioHttp` now reuses the same client workspace-scope URL parser instead of
  owning a duplicate slug parser.
- Direct browser transports that cannot use `fetch`, such as doctor
  `EventSource` streams, resolve URLs through the same `studioHttp` workspace
  scoping owner.
- Vibe64 session list/create traffic now uses `studioHttpClient` instead of the
  generic unscoped JSKIT `useList`/`useCommand` wrappers.
- Vibe64 session abandon traffic now uses the same direct slug-scoped
  `studioHttpClient` path contract.
- The old Autopilot/Inspect mode split has been removed from the active client
  state model; Vibe64 now has only the Autopilot session surface.

Deferred:

- Setup-status query keys for Studio setup and adapter setup will be revisited
  in slice 7 when those setup flows move to management mode.
- Historical `/home` E2E route coverage still needs to be ported or replaced
  for the new `/app/:slug` contract.

Verification:

- Selecting a session in slug A does not select it in slug B.
- Query cache refreshes do not mix workspace payloads.
- Browser smoke verifies that Project Setup streams and Vibe64 session list
  requests use `/api/app/<slug>/...` in development mode.

### 7. Setup Split

Status: completed for active version-0 setup flow and the shared-Codex /
per-user-GitHub provider split

Current setup is mixed. The migration must split it explicitly:

- Machine setup: Docker reachability, base toolchain, Git executable
  availability, shared runtime services, and adapter toolchain images.
- Shared AI provider setup: Codex auth and Codex CLI state for the whole app.
- Per-user provider setup: GitHub auth, Git identity, and GitHub CLI state for
  the authenticated Vibe64 user.
- Workspace setup: target directory, target git repository, branch, remotes,
  project type, project config, project-specific runtime services, and the
  active Vibe64 user's GitHub access to that repository.

Implemented:

- Shared setup-doctor routes now choose scope explicitly.
- Studio setup is mounted globally at `/api/studio/studio-setup...` instead of
  `/api/app/:slug/studio/studio-setup...`.
- `studioHttp` no longer rewrites global Studio setup API paths into
  workspace-scoped API paths.
- `/app/manage` renders the existing Studio setup doctor screen as global setup.
- `/app/manage` renders shared AI account setup as a management surface.
- Codex account status is shared app-level state.
- GitHub account status is per authenticated Vibe64 user and uses a per-user
  provider home.
- Project Setup uses the active Vibe64 user's GitHub provider home for
  repository access, Git identity, remote sync, mirror, and checkpoint checks.
- Project Setup ready cache keys include the active GitHub user key.
- The workspace dashboard setup panel no longer includes the Studio setup tab.
- The workspace dashboard setup panel now exposes Project Setup as the active
  per-workspace setup flow.
- Project Setup reports that Studio setup must be completed from Management mode
  when it is not ready.
- Adapter Setup is no longer part of the active JSKIT app lock, package
  dependency graph, setup-readiness gate, or development setup UI.
- Project Setup already owns the target directory, Git repository, branch,
  remote, GitHub accessibility, Vibe64 ignore rules, checkpoint, project config,
  and adapter setup plugin checks.

Deferred:

- The old `packages/adapter-setup-doctor` source package remains in the
  repository for now but is not installed in `.jskit/lock.json` and is not
  referenced by the active app graph.
- If future adapters need app-independent user/tooling/environment setup, add it
  under Management mode as a global setup owner. Do not resurrect the old
  target-root-specific Adapter Setup gate.

Verification:

- Management setup can run without a workspace slug.
- Workspace setup always runs under `/app/:slug`.
- No workspace setup check reads or writes global selected-project state.
- Setup readiness reports only Studio Setup and Project Setup for automatic
  setup stages.

### 8. App Authentication Foundation

Status: completed for the authentication foundation

- Add file-backed user store with owner, invited, and active-user states.
- Hash passwords with per-password salt; do not encrypt or store plaintext
  passwords.
- Add first-run owner setup.
- Add invited-user password claim flow with fixed identity.
- Add normal login and logout.
- Add invite-users interface in management mode.
- Add top-right Gravatar identity control.
- Add account screen with password change guarded by old-password verification.
- Protect app routes, APIs, and WebSocket routes with authenticated sessions,
  except explicit auth/bootstrap endpoints, health, static assets, and tokenized
  preview proxy entrypoints.

Implemented in the current slice:

- `server/lib/auth/` owns file-backed user records, password hashing, auth
  sessions, cookie parsing/serialization, auth routes, and the auth gate.
- `server.js` registers auth routes before the protected runtime routes.
- The app shows first-run owner setup, normal login, invited-user password
  claim, top-right Gravatar identity, account settings, password change, and
  user invite controls.
- `/app/manage` includes the account settings and invite-users interface.
- Browser lifecycle startup now waits until authentication succeeds.
- The existing local Studio request guard recognizes authenticated Vibe64
  requests, so authenticated VPS-hosted API requests are not rejected merely for
  being non-loopback.
- Real browser-lifecycle WebSocket handshakes reject unauthenticated clients and
  accept authenticated clients.
- Terminal WebSocket route guards accept authenticated non-loopback requests.

Verification:

- Empty user store shows owner setup and creates the owner after valid input.
- Invited user record has no password hash until claimed.
- Invited user claim cannot change identity.
- Login succeeds only with the correct password.
- Password change requires the old password and updates the stored hash.
- Protected API and WebSocket routes reject unauthenticated requests.
- Authenticated API requests from a non-loopback host pass the shared Studio
  guard.
- Authenticated browser-lifecycle WebSocket connections receive lifecycle state.
- Terminal WebSocket route guards accept authenticated non-loopback request
  context.

### 9. Terminals, Codex, And Preview Scoping

Status: completed for workspace namespace and preview-token scoping

Existing preview system to update:

- `packages/vibe64-terminals/src/server/launchPreviewProxy.js` already owns the
  launch preview proxy registry, HTML bridge injection, loopback target
  validation, app-relative proxying, same-origin redirect rewriting, and
  starting-preview fallback page.
- `packages/vibe64-terminals/src/server/launchTargetTerminal.js` already owns
  launch status, `previewTarget` creation, and lifecycle cleanup for preview
  proxies through `createLaunchPreviewProxyRegistry()`.
- `packages/studio-terminal-core/src/server/launchTargetTerminal.js` already
  owns target-app launch port allocation and target URL metadata. It currently
  allocates raw target-app ports from `4100` upward and publishes Docker launch
  targets as `127.0.0.1:<port>:<port>`.
- `tests/server/launchPreviewProxy.unit.test.js` already covers bridge
  injection, loopback target enforcement, proxying, redirect rewriting, and the
  unavailable-target fallback.

Required preview direction:

- Extend the existing preview proxy registry. Do not create a second preview
  proxy subsystem.
- Keep the raw target-app port and browser-facing preview proxy port as separate
  concepts.
- Keep raw target-app ports private to loopback or the runtime network.
- Add token generation, token validation, token scoping, and token revocation to
  the existing preview proxy owner.
- Change the browser-facing preview proxy listener from a random port to the
  fixed `49100-49999` range.
- Preserve the existing preview bridge behavior unless the tokenized proxy
  requires a deliberate, tested change.

Implemented in the current slice:

- The existing launch preview proxy registry now generates one unguessable token
  per preview proxy.
- The proxy stores only a SHA-256 token hash for validation.
- Preview descriptors include the tokenized proxy URL.
- Requests without a token or scoped cookie are rejected before proxying.
- Requests with the wrong token for a preview are rejected before proxying.
- Valid requests set a preview-specific `HttpOnly` cookie, enabling redirects
  and in-preview navigation without leaking the token to the target app.
- The preview token cookie is appended without replacing target app cookies.
- Browser-facing proxy ports are allocated from `49100-49999`.
- Target requests have the preview token stripped before forwarding.
- Target query flags are preserved exactly after token stripping so the preview
  proxy cannot change framework-owned dev-server module URLs.
- Preview WebSocket upgrades, including Vite HMR, are forwarded through the same
  tokenized preview proxy after the same per-preview token validation.
- Preview WebSocket requests have the preview token query/cookie stripped before
  forwarding, while target app cookies are preserved.
- Preview token appending preserves valueless target query flags so framework
  module URLs such as `?definePage&vue&lang.tsx` are not rewritten.

Deferred to later migration slices:

- Audit adapter launch descriptors and runtime networking so raw target dev
  servers bind only to loopback or a private runtime network in VPS deployments.

- Include workspace slug or target-root hash in every terminal namespace.
- Scope global Codex terminal behavior to either management or a workspace.
- Scope fix jobs by slug where they touch workspace files.
- Replace or route launch preview proxy origins so they work from a VPS.
- Version 0 preview URLs may use explicit ports instead of wildcard preview
  subdomains, but raw Vite/app dev-server ports must not be exposed directly to
  the public internet.
- Allocate browser-facing preview proxy ports from the fixed range
  `49100-49999`.
- Preview targets should bind to loopback or a private runtime network wherever
  the adapter supports it; Vibe64 should expose the browser-facing preview
  through a controlled proxy/port.
- Preview access must require an unguessable per-preview token.
- Preview tokens must be scoped to the workspace slug, session, terminal, and
  target URL, and revoked when the preview stops.
- Ensure process cleanup works per workspace and on server shutdown.

Implemented:

- `packages/vibe64-core/src/server/workspaceRequestContext.js` now exposes one
  request-context-derived workspace scope key for runtime namespaces.
- `packages/vibe64-terminals/src/server/terminalShared.js` remains the single
  owner for Vibe64 terminal namespace construction and now includes the active
  workspace scope in Codex, command, launch, shell, project-tool, global Codex,
  and fix-Codex namespaces.
- `packages/current-app/src/server/service.js` scopes target-script terminal
  namespaces with the same workspace scope key instead of keeping one
  process-global target-script namespace.
- Terminal WebSocket route registration accepts the same `projectContext` as
  HTTP feature routes and resolves the workspace context before subscribing,
  writing, or resizing terminal sessions.
- Existing Vibe64 and current-app WebSocket route registrations pass their
  project context through to the shared WebSocket helper.
- The existing launch-preview proxy registry is still the only preview proxy
  owner. Its registry keys now include workspace scope, session id, and launch
  terminal id.
- Preview token hashes include workspace scope, session id, terminal id, and
  target URL as scope material, so a token minted for one preview cannot be used
  against another workspace/session/terminal/target preview.
- Launch-preview proxy descriptors are minted for the active launch terminal,
  and proxy entries are revoked when a launch terminal is closed or stopped.
- `packages/studio-terminal-core/src/server/launchTargetTerminal.js` keeps raw
  launch target URLs loopback-constrained and publishes Docker launch ports as
  `127.0.0.1:<port>:<port>`.
- `packages/studio-terminal-core/src/server/runtimeContainers.js` and
  `packages/studio-terminal-core/src/server/managedDatabases.js` publish
  declared runtime/database host ports to `127.0.0.1` by default.

Verification:

- Command, shell, launch, Codex, global Codex, and fix terminals work in
  `/app/:slug`.
- Running terminal limits are enforced per workspace where appropriate.
- Launch preview is available from the browser through a VPS-reachable host and
  port without exposing the raw Vite/app dev server publicly.
- Preview proxy requests without the token are rejected.
- Preview proxy requests with the wrong token for that preview are rejected.
- Terminal namespace unit coverage proves identical session/tool/job ids produce
  different namespaces under different workspace slugs.
- Preview proxy unit coverage proves same session and terminal ids in different
  workspaces cannot share tokens.
- Preview proxy unit coverage proves tokenized WebSocket/HMR upgrades are
  forwarded without leaking preview-token material upstream.
- Current-app target-script unit coverage proves target-script terminal sessions
  live under the active workspace namespace.
- Terminal WebSocket unit coverage uses real temporary managed workspace roots
  and the slugged `/api/app/:slug/...` route contract.

Deferred:

- Browser-level manual verification of actual command, shell, launch, Codex,
  global Codex, and fix terminals belongs to the final manual VPS smoke pass.

### 10. CLI Behavior

Status: completed for slug-only startup parsing

- `vibe64` starts management mode.
- `vibe64 <slug>` opens `/app/<slug>`.
- Reject any argument that is not a valid slug.
- Reject any resolved target outside `~/vibe64/<slug>`.

Implemented:

- `bin/server.js` no longer parses positional input or `--target` as an
  arbitrary target root.
- Server CLI parsing accepts zero slug arguments or one canonical workspace
  slug.
- Path-like input, uppercase input, multiple slug arguments, `--target`, and
  other unsupported startup flags are rejected before server startup.
- `server.js` accepts a `startupSlug` used only for the initial browser URL.
  It does not select or mutate the process-global target root.
- No-argument startup publishes `/app/manage` as the initial URL.
- Slug startup publishes `/app/<slug>` as the initial URL.
- Startup URL generation validates the slug with the canonical workspace slug
  validator.

Verification:

- No-argument startup opens management mode.
- Slug startup opens development mode for that slug.
- Path-like arguments are rejected.

### 11. VPS Readiness

Status: in progress; baseline server/auth/preview-port posture implemented,
manual VPS smoke still pending

- Add a deployment-oriented startup path for one long-lived server.
- Require app authentication before management or development mode can be used.
- Keep user, session, and preview-token storage portable with the VPS home
  directory.
- Prepare clean future insertion points for stronger auth and per-user workspace
  ownership.

Implemented:

- `server.js` starts one long-lived app server with no process-global workspace
  selection when launched without a slug.
- CLI startup opens `/app/manage` by default and `/app/<slug>` for one validated
  slug argument.
- File-backed auth data defaults to `~/.vibe64` and can be relocated with
  `VIBE64_DATA_ROOT`.
- Managed workspaces default to `~/vibe64/<slug>`.
- API and WebSocket behavior requires an authenticated Vibe64 session except for
  explicit bootstrap/auth, health, static, SPA shell, and tokenized preview
  entrypoints.
- Raw target-app launch ports and managed runtime/database ports are loopback
  host ports in the audited launch/runtime helpers.
- The browser-facing launch-preview proxy uses the fixed `49100-49999` range and
  defaults to `127.0.0.1`, with `VIBE64_PREVIEW_PROXY_HOST` and
  `VIBE64_PREVIEW_PROXY_PUBLIC_HOST` as explicit deployment knobs.
- Managed Docker runtime networks, runtime containers, runtime volumes, launch
  terminal labels, target-script labels, toolchain terminal labels, and Codex
  attachment namespaces now use a stable runtime identity instead of the raw
  absolute path for managed workspaces.
- The stable runtime identity is `workspace:<slug>` when a request-scoped
  workspace context is active or when a target path is under the configured
  managed workspace root. Unmanaged fallback paths remain keyed by their
  absolute path through an explicit `path:<absolute-path>` identity.
- Runtime identity is owned by `@local/vibe64-core/server/workspaceRuntimeIdentity`;
  Docker naming remains owned by `@local/studio-terminal-core/server/runtimeContainers`.

Deferred:

- Manual VPS smoke is still required.
- Public preview ingress policy is still undecided: either expose configured
  preview proxy ports deliberately or place a front proxy in front of loopback
  preview ports.
- Existing local Docker data that was created with the old path-derived identity
  is not imported automatically. Importing an old DB volume into the new stable
  workspace runtime is an explicit data migration operation and must not happen
  silently.

Verification:

- `npm run build`
- `npm run server`
- Manual smoke: first-run owner setup -> login -> management -> workspace ->
  session -> terminal -> tokenized preview.
- Local browser smoke covers first-run owner setup -> management -> workspace
  creation -> invited user listing -> `/app/:slug` development mode ->
  dashboard accounts -> Project Setup.

## Current Verification Log

Current slice verification:

- `node --test tests/server/launchPreviewProxy.unit.test.js` passed under Node
  `v22.16.0` after adding tokenized WebSocket/HMR upgrade forwarding, upstream
  preview-token cookie stripping, and valueless query-preserving token
  appending coverage.
- Slice-local lint passed under Node `v22.16.0` with:
  `npx eslint packages/vibe64-terminals/src/server/launchPreviewProxy.js tests/server/launchPreviewProxy.unit.test.js`
- `node --test tests/server/studioProjectContext.unit.test.js tests/server/vibe64ProjectService.unit.test.js tests/server/smoke.test.js`
  passed after adding canonical workspace slug/root tests and authenticated
  workspace API smoke coverage.
- `npm run build` passed after adding `/app/manage`.
- Slice-local lint passed with:
  `npx eslint server.js server/lib/auth/*.js server/lib/workspaceRoutes.js packages/vibe64-core/src/server/localStudioRequest.js packages/vibe64-core/src/server/studioProjectContext.js packages/vibe64-terminals/src/server/launchPreviewProxy.js src/App.vue src/main.js src/pages/index.vue src/pages/home.vue src/pages/account.vue src/pages/app/manage.vue src/components/auth/*.vue src/composables/useVibe64AppAuth.js src/lib/vibe64AuthApi.js src/lib/vibe64WorkspaceApi.js tests/server/vibe64Auth.unit.test.js tests/server/launchPreviewProxy.unit.test.js tests/server/localStudioRequest.unit.test.js tests/server/smoke.test.js tests/server/terminalWebSocketRoutes.unit.test.js tests/server/studioProjectContext.unit.test.js tests/server/vibe64ProjectService.unit.test.js`
- `git diff --check` passed.
- `node --test tests/server/localStudioRequest.unit.test.js tests/server/vibe64Auth.unit.test.js tests/server/launchPreviewProxy.unit.test.js tests/server/smoke.test.js`
  passed.
- `node --test tests/server/launchPreviewProxy.unit.test.js tests/server/smoke.test.js tests/server/terminalWebSocketRoutes.unit.test.js`
  passed after adding wrong-token and WebSocket auth coverage.
- `npm run build` passed.
- Slice-local lint passed with:
  `npx eslint server.js server/lib/auth/*.js packages/vibe64-core/src/server/localStudioRequest.js packages/vibe64-terminals/src/server/launchPreviewProxy.js src/App.vue src/main.js src/pages/home.vue src/pages/account.vue src/components/auth/*.vue src/composables/useVibe64AppAuth.js src/lib/vibe64AuthApi.js tests/server/vibe64Auth.unit.test.js tests/server/launchPreviewProxy.unit.test.js tests/server/localStudioRequest.unit.test.js tests/server/smoke.test.js tests/server/terminalWebSocketRoutes.unit.test.js`
- `npm test` passed: 457 server tests.
- `git diff --check` passed.
- `node --test tests/server/studioProjectContext.unit.test.js tests/server/vibe64FeatureRoutes.unit.test.js tests/server/vibe64SessionsRoutes.unit.test.js tests/server/vibe64TerminalControlRoutes.unit.test.js tests/server/smoke.test.js`
  passed after adding `/api/app/:slug/...` route templates, request-scoped
  workspace context, and cross-workspace project-type smoke coverage.
- Slice-local lint passed with:
  `npx eslint packages/vibe64-core/src/server/workspaceRequestContext.js packages/vibe64-core/src/server/featureRoutes.js packages/vibe64-core/src/server/terminalWebSocketRoutes.js packages/vibe64-core/src/server/studioProjectContext.js packages/setup-doctor-core/src/server/doctorRoutes.js packages/vibe64-project/src/server/service.js packages/vibe64-project/src/server/registerRoutes.js packages/vibe64-sessions/src/server/registerRoutes.js packages/vibe64-terminals/src/server/registerRoutes.js packages/vibe64-artifacts/src/server/registerRoutes.js packages/vibe64-accounts/src/server/registerRoutes.js packages/current-app/src/server/registerRoutes.js src/lib/studioHttp.js tests/server/vibe64RouteTestHelpers.js tests/server/vibe64FeatureRoutes.unit.test.js tests/server/vibe64SessionsRoutes.unit.test.js tests/server/vibe64TerminalControlRoutes.unit.test.js tests/server/smoke.test.js`
- `npm run build` passed after the `/app/:slug` route shell and API scoping
  changes.
- `git diff --check` passed.
- `npm run test:client` passed: 33 client test files, 156 tests.
- Client slice-local lint passed with:
  `npx eslint src/lib/vibe64WorkspaceScope.js src/composables/useVibe64WorkspaceScope.js src/lib/studioHttp.js src/lib/studioGateApi.js src/lib/vibe64SessionRequestConfig.js src/lib/targetScriptsRequestConfig.js src/lib/vibe64SessionModeStorage.js src/composables/useStoredSelection.js src/composables/useVibe64SessionData.js src/pages/app/[slug].vue src/components/studio/ProjectTypeGate.vue src/components/studio/ProjectSelectionGate.vue src/components/studio/ArchivedVibe64Sessions.vue src/composables/useTargetScripts.js src/composables/useVibe64LaunchControls.js src/components/studio/Vibe64LaunchControls.vue src/composables/useVibe64ConversationLog.js src/composables/useVibe64SessionArtifacts.js src/composables/useVibe64Accounts.js src/composables/useVibe64SessionMode.js tests/client/vibe64SessionRequestConfig.vitest.js tests/client/vibe64LaunchControls.vitest.js tests/client/vibe64WorkspaceScope.vitest.js tests/client/useVibe64SessionMode.vitest.js`
- `npm run build` passed after client workspace-scope key changes.
- `git diff --check` passed.
- `node --test tests/server/doctorRoutesScope.unit.test.js tests/server/smoke.test.js`
  passed after making Studio setup global and keeping Adapter setup
  workspace-scoped.
- `npx vitest run tests/client/vibe64WorkspaceScope.vitest.js` passed after
  excluding global Studio setup endpoints from development API path rewriting.
- Setup split slice-local lint passed with:
  `npx eslint packages/setup-doctor-core/src/server/doctorRoutes.js packages/studio-setup-doctor/src/server/StudioSetupDoctorProvider.js src/lib/studioHttp.js src/pages/app/manage.vue src/components/studio/StudioSetupDoctorScreen.vue src/components/studio/Vibe64SetupPanel.vue src/pages/app/[slug]/dashboard/setup/index.vue src/components/studio/AdapterSetupDoctorScreen.vue src/components/studio/ProjectSetupDoctorScreen.vue tests/server/doctorRoutesScope.unit.test.js tests/client/vibe64WorkspaceScope.vitest.js`
- `npm run build` passed after moving Studio setup into management mode.
- `git diff --check` passed.

Final Node 22 verification:

- `npm install --package-lock-only --ignore-scripts` passed with Node
  `v22.16.0` and npm `11.14.1` after package metadata changes.
- `npm test` passed under Node `v22.16.0`: 469 server tests.
- `npm run test:client` passed under Node `v22.16.0`: 33 client test files,
  157 tests at the time, then 158 tests after adding direct browser transport
  URL scoping coverage.
- `npm run verify:packages` passed under Node `v22.16.0`: 15 workspace package
  contracts.
- `npm run build` passed under Node `v22.16.0`.
- `npx vitest run tests/client/vibe64WorkspaceScope.vitest.js tests/client/vibe64SessionRequestConfig.vitest.js`
  passed under Node `v22.16.0`: 2 files, 8 tests.
- Focused lint passed under Node `v22.16.0` for the direct stream/session
  scoping changes:
  `npx eslint src/lib/studioHttp.js src/composables/useDoctorStream.js src/composables/useVibe64SessionData.js tests/client/vibe64WorkspaceScope.vitest.js tests/e2e/single-server-slug-scope.spec.ts`
  exited 0. The TypeScript E2E spec is outside the current ESLint config and is
  reported as ignored.
- `npx playwright test --config playwright.config.ts tests/e2e/single-server-slug-scope.spec.ts`
  passed under Node `v22.16.0`.
- `npx jskit app verify-ui --command 'bash -lc '\''source "$HOME/.nvm/nvm.sh" && nvm use 22 >/dev/null && npx playwright test --config playwright.config.ts tests/e2e/single-server-slug-scope.spec.ts'\''' --feature "single-server slug-scoped management/development smoke" --auth-mode custom-local`
  passed and wrote `.jskit/verification/ui.json` for 47 changed UI files.
- `npx jskit app verify` passed under Node `v22.16.0`; JSKIT doctor reported
  healthy after lint, 469 server tests, 33 client test files / 158 client tests,
  and production build.
- `npx jskit lint-descriptors` passed under Node `v22.16.0`: 32 packages, 1
  bundle.
- `git diff --check` passed.

Known remaining verification gap:

- The historical `npm run test:e2e` script is still stale. It runs
  `tests/e2e/self-contained-smoke.spec.ts` and
  `tests/e2e/dumb-client-autopilot.spec.ts`, both still target old `/home`
  routes and old unscoped mocked APIs. A Node `v22.16.0` run was stopped after
  the first ten dumb-client tests had already failed or timed out. Porting that
  historical suite to `/app/:slug` remains a separate E2E-maintenance slice; the
  new `single-server-slug-scope.spec.ts` is the current browser receipt for this
  migration.

## Open Questions And Remaining Architecture Work

1. Workspace root configurability: should `~/vibe64` be fixed for version 0, or
   should the server allow an environment override for VPS deployments?

2. Multi-user VPS model: when giving friends access on one VPS, should each
   friend be an OS user with their own `~/vibe64`, or app-level users sharing one
   OS user with per-owner workspace roots?

3. Workspace creation: should management mode only create empty folders, or
   should it also support clone/import flows in this migration?

4. Global Codex terminal: should it exist only in management mode, or should each
   workspace have its own "global for this workspace" Codex terminal?

5. Future generic adapter setup: if adapters need app-independent
   user/tooling/environment configuration beyond Studio Setup, it belongs in
   Management mode. Project-specific adapter checks remain under per-workspace
   Project config/setup.

6. VPS process model: is one Node process expected to own all terminals and
   workspace processes, or should the design leave room for a separate worker
   process per workspace later?

7. Preview WebSocket/HMR behavior: decided for version 0. Vite HMR and other
   preview WebSocket traffic are proxied through the same tokenized preview
   proxy as HTTP preview traffic.

8. Preview public bind policy: should VPS deployments expose
   `VIBE64_PREVIEW_PROXY_HOST=0.0.0.0` directly with firewall rules, or should a
   front proxy own public preview ingress and forward only to loopback preview
   ports?

9. Managed runtime data migration: version 0 now keys managed workspace runtime
   identity by `workspace:<slug>`, but local data created before this change may
   still live in path-derived Docker volumes. Management mode needs an explicit
   import/migration flow if old local data should be copied into the new stable
   workspace runtime.

## Decisions

- The canonical workspace root is `~/vibe64`.
- Slugs use lowercase letters, numbers, dashes, and underscores.
- Slugs must start with a lowercase letter or number; `_` and `-` are allowed
  after the first character.
- The JSKIT surface is `app`, replacing the old `home` surface.
- Management mode is `/app/manage`.
- Development mode is `/app/:slug`.
- There is no backward compatibility requirement for `/home` or earlier local
  editor URLs.
- Managed workspace runtime identity is `workspace:<slug>`; raw absolute path
  hashing is only an unmanaged fallback.
- The earlier no-password/no-protection assumption is superseded. Version 0 now
  requires app authentication.
- Authentication is file-backed; no database is required.
- Auth data defaults to `~/.vibe64`, with `VIBE64_DATA_ROOT` as the deployment
  override.
- User records are stored as `users/<canonical-lowercase-email>.json`.
- First run creates the owner user from email and password.
- Invites create user records without passwords; invited users claim the fixed
  identity by setting their password.
- Password storage uses salted password hashes, not reversible encryption.
- Auth sessions are file-backed under `auth-sessions/`, survive server restarts,
  and expire after 30 days by default.
- The SPA shell may be served before authentication so the login/setup UI can
  render; APIs and WebSockets are the protected boundary.
- Authenticated Vibe64 requests satisfy the existing local Studio request guard.
  Unauthenticated non-loopback requests remain blocked.
- The top-right app identity uses Gravatar and links to password change.
- Version 0 previews can use explicit browser-facing host ports instead of
  wildcard DNS/TLS subdomains. The later commercial preview target can still move
  to `<slug>-<session>.preview.<domain>`.
- Browser-facing preview proxy ports come from `49100-49999`.
- Tokenized preview proxy is required immediately.
- Preview proxy listen host defaults to `127.0.0.1`; VPS deployments can set
  `VIBE64_PREVIEW_PROXY_HOST` and `VIBE64_PREVIEW_PROXY_PUBLIC_HOST`.
- Preview token cookies are scoped by proxy-origin-derived cookie names so
  multiple preview ports on the same host do not overwrite each other.
- Raw Vite/app dev-server ports should not be the public preview contract and
  should not be considered protected when reachable from outside the VPS.
- Preview readiness is iframe-load based, not DOM-root or `#app` based. Bridge
  messages remain useful for target URL/render metadata, but Vibe64 must not
  hide a loaded preview just because the target app uses a different frontend
  root or because the target app is showing its own error overlay.

## Rejected Shortcuts

- Keep global selected project and merely add a workspace selector. This would
  preserve the cross-workspace race.
- Use arbitrary filesystem paths in URLs or CLI parameters. This conflicts with
  the `~/vibe64/<slug>` contract.
- Split each workspace into a separate public server as the final architecture.
  That avoids the hard scoping work but does not meet the one-server VPS goal.
- Expose random loopback preview ports as the cloud contract. That works locally
  but does not define a stable VPS/browser interface.
- Expose raw Vite/Next/Laravel dev-server ports publicly and rely on obscure
  high port numbers. Port obscurity does not prevent access once discovered or
  leaked.
- Store encrypted/reversible passwords in user files. Password verification
  should use salted hashes so stored credentials cannot be decrypted.
- Treat preview tokens as a replacement for app authentication. Preview tokens
  protect preview traffic; app authentication controls who can mint and view
  those tokens.
- Add route-by-route cloud bypasses around the old local Studio request guard.
  The guard itself must understand authenticated Vibe64 requests so HTTP and
  WebSocket callers share one policy.
- Add a second preview proxy system for cloud mode. The existing launch preview
  proxy already owns the right lifecycle and bridge behavior.

## Working Notes

- The current durable session layout is a strength and should be preserved.
- The current terminal registry is process-memory state and needs explicit
  workspace namespacing before multi-workspace use.
- Current launch descriptors for JSKIT, Next.js, Laravel, and generic Node web
  apps commonly bind target dev servers to `0.0.0.0` for launch reachability.
  That is compatible with a private runtime network, but unsafe if treated as a
  public VPS preview URL.
- The codebase already has a launch preview proxy and bridge. The migration must
  update `packages/vibe64-terminals/src/server/launchPreviewProxy.js` and its
  existing callers instead of creating a parallel preview system.
- Existing launch preview target URLs are loopback-constrained; this is a useful
  safety property and should be preserved for raw target-app ports.
- The current auth gate protects API/WebSocket behavior while allowing the SPA
  shell to render login/setup. Future stricter server-side HTML protection
  should preserve a public bootstrap surface.
- The current tokenized launch preview proxy handles HTTP requests. Vite HMR and
  other WebSocket-based preview features need an explicit decision and tests
  before considering preview parity complete.
- The migration should prefer compatibility wrappers only when they are visible
  and temporary.
