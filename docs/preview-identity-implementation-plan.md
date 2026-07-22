# Preview Identity Implementation Plan

> Historical plan: the completed design now uses an app-owned executable
> declared in `vibe64.project.json`. References below to adapter-declared
> application exchanges and fixed upstream endpoints describe the superseded
> implementation. See `docs/site/dev/technical-reference.md` for the current
> contract.

## Goal

Make a Vibe64 managed preview authenticate as a real user from the running
application without creating users, bypassing password verification, or
assuming a particular authentication backend.

The default experience is:

> Previewing as: You — the signed-in Vibe64 user's email address

The application must confirm that this identity exists. If it does, the
application's selected auth provider issues its normal browser session. If it
does not, the preview remains signed out and Vibe64 reports the exact failure.

## Product Contract

- Vibe64 chooses and authorizes the desired preview identity.
- The application declares whether it supports preview identity and provides
  the executable that performs the exchange.
- The application auth provider resolves an existing application user and
  issues its own normal session.
- Application users, memberships, roles, workspaces, and other domain records
  are never created or repaired by preview authentication.
- The signed-in Vibe64 user is the default requested identity only through the
  identifier mappings explicitly declared by the application.
- A viewer can explicitly switch to Guest or enter another existing
  application user's email.
- Each browser receives its own application cookies. Selecting an identity in
  one browser must not change another viewer's preview identity.
- Preview impersonation is unavailable in production application runtimes.
- An application that does not declare the capability gets no identity control.

## Existing Machinery We Will Reuse

### Vibe64

- Authenticated Studio requests already expose trusted `request.vibe64User`;
  client-supplied replacements are discarded.
- Launch targets already describe their preview-auth kind and receive
  preview-only environment variables.
- The managed preview proxy already owns preview-token authorization, rewrites
  requests to a loopback application target, and injects a versioned iframe
  bridge.
- The preview toolbar already owns iframe lifecycle, opaque loading overlays,
  route history, reloads, and failure presentation.
- Preview auth providers already form an adapter-neutral registry with JSKIT,
  generic cookie-profile, and Vibe64-self implementations.

### JSKIT

- `auth.dev.loginAs` and `/api/dev-auth/login-as` already define a shared
  command, route, controller response, capability flag, and native cookie
  writer.
- Supabase auth already resolves an existing user by ID or email and issues a
  development session.
- Local file and local database auth use one local auth service. That service
  already finds users by ID/email, creates native sessions, and writes the
  normal local-auth cookies.
- `/api/logout` already clears provider-native session cookies.

## Target Architecture

### 1. Provider-native JSKIT login-as

Move the development login-as action into the shared auth action contributor
instead of owning a duplicate contributor inside the Supabase provider.

Both JSKIT auth providers will implement the same service contract:

```js
authService.isDevAuthBootstrapEnabled()
authService.devLoginAs(request, { userId?, email? })
```

The local implementation will:

1. enforce the shared development-only/loopback policy;
2. require at least one useful identity lookup value;
3. find an existing, enabled local user through the selected backend;
4. when the application has a projected user layer, resolve its existing
   profile through `findByIdentity()` without calling the mutating profile-sync
   path;
5. create a provider-native `dev-auth` session through the existing session
   service;
6. revalidate that session through the same read-only lookup on later requests;
7. return the canonical profile and native session payload.

Because file and database storage implement the same backend transaction
interface, no backend-specific preview code is needed.

### 2. Signed Vibe64 identity grants

Vibe64 will not send its preview bypass secret to the browser. An authenticated
Studio request will instead mint a short-lived signed grant scoped to:

- project;
- Vibe64 session;
- launch terminal;
- target application origin;
- requested operation (`login-as` or `logout`);
- requested application user ID/email, when applicable;
- expiry time.

Grant signing uses a process-private random HMAC key that is never placed in
the launch environment, terminal metadata, Studio response, or iframe. The
preview proxy validates the signature, expiry, and exact launch scope before
exchanging it. Invalid, expired, replayed, or cross-preview grants are rejected
without contacting the application.

### 3. Preview-proxy identity exchange

The iframe bridge sends an identity grant to a reserved preview-proxy control
endpoint. The proxy:

1. verifies the normal preview access token;
2. validates and consumes the identity grant;
3. asks the active preview-auth provider for its upstream exchange request;
4. calls the loopback application endpoint server-to-server with the preview's
   random exchange secret in a fixed provider-owned header;
5. forwards only the resulting provider-native `Set-Cookie` headers to that
   browser;
6. returns the canonical user response or exact application error.

For JSKIT:

- login-as calls `POST /api/dev-auth/login-as`;
- Guest calls `POST /api/logout`.

The current synthetic JSKIT cookie minting and terminal-wide profile fallback
will be removed. JSKIT preview auth will retain only the environment required
to enable and secure the application's native development exchange. Its random
exchange secret is stored in the session's protected runtime directory so a
server can reconstruct the active proxy without exposing that secret to the
browser. Direct browser calls to the JSKIT login-as endpoint cannot satisfy the
secret-header check.

### 4. Per-browser state

Application session cookies remain ordinary host-only browser cookies on the
preview origin. The proxy no longer overwrites JSKIT auth cookies on every
request, so collaborators can use different identities against one running
application server.

Vibe64 keeps only presentation state for the current browser:

- desired identity (`viewer`, `email`, or `guest`);
- canonical application identity returned after exchange;
- exchange state (`idle`, `switching`, `ready`, or `failed`);
- exact failure message.

No selected identity is written to the repository or the terminal-wide
preview profile.

### 5. Opaque startup and switching

The existing preview loading overlay remains opaque while the default identity
exchange is pending. The sequence is:

1. load the bridge-enabled preview document;
2. request a `viewer` grant from the authenticated Vibe64 API;
3. exchange it through the preview proxy;
4. reload the iframe with its new native cookies;
5. remove the overlay only after the authenticated document loads.

This prevents the guest/login page from flashing before the real user's page.
Switching identity uses the same sequence and does not restart the application
server.

If the signed-in Vibe64 user's email does not match an application user, the
exchange stops, the preview remains Guest, and the toolbar reports the
application's real `User not found` error. It never retries in a loop.

## UX

Add a compact identity button to the embedded preview toolbar. Its title and
accessible label always describe the current state:

- `Previewing as You — merc@example.com`
- `Previewing as Alice — alice@example.com`
- `Previewing as Guest`
- `Switching preview identity…`
- `Preview identity failed: User not found.`

The menu contains:

- **You — `<signed-in Vibe64 email>`**
- **Guest / signed out**
- **Another app user…**

“Another app user…” opens a small dialog accepting an application user email.
The dialog explains that the user must already exist and that Vibe64 will not
create or modify application data.

Errors remain actionable: the menu/dialog stays usable after a failed exchange,
and the user can retry, choose Guest, or enter another email. The server and
preview do not become unusable.

## Security Invariants

- Never alter the normal password-login path or accept a universal password.
- Never expose `AUTH_DEV_BYPASS_SECRET` to Studio client code or the iframe.
- Never derive an exchange secret from client-visible project/session values.
- Never accept client-supplied `vibe64User` as the current viewer.
- Never enable the exchange when the application reports a production runtime.
- Require the ordinary managed-preview token as well as a valid identity grant.
- Bind every grant to one project/session/terminal/target and a short expiry.
- Compare signatures with timing-safe equality.
- Do not log grants, preview tokens, native session cookies, or bypass secrets.
- Do not forward arbitrary URLs, methods, or headers from the browser; the
  preview-auth provider supplies fixed upstream exchange definitions.
- Return canonical identity fields only: user ID, display name, and email.
- Treat application roles and memberships as application-owned data.

## Failure Semantics

- Unsupported adapter/auth kind: hide the control and do not attempt exchange.
- Missing Vibe64 viewer email: default to Guest and explain why in the menu.
- Existing-user lookup miss: return the application's validation error.
- Disabled application user: reject as not available for impersonation.
- Expired/invalid grant: return a retryable Vibe64 grant error.
- Stale terminal or restarted proxy: discard the old grant and request a new
  one for the active launch lifecycle.
- Application auth service unavailable: keep the preview usable as Guest and
  expose the upstream error.
- Exchange success followed by reload failure: preserve the selected identity
  state and offer normal preview reload/recovery controls.

## Execution Plan

### 1. Document and freeze the contracts

- [x] Record product ownership, UX, security, exchange, and failure contracts.
- [x] Identify the existing Vibe64 and JSKIT extension points.
- [x] Keep the first implementation limited to real-user login-as and Guest;
  user creation/provisioning remains deleted.

### 2. Complete provider-neutral JSKIT impersonation

- [x] Move the shared `auth.dev.loginAs` action into auth-core.
- [x] Remove the Supabase-only action contributor and registration.
- [x] Extract shared development-auth policy checks instead of copying them.
- [x] Implement `devLoginAs` in local auth using its existing backend/session
  abstractions.
- [x] Advertise `devLoginAs` only when the development bypass is enabled.
- [x] Preserve native cookie issuance through auth-web.
- [x] Keep production and non-loopback refusal behavior identical across
  providers.

### 3. Replace synthetic JSKIT preview authentication

- [x] Remove Vibe64's synthetic JSKIT user/token fallback.
- [x] Stop injecting and owning JSKIT application auth cookies in the preview
  proxy.
- [x] Retain the scoped bypass environment and secret for the running app.
- [x] Extend the preview-auth provider registry with fixed identity-exchange
  definitions.

### 4. Add secure Vibe64 identity grants and exchange

- [x] Add normalized identity selection and signed grant primitives.
- [x] Add exact-scope and expiry verification.
- [x] Add a reserved proxy control endpoint for grant exchange.
- [x] Call only provider-declared loopback auth endpoints.
- [x] Forward provider-native cookie changes to the requesting browser.
- [x] Return canonical identity/error results without leaking credentials.
- [x] Add bridge request/response protocol messages for the exchange.

### 5. Add trusted Vibe64 API ownership

- [x] Add a validated, audited preview-identity selection action.
- [x] Resolve `viewer` from trusted `request.vibe64User` only.
- [x] Support explicit existing-user email and Guest selections.
- [x] Mint grants only for the active ready/stale launch terminal.
- [x] Include a capability/default-viewer descriptor in launch status.

### 6. Build the preview identity UX

- [x] Add the toolbar identity button, menu, and existing-user email dialog.
- [x] Default to the signed-in Vibe64 viewer after each new preview lifecycle.
- [x] Keep the transition opaque through exchange and authenticated reload.
- [x] Keep Guest and retry controls available after every failure.
- [x] Do not restart the launch terminal when identity changes.
- [x] Reset stale identity state when project/session/terminal/proxy changes.
- [x] Make the control and dialog work at mobile toolbar sizes.

### 7. deslop: get rid of repeated helpers, repeated code, slop, without breaking anything

- [x] Remove superseded synthetic-profile/token code and exports.
- [x] Consolidate shared dev-auth policy, identity normalization, and error
  parsing helpers.
- [x] Remove duplicate action contributors and provider registrations.
- [x] Remove repeated client state transitions and adjacent duplicate lines in
  the touched launch-control code.
- [x] Re-read every touched diff for names that express domain ownership and
  for accidental compatibility shims or speculative abstractions.

### 8. Tests and verification

- [x] JSKIT local-file login-as resolves an existing user and writes native
  local cookies.
- [x] JSKIT local-database uses the same local service contract.
- [x] Supabase login-as retains its existing behavior through the shared action.
- [x] Both providers reject production, non-loopback, and missing users; local
  auth also rejects disabled users.
- [x] Vibe64 grants reject bad signatures, expiry, and scope mismatch.
- [x] The proxy refuses identity exchange without both preview authorization
  and a valid grant.
- [x] Successful login and logout forward native cookie headers only to the
  requesting browser.
- [x] Two browser contexts can use different real users against one preview.
- [x] The UI defaults to the current Vibe64 user, stays opaque while switching,
  exposes exact errors, and remains usable after failure.
- [x] Guest, You, custom email, session change, terminal restart, mobile layout,
  route history, reload, WebSocket, and preview diagnostics regressions pass.
- [x] Run focused JSKIT package tests.
- [x] Run focused Vibe64 server/client tests.
- [x] Run `npx jskit app verify` in Vibe64.
- [x] Perform a live managed-preview check with local-file auth. No configured
  live Supabase fixture was available, so Supabase was verified through its
  provider/runtime integration suites.

### Verification evidence

- JSKIT focused suites: auth-core 55, local-file 23, local-database 11,
  Supabase 44, auth-web 67, and CLI 282 tests passed.
- Full JSKIT local verification passed all 2,086 workspace tests along with
  lint, runtime-dependency and descriptor checks, plus catalog and generated-doc
  builds.
- Vibe64 focused proxy/auth tests: 46 passed; project-service regressions: 41
  passed; launch-controls client surface: 27 passed.
- Vibe64 browser verification: two real bridge/proxy UI flows passed for
  viewer, Guest, custom email, exact failure recovery, and mobile controls.
- Full Vibe64 verification: 1,332 server tests and 598 client tests passed,
  the production build completed, and JSKIT doctor reported healthy.
- Live cross-repository verification used a newly generated local-file JSKIT
  app linked to the current JSKIT checkout. A real registered user was
  exchanged through Vibe64's signed one-use proxy grant, native local cookies
  authenticated `/api/session`, Guest logged out, a missing user returned the
  exact application error and remained signed out, and direct browser access
  to login-as was rejected with 403.

## Definition of Done

- A signed-in Vibe64 user with a matching real application account reaches the
  preview already authenticated as that account.
- A missing match produces a clear, recoverable error and no new records.
- Guest and another existing user can be selected without restarting the app.
- Local-file, local-database, and Supabase auth all use provider-native sessions.
- Concurrent viewers do not change each other's application identity.
- Unsupported adapters remain unchanged.
- Production application runtimes cannot expose preview impersonation.
- No synthetic preview user, workspace provisioning, universal password, or
  terminal-global selected identity remains.
