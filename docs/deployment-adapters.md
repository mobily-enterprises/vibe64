# Deployment adapters: what is left to build

Updated 24 Nov 2026. The deploy engine, `@local/vibe64-deploy`, is built:
[its Program](../genesis/program/deploy/deploy-engine.md) explains it, with its
mobilynet, Google Cloud and AWS adapters, and
[the Deployment Program](../genesis/program/projects/application-deployment.md)
explains the `vibe64.application-deployment.v2` grammar its needs come from.
This file is the plan for what is not built yet and still holds. Its last
section says what an 18 Nov 2026 plan asked of public Vibe64 that was built or
replaced since, under that plan's ids (P1 to P16), so the plan needn't be read
again.

## Rules that hold

- Deploying works in public Vibe64: a person running Vibe64 on their own
  machine deploys their app's Production into their own provider account.
  mobilynet is the recommended provider, listed first.
- The engine runs only in Vibe64's editor and knows no host: the editor gives
  it the credential, the folder of its record and the prices.
- A key and a Production Env value never go into a project folder, a session's
  Env, a build or an agent's prompt; the build makes the release with no key.
- A Deploy that costs money, and every Delete, runs only after a confirmation
  the person gives in Vibe64's own interface, bound to the Plan's hash. An
  assistant can ask for it, never give it.
- `genesis/stack.md` says what runs. The Production card shows it (each
  service and resource, its size, health and monthly cost), the Plan, and
  only what differs per environment: sizes, a new service's count, the domain,
  the sandbox approval. Nothing holding data is made again or deleted by a
  Deploy; deleting a disconnected resource is its own action.
- Adapters are a closed set, each added with its implementation and its proof
  against the real provider. The engine names no provider.

## Left to build, in order

1. **Production on a person's own machine** (P9). A Production card in the
   local editor: Connect mobilynet (2), the Plan with the choices within the
   Stack's bounds, the sandbox approval, the confirmation bound to the hash,
   Deploy with its log (the engine's `report` events) and Stop, Take offline, Delete of
   a disconnected resource, Set instances (`setInstances`) and Set domain
   (`moveDomain`). The record is the engine's file store
   (`createRecordStore`) and the Production Env a store of the same shape,
   each in the person's Vibe64 state folder, mode `0600`, values sealed with
   an installation key made at first use. Tests: against the mobilynet
   stand-in, connect, plan, confirm, deploy a two-service app, and a second
   Deploy shows every item kept; an assistant's confirmation is refused.
   AGENTS.md's Deployment Terminology then says that public Vibe64 itself
   offers Deploy to production, not only a host.
2. **Connect mobilynet** (P10). Recommended: through mobilynet's device logins,
   the flow `mn login` uses, in place of the OAuth connected apps the plan
   designed, which mobilynet did not build. Vibe64 makes an X25519 key pair,
   starts a login (`POST /v1/logins` with its public key), shows the code and
   opens mobilynet's device page; an owner or admin of the person's
   organisation chooses the organisation, one project, the key's name and its
   scopes, and approves; Vibe64 collects the key sealed to its own key
   (`POST /v1/logins/{id}/actions/collect`) and keeps it as (1) keeps the
   Production Env. One change at mobilynet makes this one click: a login that
   names the scopes it asks for, ticked on the device page (today the page
   ticks `vps:read` and `vps:shell`, mn's). The engine's scopes:
   `services:read`, `services:deploy`, `services:manage`, `hosted:read`,
   `hosted:manage`, `network:read`, `network:manage`, `events:read`,
   `usage:read`; never a machine, key, quota, billing or audit scope.
   Disconnect forgets the key and points to the project's keys at mobilynet to
   revoke it; what runs keeps running.
3. **The viewer** (P8), components a host's card can use too: a Map (the
   internet, public services, internal services, resources, with the lines
   between them) and a List of the same facts, the Plan's items with each
   one's verb and the cost change ("$38.40 → $61.10 a month, before tax"),
   refusals naming the `genesis/stack.md` line and the fix with **Copy for the
   AI**, and drift with **Keep mobilynet's value** or **Put back** per
   difference. The drift choice comes first: the engine refuses a Plan with a
   size changed at the provider until each difference is decided
   (`production_drift_undecided`), and no card can decide one yet.
4. **Another machine, and two machines** (P11). The engine takes a lease where
   its adapter takes leases and rebuilds a record from the labels
   (`rebuildFromLabels`); mobilynet has no leases yet, so one editor deploys an
   environment. Left: mobilynet's leases; the card's "Found Production of this
   app in this project: continue it here?"; and Production Env values a new
   machine doesn't hold. mobilynet replaces a service's settings whole, so a
   Deploy from a Vibe64 that holds only some values must not send a replace
   that drops the others: either the provider keeps what a change doesn't
   name, or the values move with the person. A generated secret already given
   is never made again.
5. **The guide** (P12's rest): a Colleague usage guide for Production on one's
   own machine: connect, deploy, drift, revoke, Take offline. The grammar's
   guidance (`vibe64-helper spec deployment`) and
   [Add a service](colleague-usage/add-a-service.md) exist.
6. **A bucket's local folder in development** (P13's rest). The grammar takes
   `- Development: \`local folder\`` under a `### Resource`, and the agent
   spec says development then gives the app no bucket settings, but nothing
   in development reads it yet: Env still offers the bucket's settings and
   gives them when entered. Left: Env and the session's environment follow it,
   and an optional `path` binding names a project folder that outlives
   sessions.
7. **The record complete** (P14 to P16). **Use existing** on the Plan: adopt a
   compatible thing no item records (managed from then on, never deleted by a
   Deploy) or reference it (linked only, never resized or deleted); the
   record's `origin` already takes `adopted` and `referenced`. **Make a new
   one** for a resource gone at the provider (today `missing` stops the Deploy,
   `production_resource_missing`). One thing never serves two environments; it
   may serve a second project only by reference, and Delete refuses while a
   reference remains.
8. **Google Cloud and AWS for real**. Both adapters exist and are proven
   against their stand-ins only. Left: a first deploy of a two-service app with
   a database and a bucket at each real provider; connecting a person's own
   account with no pasted long-lived key (Google's sign-in for installed apps
   with a loopback redirect, into a published custom role; AWS IAM Identity
   Center's device authorization, into a role from a published template whose
   policy changes only things carrying Vibe64's tags), with a check of the
   connection; Cloud Run's reserved setting names and its 1000-variable limit
   checked by the engine; Redis on both (Valkey). Then moves between providers
   (plan and build at the new one, copy the data while the old one serves, a
   switch the owner presses, the old one kept stopped for 7 days).
9. **Grammar for later**, once every adapter can make it: `- Uses:` per
   service (today every service uses every resource), `### Resource` sizing
   (`- Needs at least` with storage, a standby copy, backup days) and more
   resource kinds (a queue, search, email).

## What the 18 Nov plan asked that is built or replaced

Read at public `origin/main` 7f3529167. Paths under `packages/vibe64-deploy/src/`
unless they say otherwise.

| Plan | Now | Where, or what replaced it |
|---|---|---|
| P1 services in `## Deployment` (v2) | DONE | `packages/vibe64-genesis/src/server/deploymentServices.js:31-74` and `applicationDeployment.js:52` there |
| P2 the engine and its needs | DONE | `needs.js:44`, `needsOfStack.js:29` |
| P3 the package, a declaration per service, instance facts | DONE | `package.js:66`, `adapters/mobilynet/declaration.js:219,558` |
| P3's work folder as a `work: true` data path | OUT OF DATE | `V64_WORK_DIR` is the login's own work area, `/srv/<login>` (`declaration.js:209`), decided 18 Nov |
| Every service runs Migrate as it starts, the migration tool's lock picking one | OUT OF DATE | Migrations run once per Deploy as the provider's release task, before any instance starts; no serve script migrates (`migrations.js:23`, `steps.js`) |
| P4 the mobilynet client and stand-in | DONE | `adapters/mobilynet/client.js:172`, `standIn.js:132` |
| Labels at mobilynet | DONE as tags | mobilynet's name for them: `adapters/mobilynet/client.js:18`, `index.js:229,339` |
| P5 the Plan: verbs, drift, list prices, hash | DONE | `plan.js:144`; quotas too (`production_quota_short`, `plan.js:117`) |
| P6 the steps; P7 the record | DONE | `steps.js:200,379,585`, `offline.js:26,79`; `record.js:121,199`; a Deploy can be stopped until it changes what Production serves (`stop.js:22`) |
| P6's settings after the releases | OUT OF DATE | A release brings its settings: mobilynet's refresh starts the new instances and the migrations with them while the version before keeps serving, and the service keeps them only once that refresh succeeded (`releaseService`, `adapters/mobilynet/index.js:309-321`). A service keeping its release takes an Env change on the release it runs (`putSettings`, `:384-387`). A Production Env entry is never declared |
| A Deploy sets and puts back each service's count; a count changed at the provider is drift | OUT OF DATE | A count is the provider's running setting: a Deploy sets it only for a service it makes, and `setInstances` (`instances.js:19`) changes a running one (decided 19 Nov) |
| The lease | DONE in the engine | `steps.js:543`; mobilynet's adapter takes none (`adapters/mobilynet/index.js:92-94`) until mobilynet has leases |
| The domain as one of the Plan's choices | OUT OF DATE | The domain is the caller's own configuration, read by every Deploy and changed by Set domain (`moveDomain`, `domain.js:20`); a mobilynet route keeps its DNS target |
| The settings limit, 50 per service | OUT OF DATE | mobilynet's region says it (`serviceSettingsMax`, 199, or 49 beside an older host; `adapters/mobilynet/declaration.js:34-43`) |
| P8 to P11, P13's development side, P14 to P16 | STILL HOLDS | Above, 1 to 7 |
| P10 by OAuth connected apps (PKCE, loopback, device flow, refresh tokens) | OUT OF DATE | mobilynet built device logins instead (`POST /v1/logins`); above, 2 |
| P12 the grammar's guide | DONE | `packages/vibe64-genesis/src/server/agentSpecs.js:268-274`, `docs/colleague-usage/add-a-service.md` |
| P13 `- Development:` in the grammar | DONE | `packages/vibe64-genesis/src/server/deploymentServices.js:51,252`; its effect in development is above, 6 |
| A bucket's Production at mobilynet; a public and an internal service; links to every service | DONE | deploy-engine Program, The mobilynet adapter |
| The adapter contract, Google Cloud as the third provider, AWS | DONE as the adapters | `adapters/google/index.js:62`, `adapters/aws/index.js:40`, `image.js:118,203`: each answers the same calls as mobilynet's; the contract the plan sketched is not a separate file |
