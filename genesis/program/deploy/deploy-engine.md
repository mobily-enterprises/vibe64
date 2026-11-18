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
need for every resource, and the settings that service is given
(`settingsPerService`): Production's own and the generated secrets every
service, the setup code the public one, each Reaches setting the service that
reaches, and each Production Env entry the services it names (the public one
when it names none), at most 100 per service, mobilynet's own limit.

Each serve script exports the settings mobilynet gave the instance, the
resources' bound names, the instance facts, the service's own Setting lines,
then Serve's defaults, migrates and serves. The instance facts come from the
`_mobilynet` object mobilynet puts in each instance's settings:
`V64_INSTANCE_ID` (its hostname), `V64_PRIVATE_ADDRESS`, `V64_WORK_DIR` and,
for a service reached at each instance, `V64_INSTANCE_URL`. An instance without
`_mobilynet` gets none, and a service reached at each instance then stops,
naming why. mobilynet leaves an app's settings to its `start` step, as root, in
`/run/mobilynet/apps/<app>/settings.json`; `start` copies them for the
service's login to `/run/app-settings/<app>/settings.json` (mode `0400`), which
the serve script reads.

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
the owner confirmed (`deployment_plan_stale`) or whose plan has problems, takes
the lease `deploy:<deployment id>` for 600 seconds where the adapter takes
leases (refused `deployment_lease_held`, naming the holder and since when),
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
3. the domain is added to the provider project when none covers it;
4. each internal service, then the public one: its release uploaded, its App
   Service made (labelled, internal ones with no routes, the public one routed
   at the domain with a connection to each service it reaches) or handed the
   release, linked to every resource once that refresh is building, then the
   refresh waited for. mobilynet checks a link against the release a service
   runs or, when that names no such need, the release its refresh in progress
   (building or rolling) moves it to, and that refresh's instances start with
   the link's settings; so a new service's first instances, and a release
   naming a new resource, start with their resources, and linked while the
   build runs, no instance restarts. A link asked while that release isn't read
   yet is refused with a `422` the client marks to try again, and the next step
   asks again. A refresh that fails ends the links made against it, which the
   record lets go so the next Deploy makes them again, and fails the Deploy
   with the service's reason; services not yet moved keep serving their version.
   The record keeps, with each service, the release it was last handed: its
   upload's SHA-256 and its declaration (`releaseDigest`) and the version. A
   service still running that version with no error, for the same upload, keeps
   it and is handed no release, since a provider refreshes onto every release it
   is handed, even the one it runs; so a Deploy that changes only a count or a
   size replaces no instance for nothing. One whose release failed, or whose
   record was made again from labels, is handed its release again;
5. a resource the Stack no longer names is unlinked from the services that
   stay and kept with its data;
6. each service's settings (`settingValues`: Production's own, each Reaches
   setting the reached service's private address, the Production Env's values
   for the names it declares), the services it reaches, its size and count,
   only once every move ended: mobilynet refuses a settings replace while a
   link made ahead of an open refresh stands;
7. a service the Stack no longer names is deleted;
8. live, once every service runs its release on as many healthy instances as
   chosen and its last refresh (a link's or a change's) did not fail.

A refusal from the provider (a quota, the spending cap) fails the Deploy with
its reason, the record kept as far as it got; an answer the provider may give
later is tried again. That holds for the provider read at the top of each step
too: a read that got no answer, a 5xx or the provider's rate limit (as a Deploy
waiting minutes for a build may meet) is tried again at the next step, so the
run lives until it is live or failed; before, one such read ended the run with
its record still deploying. A Deploy never deletes or makes again a hosted service
and never acts on a thing the record does not hold. `takeOffline()` deletes the
services, public first, and keeps every resource: it keeps the record without
them (`save`) once each delete is asked, then reads the provider again
(`pause` between reads, 5 seconds unless given) until it lists none of them,
and returns. A provider still removing some after `maxReads` reads (120 unless
given) is refused `deployment_offline_unfinished`, naming them; they take no
new requests by then, and the provider finishes by itself. `deleteResource()`
deletes a disconnected resource and its data only when the owner typed its
name.

Both say what they do as they do it, through the caller's `report(event)`:
each step as it starts and ends (`{ kind: "step", phase: "start" | "done" |
"refused", step, words, service?, resource?, refresh? }`) in the engine's own
words (`stepWords`: "Making the hosted service for database", "Uploading the
release of web", "Making App Service web, public behind the load balancer at
app.example.com", "Linking web to database", "Reading how the update of web
ended", "Deleting App Service web"), each wait when its words change, each call
tried again (`{ kind: "retry", words, message }`), each service gone at Take
offline and the end (`{ kind: "end", outcome }`). A step that starts a refresh,
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
behind the move. Until mobilynet runs M14, mobilynet links only against the
release a service runs, and the first Deploy of an application whose serve
script needs its database there fails.

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

Its client also reads what mobilynet did, for a caller that shows it: a
refresh with its steps (`readServiceRefresh`: build started, passed or failed,
each instance started, healthy, joined or never healthy) and an instance's logs
(`readServiceLogs`, `GET /v1/services/{id}/logs`, `services:read`): read by an
operation, `logs` null with `202` until it ends, then the lines, each of the
service's secrets masked as `[secret]`. The stand-in answers both, an
instance's output as a test sets it (`services.setLogs`), its reads ending at
the next `advance()` (`standIn/serviceLogs.js`). A build's own log
(`GET /v1/builds/{id}/log`) needs `vps:read` or `packages:publish`, which a key
holding the engine's scopes lacks.

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
  take the app offline, then deploy. A rollout is the refresh the steps wait
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

AWS has no leases: the adapter takes none, safe only while one editor deploys an
environment. Its stand-in (`standIn.js` and `standIn/`) answers every call the
adapter makes in AWS's three protocols and shapes, in memory, checking each
request's signature (or the gateway's token), for the engine's tests.

## Implementation map

- `needsOfStack()` — the needs from the inspected Stack.
- `servicePackages()` — one mobilynet declaration per service and the scripts.
- `imagePackages()`, `imageUpload()` — the image per service, for container providers.
- `planOf()` — the Plan with verbs, drift, the quote, the quotas and its hash.
- `deploy()` — a whole Deploy, step by step, under the lease.
- `createMobilynetAdapter()` — the provider's side of the plan and steps.
- `createGoogleAdapter()` — the same for Google Cloud; `createGoogleClient()` its REST client.
- `createAwsAdapter()` — the same for AWS; `createAwsClient()` its client.
