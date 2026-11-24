# Deploy an application through the deploy engine

The deploy engine, `@local/vibe64-deploy`, turns a project's Stack into what
runs at a provider. It runs only in Vibe64's editor, which gives it the
provider's credential, the place of its record and the prices it shows; it
depends on no editor or JSKIT package and knows no host. Its providers are
mobilynet, Google Cloud and AWS.

## Sources

- Main: `packages/vibe64-deploy/src/index.js`
- `packages/vibe64-deploy/src/needs.js`
- `packages/vibe64-deploy/src/needsOfStack.js`
- `packages/vibe64-deploy/src/package.js`
- `packages/vibe64-deploy/src/image.js`
- `packages/vibe64-deploy/src/plan.js`
- `packages/vibe64-deploy/src/steps.js`
- `packages/vibe64-deploy/src/serviceValues.js`
- `packages/vibe64-deploy/src/address.js`
- `packages/vibe64-deploy/src/lastRun.js`
- `packages/vibe64-deploy/src/stop.js`
- `packages/vibe64-deploy/src/offline.js`
- `packages/vibe64-deploy/src/instances.js`
- `packages/vibe64-deploy/src/domain.js`
- `packages/vibe64-deploy/src/report.js`
- `packages/vibe64-deploy/src/migrations.js`
- `packages/vibe64-deploy/src/record.js`
- `packages/vibe64-deploy/src/adapters/mobilynet/declaration.js`
- `packages/vibe64-deploy/src/adapters/mobilynet/index.js`
- `packages/vibe64-deploy/src/adapters/mobilynet/client.js`
- `packages/vibe64-deploy/src/adapters/mobilynet/standIn.js`
- `packages/vibe64-deploy/src/adapters/google/index.js`
- `packages/vibe64-deploy/src/adapters/google/base.js`
- `packages/vibe64-deploy/src/adapters/google/releases.js`
- `packages/vibe64-deploy/src/adapters/google/resources.js`
- `packages/vibe64-deploy/src/adapters/google/frontends.js`
- `packages/vibe64-deploy/src/adapters/google/services.js`
- `packages/vibe64-deploy/src/adapters/google/machine.js`
- `packages/vibe64-deploy/src/adapters/google/names.js`
- `packages/vibe64-deploy/src/adapters/google/prices.js`
- `packages/vibe64-deploy/src/adapters/google/client.js`
- `packages/vibe64-deploy/src/adapters/google/standIn.js`
- `packages/vibe64-deploy/src/adapters/aws/index.js`
- `packages/vibe64-deploy/src/adapters/aws/context.js`
- `packages/vibe64-deploy/src/adapters/aws/base.js`
- `packages/vibe64-deploy/src/adapters/aws/build.js`
- `packages/vibe64-deploy/src/adapters/aws/domain.js`
- `packages/vibe64-deploy/src/adapters/aws/resources.js`
- `packages/vibe64-deploy/src/adapters/aws/services.js`
- `packages/vibe64-deploy/src/adapters/aws/machine.js`
- `packages/vibe64-deploy/src/adapters/aws/machine.sh`
- `packages/vibe64-deploy/src/adapters/aws/offer.js`
- `packages/vibe64-deploy/src/adapters/aws/client.js`
- `packages/vibe64-deploy/src/adapters/aws/sigv4.js`
- `packages/vibe64-deploy/src/adapters/aws/xml.js`
- `packages/vibe64-deploy/src/adapters/aws/standIn.js`

## Public contract

- `needsOfStack()` reads what a project needs at a provider from its saved
  commit's Stack alone; a Stack that doesn't say enough is refused, naming the
  fix in `genesis/stack.md`.
- `planOf()` answers the Plan from the needs, the record and what the provider
  reports now: each service and resource with its verb, its drift, the quote at
  the provider's list prices, the quotas it would pass and its hash. It changes
  nothing at the provider.
- `deploy()` carries a Plan out one step at a time, under the deployment's lease
  where the adapter takes leases, keeping the record after each step and saying
  what it does through the caller's `report`. `takeOffline()` takes the services
  down and `deleteResource()` deletes a disconnected resource, each its own call;
  `setInstances()` and `moveDomain()` change a running App Service's count and
  domain (with the domain's other names) at its provider at once.
- `createRecordStore()`, `newRecord()`, `labelsFor()` and `rebuildFromLabels()`
  are the record of what a deployment made, a file written against the revision
  it read. Everything the engine makes carries the deployment's labels
  (`vibe64-deployment`, `vibe64-app`, `vibe64-environment`, `vibe64-item`) at
  its provider, under the provider's own name for them (mobilynet's and AWS's
  tags, Google's labels), so a lost record is made again from them.
- Guarantees: the engine acts only on things its record holds or that carry its
  labels; a Deploy never deletes or makes again a thing that holds data; a
  provider's refusal fails the step with the provider's reason, and what may
  answer later is asked again. Each adapter (`createMobilynetAdapter()`,
  `createGoogleAdapter()`, `createAwsAdapter()`) answers the same calls.

## Needs

`needsOfStack()` reads the needs from the saved commit's Stack alone, as public
Vibe64's Genesis boundary inspected its Deployment section
(`vibe64.application-deployment.v2`) and `## Resources`: each service (public
or internal, how it is reached, its instance range and Production's starting
count, its smallest machine, the services it reaches under which setting, its
own settings and sandbox allowances), each resource with the settings its
bindings name, the generated secrets and the setup code. Every service uses
every resource. A Stack that doesn't say enough is refused, naming the fix in
`genesis/stack.md` and, for a grammar refusal, its line in the section. The
Genesis boundary's result names the section's `### Resource` entries
`deploymentResources`, since the inspection's `resources` already names
`## Resources`.

## The package

The saved commit is packed once (`packArchive`), with the shared build script
`vibe64-app/build.sh` and one `vibe64-app/serve-<service>.sh` per service; a
commit that already has Vibe64's own files is refused. Each service is its own
app at mobilynet, `<app>-<service>` (at most 32 characters), whose upload is the
archive with that service's `mobilynet.json` added at its root
(`servicePackages`, `serviceUpload`). Each declaration requires the base's
packages, the runtime's, the shared Packages and the service's own, each once
and at most 200; declares the machine features its sandbox allowances need, a
need for every resource, and the settings the Stack names for that service
(`stackSettingsPerService`), with their types and required flags: Production's
own and the generated secrets every service, the setup code the public one, and
each Reaches setting the service that reaches. A Production Env entry is never
declared. Each service is given its declared settings and each Production Env
entry the services it names (the public one when it names none;
`settingsPerService`); mobilynet takes an entry no release declares in a
settings replace, as a plain setting or a secret (decided 19 Nov). mobilynet's
limits are the adapter's own (`declaration.js`): an App Service holds at most
as many settings and secrets in all, its links' among them, as its region says
now (`GET /v1/regions`, `serviceSettingsMax`: 199 where every host of the
region runs agent 2.9.0 or later, 49 while one runs an earlier agent). The
adapter reads it at each ask (`serviceSettingsMax()`; 49,
`SERVICE_SETTINGS_FALLBACK`, where mobilynet doesn't say), and the editor
passes it to `servicePackagesProblem` and `servicePackages` as `settingsMax`
(49 when not given). Each link gives a database's 6 fields, Redis's or a
bucket's 5, which mobilynet writes into the service's own settings and
secrets. No setting may take a name mobilynet's runtime sets on every instance
(`PATH`, `HOME`, `LANG`, `GIT_CONFIG_COUNT` and any starting `GIT_CONFIG_KEY_`,
`GIT_CONFIG_VALUE_` or `MOBILYNET_`, `runtimeSets`), which an app exporting its
settings would lose. The engine counts the names a Deploy sends a service, each
once (a generated secret or the setup code the Production Env holds too is
one), with its links' fields: a production web holding 48 matched it on 19 Nov,
and its next Deploy's 50 fit a region that holds 199.
An Env entry that holds no value (a secret not set, `valuePresent: false`) is
given to no service, so it is neither sent, counted nor checked against
mobilynet's names. It may count one name it doesn't send, the setup code once
the first account removed it from the Env, since a first Deploy makes and
sends it.
`servicePackagesProblem` refuses either before anything
is made, naming the service, the setting or the count, and the fix
(`vibe64_production_setting_reserved`: another name in the Production Env, or
in genesis/stack.md where the Stack names it; `vibe64_production_too_many_settings`),
which the editor's Plan shows. `V64_*` names are Vibe64's own: mobilynet leaves
them open, and `envEntryProblem` keeps them out of the Production Env. So a release is made
of the code and the Stack alone (`releaseDigest`), and adding, changing or
removing a Production Env entry is a settings change of the release a service
runs, never a new release or build: until 19 Nov every entry was declared, and
adding one made mobilynet build the same code again (about four minutes for a
production web service, for one name).

Each declaration's build cache (`build.cache`) is its runtime's folder (Node's
`~/.npm`) and the Deployment's `- Kept between builds:`, each once
(`buildCacheOf`), at most the 10 mobilynet keeps: more is refused before
anything is made (`vibe64_app_package_build_cache_invalid`, naming the
runtime's and the fix). mobilynet's build VM starts with an empty home, puts
back what the project's last build of that app left in those folders before the
build command and keeps them again after it, at most 4 GiB in all (its
`mobilynet-build-run` cache-restore and cache-save). So a Prepare that installs
each pinned tool into a store in the home and links it into the release
downloads nothing on the next build with the same pins: Mercbot's
822 MiB tools store (`~/.cache/mercbot-tools`) was downloaded again by every
build, 81 s of its 101 s command on 24 Nov 2026, because only `~/.npm` was
kept. What a step reuses there is the step's to check by the version or hash it
pins; mobilynet puts back only that project's app's own last cache.
`deployBuildCache.unit.test.js` runs an app's builds as mobilynet's build VM
does, its cache restored and saved by the runner's tar commands, and counts a
local server's downloads: the same pins download nothing the second time, a
changed pin once, and without the line every build downloads.

The build script runs Prepare then Build. For the python runtime each
declaration also requires `gcc-unwrapped^lib` and `zlib`, its build block takes
`patchelf`, and the build's last step (`PYTHON_LIBRARY_LINES`) adds those
packages' library folders,
`/nix/var/mobilynet/packages/gcc-unwrapped^lib/lib` and
`/nix/var/mobilynet/packages/zlib/lib`, to the RUNPATH of each shared object in
the release that needs `libstdc++.so.6`, `libgcc_s.so.1` or `libz.so.1`: the
native modules of pip's manylinux wheels, such as numpy's, pandas' and scipy's,
which python313's loader finds nowhere else. Those paths are the machine's and
the same in the build VM, so a venv built in `/home/build/src` loads them from
the app's folder, `/nix/var/mobilynet/apps/<app>`, and nothing goes into the
environment. A copy of the interpreter made to load them would not survive the
move, since a venv links to its interpreter by the build's path; the venv's
console scripts keep that path in their first line too, so a Serve starts one
as `.venv/bin/python -m <module>`. `deployMobilynetPythonNativeLibs.integration.test.js`
builds such an app's upload as mobilynet's build runner does, runs it from
another folder with the build gone, and needs mobilynet's packages and a folder
of pinned wheels (`tests/fixtures/python-native-wheels.txt`), skipping without
them.

Each serve script exports the settings mobilynet gave the instance, the
resources' bound names, the instance facts, the service's own Setting lines,
then Serve's defaults, and serves; no serve script migrates. The instance facts come from the
`_mobilynet` object mobilynet puts in each instance's settings:
`V64_INSTANCE_ID` (its hostname), `V64_PRIVATE_ADDRESS`, `V64_WORK_DIR` and,
for a service reached at each instance, `V64_INSTANCE_URL`. An instance without
`_mobilynet` gets none, and a service reached at each instance then stops,
naming why. mobilynet leaves an app's settings to its `start` step, as root, in
`/run/mobilynet/apps/<app>/settings.json`; `start` copies them for the
service's login to `/run/app-settings/<app>/settings.json` (mode `0400`), which
the serve script reads.

Migrate is each release's `migrate` task, mobilynet's release task (its
`docs/stages/release-tasks.md`, main `17340a6a`): the declaration's
`tasks.migrate` is `{ command }` alone, and a refresh asked for it runs it once,
after its build passed and before any instance starts, on a temporary instance
of the new release with the service's settings and links, in place of that
machine's `start`, as root, in the app's folder, stopped at the start step's
280 seconds. So that no root step runs a file of the app's, the command is
`systemd-run --pipe --wait --collect --service-type=exec --same-dir
--uid=<login> --property=EnvironmentFile=/etc/mobilynet/service.env
--property=LoadCredential=settings.json:/run/mobilynet/apps/<app>/settings.json
bash vibe64-app/migrate-<service>.sh`: systemd runs the release's migrate
script as the service's login, with the services' environment and the root-only
settings copied into the script's own credentials folder
(`$CREDENTIALS_DIRECTORY/settings.json`), waits for it, and exits as it did,
its output (and systemd's line saying how it ended) the task's instance's logs.
The script exports the same settings and facts as the serve script (an instance
that serves nothing needs no address of its own, so a service reached at each
instance migrates without one), then migrates in the work folder. An app with
no Migrate step has no task. Because no serve script migrates, an instance of
any version can start on a database a later release migrated; on 23 Nov an
instance of the version before restarted with new settings, migrated as it
started, and knex refused a database holding migrations its code lacked, which
failed that service's settings and the Deploy. Since then a release brings its
service's settings (4), so no instance of the version before restarts for a
Deploy's settings at all.

`V64_WORK_DIR` is `/srv/<login>`, the work area mobilynet makes for each
declared login on the machine's data disk (owned by the login, mounted without
`noexec`, gone with the instance), not a declared `work: true` data path:
mobilynet makes every data path root's and `start` is one command, which could
not also give the login a folder. This is the decided choice; no owner field on
mobilynet's data paths is needed.

## The image

A provider that runs containers gets the release as an OCI image per service,
built at the provider by its own build service from the service's upload, with
no Vibe64 credential in the build. `imagePackages()` is the container twin of
mobilynet's `servicePackages()`: the same archive and build script, and a serve
script per service that reads every setting from the container's environment
(each resource's fields as `V64_<RESOURCE>_<FIELD>`, the names mobilynet's needs
give, mapped to the app's bound names the same way), takes the instance facts
the runtime gives (a service reached at each instance stops without
`V64_INSTANCE_URL`), then migrates and serves on port 3000. Its declaration per
service names the image's packages (the same nixpkgs attribute names mobilynet
declares), port, health path, machine features, the resources it needs and its
settings. `imageUpload()` adds `vibe64-app/Containerfile` to the archive: Nix's
image, the packages from one nixpkgs commit the editor names (never a branch),
the release, the shared build, then the serve script as a user of its own.
Each image build starts empty, so the Deployment's `- Kept between builds:`
keeps nothing there.

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
changed at the provider by hand) is listed per difference and must be decided,
keep the provider's value or put the recorded one back. Things of the provider
project that are not this deployment's are listed and left alone, never priced.
The quote's lines are at list price; the hash covers the needs, the choices in
effect, the decisions, the items, the lines and a digest of the observed state,
so a Deploy held to a plan read before anything moved is refused.

An App Service's count is a running setting, not part of a Deploy (see
[An App Service's count](#an-app-services-count)). A service the Deploy makes
(new, or gone at the provider) starts with the count chosen for it
(`choices.services.<id>.instances`, within the Stack's `- Instances:` range,
else `production_choice_invalid`) or the Stack's `- Production:`. A service the
provider runs keeps the count it runs there, whatever set it: the Plan shows it
in `services[].instances.live` (null for a service the Deploy makes), prices
it and counts it as used against the quotas, puts it in its choices in effect
so the quote adds up, and never changes it. A count asked for such a service
that differs from it is refused `production_instances_running` ("computers
runs 4 instances at mobilynet: a Deploy leaves the count of an App Service that
runs as it is. Set its instances to change it."), and a count set there beyond
the Stack's range is the provider's: shown, never refused by the Plan. A count
differs from the record by no drift and needs no decision. A service made
again because its exposure changed starts with the count it ran. The live count
is in the observed digest and the quote, so a count that moved between reading
the Plan and confirming the Deploy refuses the Deploy as a stale plan, like any
other move.

Where the offer says the provider project's quotas (`quota.quotas`: each
quota's unit, limit and use, and `quota.counts`: which of them a service's
instance and a resource's machine count against), the Plan's `quota` lists what
the Deploy adds to each, and each it would pass is the problem
`production_quota_short`, naming the quota, its limit, its use, what the Deploy
needs and how much more than is left, so a Deploy that wouldn't fit stops
before anything is made. A Deploy makes and grows things before it shrinks or
deletes any, so it adds each item's growth and is credited nothing for what it
shrinks or removes. mobilynet's offer reads the project's quotas
(`GET /v1/projects/{id}/quotas`): an App Service counts its instances' vCPUs and
memory, a hosted service its machine, vCPUs, memory and data disk. An offer
that says its quotas aren't checked (`quota.unchecked`: Google Cloud's and
AWS's, whose quotas no one call answers with their use), or says nothing, gives
`{ checked: false, words }`, and a quota passed stops the Deploy at the step
that needs more, with the provider's reason. The hash leaves the quotas out:
their use moves with the rest of the provider project, and the Deploy counts
them again as it starts.

The adapter's offer always gives its title, currency, service `sizes`, the load
balancer's price and each resource kind's sizes. Three fields are optional, for
a provider that runs some services or kinds differently; an offer without them
(mobilynet's) plans exactly as before:

- `machineSizes`: the whole machines offered to a service with a sandbox
  allowance or reached at each instance, where the provider runs those apart
  from the rest. Such a service is offered these, and priced from them, in
  place of `sizes`; a size from the other list is refused like any choice.
- `resources[kind].title`: the product a resource kind is at the provider
  (such as its database engine and version), carried into the Plan's resource
  so the owner reads what will run.
- `unsupported[kind]`: the provider's reason for a resource kind it runs none
  of, added to the `production_resource_unsupported` refusal.

In the inventory, a service may report `internalUrl`, the address other
services reach it at when that is not `http://<internalName>:<port>`; each
Reaches setting is then that address.

## The steps

`deploy()` reads the Plan again and refuses a Deploy whose hash is not the one
the owner confirmed (`production_deploy_plan_stale`) or whose plan has problems, takes
the lease `deploy:<deployment id>` for 600 seconds where the adapter takes
leases (refused `production_deploy_lease_held`, naming the holder and since when),
then does one step at a time (`nextStep`, `applyStep`), keeping the record after
each and renewing the lease, until the deployment is live or failed, and gives
the lease up either way. Every call carries an idempotency key naming this
Deploy's run, so a call tried again gets its first answer while a later Deploy
asking the same again is not answered with an old one; a Deploy cut short
between a create and keeping its record is made whole by the next, which adopts
the thing labelled as that item (and a link already standing) rather than
making it twice. In order:

1. a service whose exposure changed is deleted, to be made again;
2. each resource's hosted service is made, labelled, or resized, and waited for;
3. the domain is added to the provider project when none covers it, then each
   of the domain's other names (the release's `aliases`, such as its www name;
   none when it gives none). A release with other names is refused before the
   provider is asked anything, `production_deploy_aliases_invalid` (422) when
   one is no lowercase host name, is the domain itself or is named twice (the
   app's server would refuse to start with them), and
   `production_deploy_aliases_unsupported` (409) by an adapter without
   `takeDomain()` (Google Cloud's, AWS's), which can't route them: never dropped;
4. each service after the services it reaches, else (and among services that
   reach each other) internal ones first, in two passes. First every
   service that runs a release and is to be handed a new one is readied on the
   version it runs. It is linked to each resource it isn't linked to at the
   provider, so that release's instances start with them however soon the
   provider starts them: a provider that reuses a build starts a refresh's
   instances as the refresh starts (mobilynet's reconcile does both in one
   transaction; a production Deploy on 18 Nov handed a service a release at
   23:42:09, and its first instance started at 23:42:10). Every service is
   linked before the Deploy hands any release. Its settings go with its release,
   never ahead of it (below). Then, each service in turn: its release is uploaded and its App Service made (labelled,
   internal ones with no routes, the public one routed at the domain and its
   other names with a connection to each service it reaches, or made with no
   route while another App Service the record holds has the domain or one of
   them: 7) with the count the Plan chose for
   it, or it is handed the release, bringing its settings where they differ from
   those it was given. Each resource it is still not linked to is
   linked the moment that refresh is open, and the refresh is waited for.
   mobilynet's refresh rolls to the count the service has as it rolls, so a
   release starts as many new instances as the service runs, and one that fails
   leaves the version before serving on that count.
   - A provider may take a link only with the service's new release under way:
     the release the service runs doesn't name the resource, it runs none yet,
     or the refresh moving it hasn't read its release. Its adapter then refuses
     the link with the engine's own code, `link_needs_release`; the mobilynet
     adapter answers mobilynet's `422 validation_failed` for those cases so. A
     link asked before the release is then made once its refresh is open. One
     asked while the refresh is open is asked again at the next step.
   - mobilynet checks a link against the release a service runs or, when that
     names no such need, against the release its refresh in progress (building
     or rolling) moves it to. Made against that release, the link's settings go
     into the refresh, and mobilynet replaces any instance the refresh started
     without them (`link_changed`). So a new service, one whose first release
     failed and a release naming a new resource are linked as soon as their
     refresh is open, and with a reused build mobilynet replaces the instances
     it started first. Starting none without the link needs mobilynet to take
     links before a refresh starts.
   - Linked first, a service whose running release names the resource gets the
     link's settings before its release's refresh starts. Its refresh starts
     every instance with them, and a failed refresh never ends that link.
     Linked after the release instead, as the engine did until 19 Nov, mobilynet
     queued the link's settings behind the move, and every instance of the new
     release started without the resource.
   - A release brings its service's settings (mobilynet main c3575399, 24 Nov):
     where they differ from those the service was given, the engine hands the
     release with them (`POST /v1/services/{id}/releases` by the version the
     release's upload made, with `settings`, `secrets` and `remove`, the names
     it was given before and no longer). The refresh starts its new instances
     and its release task (the migrations) with the service's settings changed
     by them, while the version before keeps serving with its own, and the
     service takes them only once that refresh succeeded: one that fails or is
     aborted leaves its settings as they were. So no instance of the version
     before ever restarts for this Deploy's settings, before or after its
     migrations ran. Until 24 Nov the engine gave every service its settings on
     the version it runs before any release: on 23 Nov a production
     Deploy did, computers' release migrated the database, and web's instances
     of the version before, restarting with web's new settings, migrated as they
     started and were refused by knex, twice. Settings ahead had come in on 19
     Nov so a Deploy could put right a release that fails for a setting's value
     (a setup code too short for a newer framework, deployed again four times
     with the value never sent); a release that brings its settings does that
     too: the owner changes the value and deploys again, and the release brings
     it. A value the version before refuses, which the release takes, needs no
     detour either.
   - mobilynet checks what a release brings as it checks a settings replace:
     never a name a need's link sets (given or removed), a setting the release
     declares otherwise `422 validation_failed`, and, while no other refresh of
     the service is open, the service's settings with them must hold every
     setting the release requires (`422 settings_missing`) and at most as many
     as its region holds (199, or 49 while a host of the region runs an agent
     before 2.9.0); behind an open refresh they are checked as its build
     passed. It takes a name the release doesn't declare as a plain setting or
     a secret, text of up to 4096 characters, so a Production Env entry, which
     no release declares, goes with any release (decided 19 Nov). Bringing
     settings needs the key's `services:manage` beside `services:deploy`.
   - A setting a service requires that the Production Env has no value for (a
     generated secret it doesn't hold; Production's own and the Reaches
     settings have theirs from Production and the provider) would fail the
     release or the App Service requiring it, so the Deploy fails before any
     change, naming it and the fix: give it a value in the Production Env, then
     deploy.
   - The record counts settings as given (their hash, `settingsHash`, and their
     names, `settingNames`, which a later release's `remove` needs) once the
     refresh that brought them succeeded; the run holds them as `bringing`
     until then, and a Deploy reading how a stopped one's refresh ended
     (`settleLastRun`) counts them only if it succeeded. A record kept before
     the names were has no names, so after that release succeeds it keeps no
     hash and 6 replaces the settings once, dropping names no longer given: the
     one Deploy after an editor before 7f3529167 kept a record rolls each
     service whose settings it brings twice (Mercbot's production Deploy of 24
     Nov), and none after it does, its names kept; on 25 Nov no Production
     record from before it remained, so that roll is not needed for day 0. A
     service whose settings name one this Deploy still makes (a Reaches of a
     new service) is handed its release without them and given them in 6, on
     that release. Until 25 Nov
     an internal service reaching the public one came first and waited for its
     address, so their first Deploy never made either. Services that reach each
     other, none made yet, can't start, since a provider gives an address only
     once the service is made and mobilynet refuses a release without a setting
     it declares: the Deploy fails before making any App Service ("computers
     reaches web, which can't start before computers does, and neither runs
     yet: take one of their Reaches lines out of genesis/stack.md until both
     run, then deploy to production."). Google and AWS bring them the same way,
     in the release's own revision or template.
   - A refresh that fails ends the links mobilynet made against the release it
     moved to, which the record lets go so the next Deploy makes them again,
     and fails the Deploy with the service's reason. Services not yet moved keep
     serving their version.
   - The record names each link the engine made, but a link counts only while
     the provider holds it. The mobilynet adapter's inventory lists, for each
     hosted service Vibe64 made, the links mobilynet holds (issuing, active or
     failed), and a link the record names that mobilynet ended counts as none,
     so the next step makes it again. mobilynet ends every link the release a
     service still runs doesn't name when a refresh of it fails or is aborted,
     whichever run made the link and even when no Deploy reads that refresh
     (the run that made it stopped first, and the next began while it was
     still open). An owner may also remove a link by hand.
   A link mobilynet still holds that a record made again from labels
   lacks is taken up when the link is asked again (`need_linked`). Adapters that
   list no links (Google Cloud, AWS) are taken at the record's word.
   The record keeps, with each service, the release it was last handed: its
   upload's SHA-256 and its declaration (`releaseDigest`) and the version. A
   service still running that version with no error, for the same upload, keeps
   it and is handed no release, since a provider refreshes onto every release it
   is handed, even the one it runs; so a Deploy that changes only a size
   replaces no instance for nothing. One whose release failed, or whose
   record was made again from labels, is handed its release again.
   Where the adapter runs a release's task (mobilynet's does; Google Cloud's
   and AWS's run none, and their serve scripts migrate), the first release this Deploy
   hands (a new App Service's or a release of one) carries the migrations
   (`task: "migrate"`, `migrations.js`), unless the database already ran this code's: the
   record keeps, once they ran, the fingerprint of the archive they migrated
   (`migrated`, `{ fingerprint, release, at }` for the last 50, newest first).
   So an earlier version deployed again runs none, and its log says it runs on
   the later release's schema: deploying an earlier version returns its code,
   never its schema. The provider runs them once, on
   a temporary machine of the new release with its settings and links, after
   its build passed and before any of its instances starts; a later release in
   the same Deploy carries none. Migrations that fail fail that refresh with
   nothing rolled out and the Deploy with the provider's reason (mobilynet's
   names how the task ended, `failed`, `timeout` or `machine_failed`, and where
   its output is), the version before still serving, and the next Deploy runs
   them again. The provider gives no exit code or output: their output is the
   logs of the instance they ran on, which the step reading the refresh names. A release that
   fails after its migrations ran says that the version before serves on the
   migrated database, and the next Deploy doesn't run them again;
5. a resource the Stack no longer names is unlinked from the services that
   stay and kept with its data;
6. each service's settings (`settingValues`: Production's own, each Reaches
   setting the reached service's private address, the Production Env's values
   for the names it is given, and the public service's `APP_REDIRECT_HOSTS`, the
   domain's other names comma-separated, while it has any: a JSKIT app's server
   answers a request for one with a 301 to the same path at `APP_PUBLIC_URL`.
   No release declares it, so adding or removing a name is a settings refresh
   of the release the service runs, and neither a Production Env entry nor a
   Stack service's `Setting` or `Reaches` may name it) where they differ from those it was given: a
   service that kept its release, so that a change of the Production Env alone
   is a settings refresh of the release it runs, or one handed its release
   without them (4: they name a service this Deploy made). Then the services it reaches and its size, only once
   every move ended: mobilynet refuses a settings replace while a link made
   ahead of an open refresh stands. The record's choices follow each size the
   Deploy sets, so a Deploy that fails after one leaves the next Plan starting
   from what runs. The record counts a settings
   refresh's settings as given once it succeeded, as a release's (4): one that
   fails leaves the service with those it had, so the next Deploy gives them
   again, and after a Deploy that stopped while one ran, the next gives them
   again unless it reads that it succeeded: one still running may yet fail;
7. the domain and its other names, where the adapter lists the names each App
   Service's routes send it (`hosts`, mobilynet's inventory) and the public
   service lacks any, are routed to it once it runs its release healthy
   (`takeDomain`, `address.js`), the whole list in one call (mobilynet replaces
   a service's names), each moved only from the App Service the record holds
   that has it. A Deploy routes no name away: the owner's change of the names
   moves them at once (`moveDomain`). The domain is moved in one call from the
   App Service the record holds that has it, so a
   renamed public service (made in 4 without the domain while the one it
   replaces still served, where mobilynet refused it `name_taken` until 20 Nov)
   takes the address with no gap and the same DNS target before the old one is
   deleted; a public service lacking it otherwise (its route deleted or moved by
   hand) asks for it plainly, which the provider refuses when a thing the record
   doesn't hold has it, failing the Deploy with its reason;
8. a service the Stack no longer names is deleted;
9. live, once every service runs its release on as many healthy instances as
   the provider runs it on now (its live count, whatever set it; 1 where the
   provider reports none) and its last refresh (a link's or a change's) did not
   fail. Where the adapter names the address's DNS target that stays
   (`domainRecords()`'s `target`: a mobilynet route's own name), a Deploy that
   goes live tells it once (`{ kind: "address", host, target, previous, words
   }`) when the record holds none or another, and keeps it (`record.address`,
   what the owner was told): "app.example.com's DNS target is
   rte-k7m2abcdef.routes.apps.example.com, which stays the same through Take
   offline, every Deploy and a replaced App Service. If its CNAME (or ALIAS)
   names anything else, such as an App Service's own name, change it once."
   Every deployment recorded before 20 Nov hears it once at its next live
   Deploy; a read of it that fails never fails a live Deploy.

So a Deploy changes only what changed. A hosted service is made once and then
only resized when its chosen size changes, and is never made again, restarted or
given a new setting; a link is made once and kept while the provider holds it,
so the same server keeps the same login, and a Deploy makes one again only for a
link the provider ended. Only an App Service whose release changed (its code,
its declaration: the Stack, never the Production Env) or whose last release
failed is handed a release, and so gets new machines; the others keep theirs.
One whose Production Env entries alone changed keeps its release and gets a
settings refresh of it. One whose settings changed with its release gets them
with that release, once: the version it runs keeps serving with its own until
the release succeeds, and a release that fails leaves them as they were. A Deploy of unchanged code, Stack and Production Env sends the provider
nothing but its lease. The migrations run at most once per
Deploy, and not at all when no release is handed or the database already ran
this code's. The engine's tests hold the provider to these exact writes
(deploySteps: an unchanged redeploy, one of two services changed, a failed
release handed again, the migrations run, skipped and failing, a secret's new
value brought by the release it fixes, a Production Env entry added, changed
or removed on unchanged code given as a settings refresh alone with the same
release digest and no upload or release, a new generated secret brought by
the release requiring it, a fixed value and a new entry brought together and
the entry removed by the next release, a required setting the Production Env
has no value for refused before any change, a value the version before would
refuse brought by the release that takes it, a release that fails leaving the
service's settings and the record's as they were, and a Deploy resumed after a
release that brought settings succeeded, failed or still ran) and to the 23 Nov
Deploy: a two-service Deploy hands each release with its new settings and no
instance of the version before ever starts, before or after the migrations ran,
nor after a Deploy that stopped once they ran. A model of knex's migration list
in the stand-in (an instance whose release migrates as it starts refuses a
database holding a later release's migrations) is what failed the Deploy as it
failed on 23 Nov. Two parts rest on mobilynet: a link made ahead of a failed
refresh ends with it (M14), so the next Deploy makes it again with a new login;
and the migrations run once only where the provider runs a release's task.

A refusal from the provider (a quota, the spending cap) fails the Deploy with
its reason after the step's own words, as its log named it (`stepWords`:
"Making the hosted service for database: …", never the step's kind), the
record kept as far as it got; an answer the provider may give later is tried
again. That holds for the provider read at the top of each step
too: a read that got no answer, a 5xx or the provider's rate limit (as a Deploy
waiting minutes for a build may meet) is tried again, one pause later, then two,
four and at most six (30 seconds at a caller's 5), for as long as the Deploy
waits, so the run lives until it is live or failed; before, one such read ended
the run with its record still deploying. The reads a Deploy makes before it
changes anything (the offer, the inventory, the edge's addresses: `firstRead`)
are tried again with the same pauses, at most five times, after which it stops
`production_deploy_unanswered` ("mobilynet didn't answer, so the Deploy
stopped before changing anything. Deploy again."), having kept no record and
asked the provider nothing else; before, the first such read that got no
answer ended the Deploy with the transport's own error. A Deploy first reads how each refresh
the Deploy before it started, and never read, ended (`settleLastRun`: that one
stopped in its wait): one that failed or was aborted is let go as that Deploy
would have let it go, its links made ahead dropped, since they ended with it,
and its service handed its release again, so a Deploy after a run that stopped
makes the links again and reuses everything else it made. A Deploy never deletes or makes again a hosted service
and never acts on a thing the record does not hold. `takeOffline()` deletes the
services, public first, and keeps every resource (and at mobilynet the domain's
route, which then sends to nothing and keeps its name, certificate and DNS
target, so the next Deploy's public service takes it): it keeps the record without
them (`save`) once each delete is asked, then reads the provider again
(`pause` between reads, 5 seconds unless given) until it lists none of them,
and returns. A provider still removing some after `maxReads` reads (120 unless
given) is refused `production_deploy_offline_unfinished`, naming them; they take no
new requests by then, and the provider finishes by itself. `deleteResource()`
deletes a disconnected resource and its data only when the owner typed its
name.

Both say what they do as they do it, through the caller's `report(event)`:
each step as it starts and ends (`{ kind: "step", phase: "start" | "done" |
"refused", step, words, service?, resource?, refresh? }`) in the engine's own
words (`stepWords`, in `report.js`: "Making the hosted service for database",
"Uploading the release of web", "Making App Service web, public behind the
load balancer at app.example.com", "Updating the settings of web", "Handing App
Service web the new release", "Linking web to database", "Reading how the
update of web ended", "Deleting App Service web"), each wait when its words
change, each call
tried again (`{ kind: "retry", words, message }`), each service gone at Take
offline and the end (`{ kind: "end", outcome, migrations? }`). Where the
provider runs the migrations as a release's task, the step that hands them says
so ("…, which first runs the migrations once"; its `message`: "Its refresh runs
the migrations once, on a temporary machine of the new release, before any
instance starts."), the first hand-over that needs none says "Migrations
skipped: the database already ran this code's migrations.", the step reading
the refresh says how they went and where their output is ("The migrations ran
once. Their output is in the logs of vps_….", or "The migrations failed: they
exited with an error. Their output is in the logs of vps_…."), and the end says
`migrations`: `ran`, `failed`, `asked` or `skipped`. A step that starts a refresh,
or reads how one ended, names it (`refresh: { serviceId, refreshId }`), so the
caller can follow what the provider does in it. No event carries a setting's
value, and a report that throws or rejects never stops the run. Every event has
its time (`at`).

Every App Service the mobilynet adapter makes asks for mobilynet's shortest
drain, 30 seconds (`DRAIN_SECONDS`; genesis/stack.md has no line for it): an
instance leaving (a count lowered, a refresh replacing it, its service deleted)
leaves the load balancer, has that long to finish the requests it has, then
gets a stop signal and as long again.

Linking against the release a refresh moves to is mobilynet's engine-support
M14, in its final shape, which its stand-in follows: only the refresh in
progress counts, never a queued one; the link's settings go into that refresh
and every change of settings queued behind it, and instances it started
already are replaced (`link_changed`); when it fails, a link made ahead ends
and its settings leave the changes queued. A link a service's running release
and its release ahead both name is not made ahead: its settings refresh queues
behind the move, and starts, as mobilynet's does, on the release that move
brought (a settings or size refresh runs on the release its service runs as it
starts, never the one it ran when queued). That is why the engine links such a
service before handing it its release. The stand-in's `instantBuilds` switch
starts a refresh whose build is done, and its first instances, in the step it
starts, as mobilynet does with a reused build. Until mobilynet runs M14, mobilynet links only against the
release a service runs, and the first Deploy of an application whose serve
script needs its database there fails.

## Stopping a Deploy

A host offers the owner a way out of a Deploy that waits, such as one whose
build is queued at its provider behind another (23 Nov: a release's build sat
queued 25 minutes behind another build of its project waiting for a build
server with its base, and nothing could end it). `deploy()` takes
`stopAsked`, which answers once whether the owner asked to stop since it was
last called; the Deploy asks it at each step's boundary, and the host wakes
it from its pause so the boundary comes at once. `deployStopOf(adapter,
record)` (`stop.js`) decides, from the record as the Deploy kept it last:

- a run not deploying holds nothing open: allowed, with nothing to stop;
- a service this Deploy handed its release (`handed` on its run state) whose
  update ended already runs it: refused, as stopping would leave Production
  partly on the new release;
- an update past its build (the adapter's `refreshProgress` says `started`:
  its build passed, its release task, the migrations, or a new instance
  started, or it rolls) is refused, a settings update's instances restarting
  likewise;
- otherwise allowed, naming each update still `queued` or `building` with its
  build.

Allowed, the Deploy tells `{ kind: "step", step: "stop" }` start and done,
stops each update at the provider (`stopRefresh`: the update aborted, then its
build ended, so it no longer holds its project's queue), keeps the record with
its run `stopped` (each service's update still named), tells `{ kind: "end",
outcome: "stopped" }` with what it ended, and answers outcome `stopped`; its
lease is given up as at any end. The services keep the version they ran. The
next Deploy reads how those updates ended as it reads a Deploy that stopped in
its wait (`settleLastRun`: an update aborted with no error "was stopped with
the last Deploy"), drops the links made against them and hands their releases
again, which the provider builds again. Refused, the Deploy tells the stop
`refused` with the reason, in words the owner reads ("This Deploy can't be
stopped now. … It goes on and ends by itself: Live, or Failed with its
reason."), and goes on. A provider that doesn't answer the stop's reads is
tried again at the next boundary.

## The record

The record (`record.js`) keys what was made by (environment, kind, name), each
with the provider's id and name; everything the engine makes carries the labels
`vibe64-deployment`, `vibe64-app`, `vibe64-environment` and `vibe64-item`, so
`rebuildFromLabels()` makes the record again from the provider. Its file, in
the editor's private state, is written only over the revision its writer read:
another writer's change refuses it `production_deploy_record_stale`, in the
owner's words ("Production's record changed while this ran, so it stopped
before writing over that change: try again."), the revisions in its `details`.
The links it names are believed only while the provider holds them, where the
adapter lists them (The steps, 4). It keeps each service's size and no count:
the provider holds the count (An App Service's count). A record written before
19 Nov 2026 holds a count in each service's item and choices; the Plan, the
steps and `setInstances()` ignore it, nothing reads or upgrades it, and the next
Deploy that goes live or changes a size writes choices without it.

## An App Service's count

How many instances an App Service runs is a running setting the provider holds,
never part of a Deploy, which makes a service with the count its Plan chose and
then never sets, puts back, keeps or waits on a stored one (`instances.js`). It
is set at the provider, at once, by `setInstances(adapter, record, needs, {
service, instances })`, the owner's scale action, by the provider's own
controls, or by an app scaling its own service with a key of its own (at
mobilynet, a project key with `services:deploy`). `setInstances()` refuses a
service the record holds no item for, or the Stack doesn't name,
`production_deploy_item_unknown` (404), and a count that isn't a whole number within
the Stack's `- Instances:` range `production_deploy_instances_outside` (422), naming the
range ("computers runs 1 to 20 instances, as genesis/stack.md's - Instances:
says."), before it asks the provider anything. Then it is one call of the
adapter's `changeService(id, { instances })`, with an idempotency key of its own
each time, so a count set again after an app or the provider changed it is asked
again, not answered with the first answer. The provider may still refuse it (its
own limits, a quota, no room for more), with its reason. It answers `{ service,
instances, refreshId }` and leaves the record unchanged:

- mobilynet: `PATCH /v1/services/{id}` with `instances` (`services:deploy`),
  which places or drains instances at once and starts no refresh; mobilynet
  takes 1 to 100 and refuses a count its project's quota or the region can't
  place, the count staying as it was. Its stand-in does the same, keeping each
  key's first answer.
- AWS: a Fargate service's `desiredCount` (ECS `UpdateService`), or a machine
  service's Auto Scaling group (`MinSize` and `DesiredCapacity` the count,
  `MaxSize` twice it), in place, no refresh.
- Google Cloud: a Cloud Run service's scaling (`minInstanceCount` and
  `maxInstanceCount` the count, no new revision), or a managed instance group's
  resize, in place, no refresh.

A later Deploy hands each release onto the count the service runs then, and is
live once that many are healthy.

## A running service's domain

Which domain a deployment serves is its caller's configuration, never the
record's. A Deploy routes its release's `domain` to the
public service (above: made with it, or step 7 once the service serves the
release). A running public service also moves to another domain, or answers at
other names for it, at once, with no release, by its owner's own action:
`moveDomain(adapter, record, needs, { domain, aliases })` (`domain.js`, `aliases`
none when left out) is refused `production_deploy_item_unknown` (404) when the
record holds no item for the Stack's public service,
`production_deploy_domain_move_unsupported` (409) by an adapter without
`takeDomain()` (Google Cloud's, AWS's), and `production_deploy_aliases_invalid`
(422) for names as a Deploy refuses them, before the provider is asked anything;
then the adapter's `ensureDomain()` for the domain and each name (the provider
project's domain covering it, added when none does) and `takeDomain(id, domain,
{ take: false, aliases })`, the same call step 7 makes, each under an
idempotency key of its own each time. The names reach the app's
`APP_REDIRECT_HOSTS` at the next Deploy. It
answers `{ service, domain }` and leaves the record unchanged. Never with
`take`: a name another App Service, a machine or a group of the project answers at
stays theirs, and mobilynet refuses it `409 name_taken`. On mobilynet the
service's routes become the names asked for alone, with no refresh; a name no
longer asked for keeps its route, sending to nothing, with its DNS target, and
a move back takes it again.

## The mobilynet adapter

`createMobilynetAdapter()` answers the engine in mobilynet's calls for one
mobilynet project and region: its offer (App Service instance sizes with their
list prices, the load balancer's, each resource kind's hosted app and sizes),
its inventory of App Services and hosted services with their labels, each
hosted service Vibe64 made with the links mobilynet holds of it (one `GET
/v1/hosted-services/{id}/links`, `hosted:read`, per such hosted service at
each read), the calls the steps make, and, from its region in `GET
/v1/regions` (any key), the edge's addresses an app trusts (`trustedProxies()`)
and how many settings and secrets an App Service there holds now
(`serviceSettingsMax()`). The stand-in's regions say 199 each, and 49 for a
region with a host while its `olderHost` fault is on, which its settings
replace enforces too. mobilynet calls the engine's labels **tags**: a create or
a change of an App Service or a hosted service sends them as `tags`, the
inventory reads each thing's `tags` as its labels, and a list asks for
`tag=name:value`. mobilynet refuses their previous name, `labels` in a body or
`label=` in a query, `422 validation_failed` under that name, and so does the
stand-in. A release by version brings settings, secrets and names to remove
as mobilynet main c3575399 does, and the stand-in answers it alike: a name a
link sets refused, checked at the call against the release while no other
refresh of the service is open, merged into the service's settings as its
refresh starts, the service's own only once that refresh succeeded, the same
Idempotency-Key answering again, and `services:manage` needed beside
`services:deploy`. mobilynet has no leases yet: an
adapter made without `leases: true` takes none, which is safe only while one
editor deploys an environment. mobilynet runs a release's task (main
`17340a6a`, its `docs/stages/release-tasks.md`), and the stand-in answers it as
mobilynet does: a declaration's `tasks` is `{ <name>: { command } }`, at most
10, a name of a lowercase letter then up to 39 lowercase letters, digits and
hyphens, a command as `start`'s, any other field refused; a create's `task`, a
release upload's `?task=` or a release by version's `task` names one (a
malformed name is `422` under `task`),
which that refresh runs once, after `build_passed` and before any instance, on
an instance of its own (rotation `task`: never in rotation, none of the
service's instances, listed with the removed ones once it ended) of what the
refresh moves to (release, settings, secrets and links' settings). A name the
release doesn't declare fails the refresh `release_task_not_declared` once it
built. The steps are `task_started` (its instance) at one pass, then
`task_succeeded` (its instance), or `task_failed` with the refresh failed
`release_task_failed`, `details: { task, instanceId, outcome }` (`failed`,
`timeout` or `machine_failed`) and a message naming the logs that hold its
output, nothing rolled out. The refresh's `task` is the name it was asked for,
or null, beside `held` (false). mobilynet gives no exit code or output: the
adapter's `readRefresh` reads the task from the steps and error as `task: {
name, state, instanceId, outcome }` (`asked`, `running`, `succeeded` or
`failed`), and its output is its instance's logs. Its instance is removed as
soon as it ends, its logs kept 2 days. The stand-in's `releaseTaskFails` fault
fails it (`true`, or `{ outcome, output }`, the lines its logs then hold), and
`services.taskInstances(id)` shows a service's task instances to a test.

The domain is a route's at mobilynet, as its stable domain target change
(designed 20 Nov, being built; the stand-in answers it already) makes it: a
route is its name's, and its `target`, the CNAME the owner adds once, is its
own region-free name (`rte-<id>.routes.<apps domain>`) whatever it sends to. An
App Service deleted, or no longer asking for the name, leaves the route kept,
sending to nothing (`waitingFor` `target`; mobilynet's offline edges answer the
name with a 503 page and keep its certificate renewing), and the next public
service asking for the name takes it, so a Deploy after Take offline answers at
the same name and DNS target. A name another App Service's route sends to is
refused `409 name_taken` with `{ host, routeId }` unless the service's route
entry says `take: true`, which moves it in one call; the routes API makes,
moves (`PATCH`, its id, name and target kept) or deletes any route. The adapter
lists each App Service's route names (`hosts`), makes a public service routed
at the domain and its other names (`aliases`), or with no route while `domain`
is null, and answers `takeDomain(id, domain, { take, aliases })` (one `PATCH
/v1/services/{id}` of its `routes`, the domain's and each other name's, each
with `take` where asked) and `domainRecords(domain)` in
the other adapters' shape, with `live`, `waitingFor` and `target`: mobilynet's
TXT (and a wildcard's challenge CNAME) while the domain is unverified, and the
CNAME of the name to its route's own name while it has a route, Offline too.
`target` is null where the route's target is not its own name (`rte-…`): a
mobilynet before that change answers its App Service's `svc-` name, which
changes with the service, so nothing tells an owner that it stays.

Its client also reads what mobilynet did, for a caller that shows it: a
refresh with its steps (`readServiceRefresh`: build started, passed or failed,
the release task started, succeeded or failed, each instance started, healthy,
joined or never healthy), a page of a service's logs (`readServiceLogs`, `GET
/v1/services/{id}/logs`, `services:read`, mobilynet main `17340a6a`) and a
build's own log. A logs page is its instances' lines merged in time order, of
every instance live or removed in the last 2 days (a release task's among
them), `only` those named or all `except` those (by name or id,
comma-separated; one it has no logs of is `422` naming it), the newest `lines`
(200, at most 1000) before `until` or a `before` cursor, or the oldest after an
`after` cursor, `unit` one service alone, `since` and `text` narrowing it. It
answers `{ instances, units, lines, before, after, more, readAt, operations }`
as mobilynet gives it: `202` with `lines` null while the reads from the
instances' hosts run, then `200` with each line `{ at, instance, name, unit,
text, error }` (`unit` the service, or `start` for a release task's, `error`
whether it reads as one), each secret's value masked as `[secret]`; a first
page is kept 30 seconds. The client refuses an option mobilynet's logs don't
take (`instance`, the shape before), naming `only`. And a build's own log
(`readBuildLog`, `GET /v1/builds/{id}/log`: `{ text, next, state, done }` from
byte `after`), which needs `vps:read` or `packages:publish`, scopes a key
holding only the engine's lacks. The stand-in answers each, an instance's
output as a test sets it (`services.setLogs`), its reads ending at the next
`advance()` (`standIn/serviceLogs.js`: STAND-IN ONLY, a line's time is when it
was first read or given, and a line is an error by its words alone), and a
build's own lines; its
`releaseBuildFails` fault, given `{ code, message }`, fails a build with that
reason, which the refresh names too, as mobilynet named a build whose output
passed its limit.

A build itself is read with `services:read` for an App Service's (`readBuild`,
`GET /v1/builds/{id}`, null when mobilynet has none by that id): its state
(`queued`, `building`, `succeeded`, `failed`), a queued one's `waiting` (`{
for, words, ahead, latestAt? }`, what it waits for in mobilynet's own words:
its project's earlier build, a build server holding its base, a free build
server, a retry, or being sent within seconds) and its `estimate` (`{
startsBy, endsBy, limitAt, words }`), which a host's Deploy log shows while a
refresh waits for it. A refresh's `build_started` step is its start, the build
asked for: the build may then wait before it runs. `endBuild` (`POST
/v1/builds/{id}/actions/end`, `services:deploy`) ends a queued build at once
(failed `cancelled`) and a running one when its host stops it; one that ended
is `409 invalid_state`. `abortServiceRefresh` (`POST
/v1/services/{id}/refreshes/{rid}/actions/abort`, `services:deploy`) ends a
queued refresh at once and makes one building or rolling `aborting`, which
mobilynet's next pass ends `aborted`, its new instances drained and the version
before kept; one that ended is `409 refresh_not_running`. The adapter's
`refreshProgress()` and `stopRefresh()` use them to stop a Deploy (Stopping a
Deploy); a build mobilynet refuses to end leaves the refresh aborted all the
same, which the stop says. A refresh onto a release whose build failed builds
it again as it starts, as mobilynet's does (the stand-in, one whose build was
ended). The
stand-in answers each, and its `buildsWait` fault keeps a release's new build
`queued` with `waiting` words (its project's other build first, or the words,
`latestAt` and `startsBy` given) until it is off.

The client connects through its own dispatcher (undici's `Agent` and `fetch`,
unless a test gives its stand-in's fetch), whose lookup leaves out each of
mobilynet's addresses this machine has no route to, found as getaddrinfo finds
it (a UDP socket connected to the address is refused at once), and keeps them
all when it reaches none. Node tries a host's addresses in turn, giving up on
one still connecting after its attempt time (500 ms) and trying the next, so a
request of an editor too busy to see its connection in time went on to the
address it can't reach and failed at undici's connect timeout (10 s): on 23
Nov an editor on a machine with no IPv6 route said "mobilynet did not
answer: fetch failed" six times in 20 minutes of a Deploy, each read answered
at once when tried again. A failure names the connection's error ("fetch
failed (UND_ERR_CONNECT_TIMEOUT)").

For an owner looking at what a Deploy made, the adapter also reads a
resource's links (`listLinks`, each link's consumer and its connection's
plain fields: host, port, database, user, never a secret field) and its
backups (`backupsOf`, from `readHostedBackups`,
`GET /v1/hosted-services/{id}/backups`, `hosted:read`): the point-in-time
window its app's backups reach (`from`, `to`, null while it reaches the newest
point, `latest`), their failure while it lasts, and its machine's disk backups,
each with when it was taken and until when it can be restored, newest first.
`bindingField(kind, semantic)` (`declaration.js`) names the link field each
binding of a resource is given, or null for a URL made of several (the
password with them) and a bucket's `driver`. The stand-in answers a fresh
hosted service's backups as on with nothing restorable yet, and as a test sets
them (`hosted.setBackups`).

## The Google Cloud adapter

`createGoogleAdapter()` answers the engine in Google Cloud's REST calls for one
Google Cloud project and region. Its client takes `{ baseUrl, credential }`:
with no `baseUrl` it calls each API at its own `googleapis.com` host, the
person's own project reached with their access token; with one, every API is
under that address, the same calls through a gateway in front of Google. The
credential is a token, or a source whose `token()` gives the token now and
`refresh()` a new one after Google refused the last.

- **Services.** A service runs on Cloud Run with its CPU always allocated and
  a fixed count of instances: a public one takes requests only from the
  external Application Load Balancer, an internal one only from the project's
  network, at its own `https` address (the inventory's `internalUrl`). A
  service with a sandbox allowance, or reached at each instance, is offered
  the machine types of `machineSizes` instead and runs as a regional managed
  instance group of Compute Engine machines: an instance template from the
  release's image, the service's own service account and network tag, and a
  startup script that runs the image with Docker on Container-Optimized OS,
  with the flags its sandbox needs (user namespaces, `/dev/fuse`), its
  settings, and the instance facts (`V64_INSTANCE_ID`, `V64_PRIVATE_ADDRESS`,
  `V64_WORK_DIR` and, reached at each instance, `V64_INSTANCE_URL`, the
  machine's internal DNS name). A public group stands behind the same load
  balancer; an internal one behind an internal passthrough load balancer whose
  DNS name the services reaching it are given. A Cloud Run service's count is
  its own scaling, not its template's, so a count change makes no revision; a
  group's is its size. A machine leaving a group gets 30 seconds to finish the
  requests it has (connection draining on its backend service; Google's
  default is none), and Cloud Run drains its own. A new release, setting or
  machine type is a new template, and the group replaces its machines, the new
  ones first. A service can't move between Cloud Run and machines in place:
  take the app offline, then deploy to production. A rollout is the refresh the steps wait
  for: its id is the release it moves to, and it is `rolling` from the start,
  as Cloud Build built the image before it began, so a service is linked to its
  resources while it rolls (their credentials are in its settings already).
- **Reaches.** A firewall rule opens the reached machines' port to the
  reaching service: to its machines' tag, or, from Cloud Run, to the subnet
  Cloud Run's Direct VPC egress leaves from, as that traffic carries no tag an
  ingress rule matches, so such a rule lets every Cloud Run service of the
  network in. An internal Cloud Run service takes no rule: its internal ingress
  admits the whole network.
- **Resources.** `postgresql` and `mysql` are Cloud SQL (PostgreSQL 16, MySQL
  8.4, Enterprise edition) on a private address of the shared network, with
  backups and deletion protection; Google Cloud runs no MariaDB, so the Plan
  names MySQL itself. Every service shares one login of a database, so each can
  use the tables another migrated. A `bucket` is Cloud Storage, private, reached
  through its S3-compatible API with an HMAC key of each service's own
  account. `redis` is refused in the Plan with Google's reason (Memorystore for
  Valkey comes later). A resource's settings reach a service when it is made or
  handed a release (the release's declaration, kept beside its source, names
  what it needs), so its first instances start with them.
- **Secrets, logs and the domain.** Secret settings and credentials are Secret
  Manager's, read only by the service's account; logs go to Cloud Logging. The
  domain is a Certificate Manager certificate with a DNS authorisation, on the
  load balancer's address; `domainRecords()` gives the records the owner adds.
- **Images.** Cloud Build builds each service's image from its upload (the
  Containerfile `imageUpload()` adds) into Artifact Registry, once per upload;
  while a build runs, the step asks again at the next one, and a failed build
  fails the Deploy with Cloud Build's reason and log.
- **Labels.** Everything a deployment makes carries Vibe64's labels where
  Google keeps them (Cloud Run services, instance templates, Cloud SQL
  instances, buckets, secrets). Google's label values take no `.`, so the item
  label is written `<kind>_<name>` and read back the same. A resource name
  another deployment or another Google customer holds is refused, never
  adopted. What every deployment of the project shares (the network, its NAT,
  the private services connection, the registry, the build bucket) is made
  once and never deleted by a step.
- **Prices.** The offer reads Google's list prices from the Cloud Billing
  Catalog in US dollars for the region, and refuses to price at all when a SKU
  it needs is missing. The load balancer's line is the forwarding rules'
  minimum; an internal group's load balancer and Cloud Storage's use are not in
  the Plan's price.

Cloud Run takes at most 1000 environment variables per container, each up to
32 KB, and refuses the names its container contract sets (`PORT`, `K_SERVICE`,
`K_REVISION`, `K_CONFIGURATION`) and any starting `X_GOOGLE_`, as its
documentation says (read 19 Nov 2026). The engine checks none of these yet, and
Production's own `PORT` is among a Cloud Run service's settings: unproven
against Google, since the stand-in takes it.

Google Cloud has no leases: the adapter takes none, safe only while one editor
deploys an environment. Its stand-in (`standIn.js`) answers every call the
adapter makes in Google's shapes, in memory, for the engine's tests.

## The AWS adapter

`createAwsAdapter()` answers the engine in AWS's calls for one deployment (the
record's `deploymentId`, app and environment) in one region of one AWS account.
Its client takes `{ region, credential }`: the person's own access key (or a
source of short-lived ones), each request signed in the client with Signature
Version 4; or a gateway's https address and a short-lived token, each request
sent to `<gateway>/<signing name>/<region>/<AWS host><path>` with the token and
no signature, the gateway signing it. A credential AWS calls expired is
refreshed once.

- **Names and tags.** Everything is named `v64-<the deployment id's last
  eight>-<part>`, so no two deployments' things meet, and carries Vibe64's tags
  (the item's, or `base.<part>` for what the deployment's services share). The
  inventory reads only what carries this deployment's tags; every call that
  changes a thing reads it first and refuses one found under its name that
  isn't tagged as this deployment's (`aws_not_ours`), as it refuses a bucket
  name another AWS account holds.
- **Network.** The deployment's own VPC with two subnets in two zones, an
  internet gateway, a free S3 gateway endpoint and interface endpoints for ECR,
  and no NAT gateway: each task and machine has a public address of its own for
  its way out, and its security group lets in only the load balancer and the
  services that reach it.
- **Services.** A service runs on Fargate as an ECS service in the
  deployment's cluster: a public one behind the deployment's Application Load
  Balancer, an internal one in the deployment's private names (Cloud Map), at
  `<service>.<names domain>`. A service with a sandbox allowance, or reached at
  each instance, is offered `machineSizes` instead and runs on whole machines
  of its own, an EC2 Auto Scaling group from a launch template on Amazon Linux:
  its user data (`machine.sh`) runs the image with Docker, privileged for the
  sandbox on a machine that is the service's alone, with its settings, each
  secret read from Secrets Manager at its version, and the instance facts
  (`V64_INSTANCE_URL` is the machine's private address); a second container,
  restarted by Docker, keeps the machine in the private names while the service
  runs. A machine tells Auto Scaling it is ready only once the service answers
  its health path. A release is a new task definition revision, which ECS rolls
  out and rolls back by its circuit breaker, or a new template version, which an
  instance refresh rolls in, the new machines ready before the old go; a count
  changes in place. A task or machine leaving the load balancer drains for its
  target group's deregistration delay, AWS's default of 300 seconds. A rollout
  is the refresh the steps wait for: its id (the create, release or change and
  the revision or version it moves to) is kept as the service's
  `vibe64-refresh` tag, and it is `rolling` from the start, as CodeBuild built
  the image before it began, so a service is linked to its resources while it
  rolls (their settings are in what it runs already). What a service runs
  (its image, settings and where each secret is) is kept in the releases
  bucket under its SHA-256, which the task definition's label and the
  template's user data name: a machine reads it as it starts and runs nothing
  if it isn't the one named. So neither grows with the settings, and a service
  takes as many as AWS does: AWS counts none, its limits being 64 KB of task
  definition (the settings once) and 64 KB for the secret that holds a
  service's secret settings; a machine's user data (16 KB at AWS) holds only
  the script and that place.
- **Reaches.** A security group rule opens the reached service's port to the
  reaching service's group; each database's group lets in the services linked
  to it.
- **Resources.** `postgresql` is RDS for PostgreSQL and `mysql` RDS for MariaDB
  (a standby copy is Multi-AZ), private, encrypted, backed up for 7 days, its
  login kept by RDS in Secrets Manager; deleting one takes a final snapshot. A
  `bucket` is private S3 with an IAM user whose key reaches that bucket alone,
  kept in Secrets Manager; a bucket that still holds files is not deleted.
  `redis` is refused in the Plan with its reason.
- **Images.** CodeBuild builds each service's upload (the Containerfile
  `imageUpload()` adds) into the deployment's ECR, tagged with the upload's
  SHA-256, so the same upload is never built twice; while it builds, the step
  asks again at the next one, and a failed build fails the Deploy with its phase
  and reason.
- **Domain.** An ACM certificate validated by DNS on the load balancer, port 80
  redirecting to 443. Each Deploy waits up to 15 minutes for AWS to issue it,
  then fails naming the two records the owner adds (the validation record and
  the domain at the load balancer), which `domainRecords()` also gives.
- **Prices.** The offer reads AWS's list prices from the Price List API in US
  dollars for the region: Fargate per vCPU-hour and GB-hour, machines per hour
  with their 40 GiB root disk, a public IPv4 address for each, databases with
  their first 20 GiB, the load balancer by the hour. A price it needs that the
  Price List lacks refuses the offer, naming it.

A service's settings travel in its spec in the releases bucket, not in its task
definition or its machines' user data, so neither ECS's nor EC2's size limits
bound them; no limit on their count or names is known, and none is checked.

AWS has no leases: the adapter takes none, safe only while one editor deploys an
environment. Its stand-in (`standIn.js` and `standIn/`) answers every call the
adapter makes in AWS's three protocols and shapes, in memory, checking each
request's signature (or the gateway's token), for the engine's tests.

## Implementation map

- `needsOfStack()` — the needs from the inspected Stack.
- `servicePackages()` — one mobilynet declaration per service and the scripts.
- `imagePackages()`, `imageUpload()` — the image per service, for container providers.
- `planOf()` — the Plan with verbs, drift, the quote, the quotas and its hash.
- `deploy()` — a whole Deploy, step by step, under the lease, stopped where `deployStopOf()` allows when asked.
- `takeOffline()`, `deleteResource()` — Take Production offline and Delete (`offline.js`).
- `domainStep()`, `addressChange()` — the domain routed to the public service, and its DNS target told once.
- `aliasesProblem()` — why the domain's other names can't be routed and given to the app, or "".
- `setInstances()` — how many instances a running App Service runs, set at its provider at once.
- `createMobilynetAdapter()` — the provider's side of the plan and steps.
- `createGoogleAdapter()` — the same for Google Cloud; `createGoogleClient()` its REST client.
- `createAwsAdapter()` — the same for AWS; `createAwsClient()` its client.
