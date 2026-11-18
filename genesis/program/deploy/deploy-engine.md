# Deploy an application through the deploy engine

The deploy engine, `@local/vibe64-deploy`, turns a project's Stack into what
runs at a provider. It runs only in Vibe64's editor, which gives it the
provider's credential, the place of its record and the prices it shows; it
depends on no editor or JSKIT package and knows no host. mobilynet is its first
provider.

## Sources

- Main: `packages/vibe64-deploy/src/index.js`
- `packages/vibe64-deploy/src/needs.js`
- `packages/vibe64-deploy/src/needsOfStack.js`
- `packages/vibe64-deploy/src/package.js`
- `packages/vibe64-deploy/src/plan.js`
- `packages/vibe64-deploy/src/record.js`
- `packages/vibe64-deploy/src/adapters/mobilynet/declaration.js`
- `packages/vibe64-deploy/src/adapters/mobilynet/index.js`
- `packages/vibe64-deploy/src/adapters/mobilynet/client.js`
- `packages/vibe64-deploy/src/adapters/mobilynet/standIn.js`

## Needs

`needsOfStack()` reads the needs from the saved commit's Stack alone, as public
Vibe64's Genesis boundary inspected its Deployment section
(`vibe64.application-deployment.v2`) and `## Resources`: each service (public
or internal, how it is reached, its instance range and Production's starting
count, its smallest machine, the services it reaches under which setting, its
own settings and sandbox allowances), each resource with the settings its
bindings name, the generated secrets and the setup code. Every service uses
every resource. A Stack that doesn't say enough is refused, naming the fix in
`genesis/stack.md` and, for a grammar refusal, its line in the section.

## The package

The saved commit is packed once (`packArchive`), with the shared build script
`vibe64-app/build.sh` and one `vibe64-app/serve-<service>.sh` per service; a
commit that already has Vibe64's own files is refused. Each service is its own
app at mobilynet, `<app>-<service>` (at most 32 characters), whose upload is the
archive with that service's `mobilynet.json` added at its root
(`servicePackages`, `serviceUpload`). Each declaration requires the base's
packages, the runtime's, the shared Packages and the service's own, each once
and at most 200; declares the machine features its sandbox allowances need, a
need for every resource, and the settings that service is given
(`settingsPerService`): Production's own and the generated secrets every
service, the setup code the public one, each Reaches setting the service that
reaches, and each Production Env entry the services it names (the public one
when it names none), at most 50 per service.

Each serve script exports the settings mobilynet gave the instance, the
resources' bound names, the instance facts, the service's own Setting lines,
then Serve's defaults, migrates and serves. The instance facts come from the
`_mobilynet` object mobilynet puts in each instance's settings:
`V64_INSTANCE_ID` (its hostname), `V64_PRIVATE_ADDRESS`, `V64_WORK_DIR` and,
for a service reached at each instance, `V64_INSTANCE_URL`. An instance without
`_mobilynet` gets none, and a service reached at each instance then stops,
naming why.

`V64_WORK_DIR` is `/srv/<login>`, the work area mobilynet makes for each
declared login on the machine's data disk (owned by the login, mounted without
`noexec`, gone with the instance), not a declared `work: true` data path:
mobilynet makes every data path root's and `start` is one command, which could
not also give the login a folder. This is the decided choice; no owner field on
mobilynet's data paths is needed.

## The Plan

`planOf()` compares the needs (the desired state), the record (what Vibe64
made) and what the provider reports now, read first through the adapter's
`inventory()`. Each service is offered the instance sizes that meet its
`- Needs at least`, cheapest first, and is refused
`production_size_unavailable` when none does. Each item gets a verb: new, kept,
changed (with each change), replaced (a service whose exposure changed),
removed (a service the Stack dropped), disconnected (a resource the Stack
dropped: unlinked, kept with its data, still priced) or missing (gone at the
provider; a missing resource stops the Deploy). A resource whose kind changed
is refused with the fix: keep the old name and declare a new one. Drift (a size
or count changed at the provider by hand) is listed per difference and must be
decided, keep the provider's value or put the recorded one back; a kept value
outside the Stack's range is refused like any choice. Things of the provider
project that are not this deployment's are listed and left alone, never priced.
The quote's lines are at list price; the hash covers the needs, the choices in
effect, the decisions, the items, the lines and a digest of the observed state,
so a Deploy held to a plan read before anything moved is refused.

## The record

The record (`record.js`) keys what was made by (environment, kind, name), each
with the provider's id and name; everything the engine makes carries the labels
`vibe64-deployment`, `vibe64-app`, `vibe64-environment` and `vibe64-item`, so
`rebuildFromLabels()` makes the record again from the provider. Its file, in
the editor's private state, is written only over the revision its writer read.

## The mobilynet adapter

`createMobilynetAdapter()` answers the engine in mobilynet's calls for one
mobilynet project and region: its offer (App Service instance sizes with their
list prices, the load balancer's, each resource kind's hosted app and sizes),
its inventory of App Services and hosted services with their labels, and the
calls the steps make. mobilynet has no leases yet: an adapter made without
`leases: true` takes none, which is safe only while one editor deploys an
environment.

## Implementation map

- `needsOfStack()` — the needs from the inspected Stack.
- `servicePackages()` — one mobilynet declaration per service and the scripts.
- `planOf()` — the Plan with verbs, drift, the quote and its hash.
- `createMobilynetAdapter()` — the provider's side of the plan and steps.
