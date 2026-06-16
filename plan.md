# Vibe64 Publishing Plan

## Goal

Add a project-level publish system that lets users publish durable, public versions
of their apps while reusing Vibe64's existing adapter, runtime container, database,
terminal, and proxy foundations.

Publishing is not a session launch target:

- A launch target is temporary and session-owned.
- A published app is durable, project-owned, supervised, and publicly routed.

## Default Public URL

Use a first-come, first-served public namespace:

```text
<public-name>.users.vibe64.dev
```

Examples:

```text
beepollen.users.vibe64.dev
dogandgroom.users.vibe64.dev
```

Rules:

- `public-name` is globally unique.
- Users choose it at publish time.
- It is the default Vibe64-hosted public URL.
- It is separate from the internal project slug.
- It can be changed explicitly, but changing it changes the public URL.
- Names are reserved while attached to a published app.
- Valid names are lowercase letters, numbers, and hyphens only.
- Names cannot start or end with a hyphen.

This keeps infrastructure simple:

```text
*.users.vibe64.dev -> Vibe64 ingress
```

The default namespace can use one wildcard DNS record and one wildcard TLS
certificate.

## Reserved Public Names

Vibe64 must block names that could imply official Vibe64 ownership,
authentication, billing, support, infrastructure, or security.

Initial exact reserved names:

```text
admin
api
app
auth
billing
blog
cdn
console
dashboard
docs
help
home
login
logout
mail
manage
management
pay
payment
payments
pricing
root
security
signin
signup
status
studio
support
system
team
teams
user
users
vibe64
www
```

Also block official-looking patterns:

```text
vibe64-*
*-vibe64
openai-*
*-openai
admin-*
auth-*
billing-*
login-*
payment-*
security-*
support-*
```

Official services should live outside the user namespace:

```text
app.vibe64.com
billing.vibe64.com
docs.vibe64.com
status.vibe64.com
```

User apps live only under:

```text
*.users.vibe64.dev
```

This means users cannot create official-looking root domains such as
`billing.vibe64.com`, and they also cannot create misleading default app names
such as `billing.users.vibe64.dev` or `support-vibe64.users.vibe64.dev`.

## Ownership

Adapters own framework-specific publishing knowledge:

- build command
- migration command, if any
- serve command
- artifact shape
- health check
- required runtime services

Vibe64 owns deployment lifecycle:

- publish records
- release history
- status
- logs
- domain bindings
- routing
- rollback
- supervision

The front ingress owns public HTTP/HTTPS traffic and TLS.

## Adapter Publish Contract

Add an adapter-level publish contract, conceptually:

```js
adapter.createPublishPlan(context)
```

The returned plan describes:

```js
{
  build,
  migrate,
  serve,
  health,
  artifacts,
  runtimeServices
}
```

Examples:

- JSKIT: `npm run build`, `npm run db:migrate` if present, `npm run server`.
- Laravel: Composer/Vite build if needed, `php artisan migrate --force`, then a
  Laravel/PHP serve runtime.
- Static apps: build to static files, no migration, static server.
- Apps without databases: no migration step.

Vibe64 must not invent a generic migration system. It asks the adapter whether a
migration step exists and how to run it.

## Publish Flow

1. User clicks `Publish`.
2. User chooses or confirms `public-name`.
3. Vibe64 validates and reserves:

   ```text
   public-name.users.vibe64.dev
   ```

4. Vibe64 asks the adapter for a publish plan.
5. Vibe64 ensures required runtime services exist, such as the managed database
   container.
6. Vibe64 runs the build in a controlled container.
7. Vibe64 runs the adapter-provided migration step if required.
8. Vibe64 starts the new app release internally.
9. Vibe64 health-checks the release.
10. Vibe64 atomically switches routing to the new release.
11. The previous release remains available for rollback.

## Deployment State

Deployment state should live in project-local Vibe64 state:

```text
<project>/.vibe64-local/deployments/
  current.json
  public-name.json
  releases/
    <release-id>/
      manifest.json
      logs/
      artifact/
```

The deployment manifest records:

- project slug
- adapter id
- public name
- release id
- build command
- migrate command and result
- serve command
- runtime service bindings
- internal target endpoint
- health result
- published timestamp
- previous release id

## Routing

Public traffic goes through platform ingress:

```text
<public-name>.users.vibe64.dev
        |
        v
Vibe64 ingress / router
        |
        v
deployment binding lookup
        |
        v
internal app container/release
```

App containers should not bind public ports directly.

Routing lookup is by `Host`:

```text
Host: beepollen.users.vibe64.dev
      -> publicName=beepollen
      -> deployment current release
```

## HTTPS

For the default namespace:

```text
*.users.vibe64.dev
```

Use wildcard DNS and wildcard TLS. This avoids issuing a certificate for every
default app.

Custom domains use the same routing model, but each custom hostname needs its
own verification and certificate flow.

## Custom Domains

Custom domains are part of the publishing system, not a separate deployment
type. They are aliases to the same current release as the default Vibe64 URL:

```text
www.customer.com -> publicName.users.vibe64.dev -> deployment
```

Flow:

1. User adds a custom domain.
2. Vibe64 gives DNS instructions.
3. Vibe64 verifies ownership and DNS.
4. Vibe64 provisions a certificate.
5. Vibe64 routes the custom domain to the same deployment binding.

The custom-domain binding record should track:

- domain name
- project slug
- public name
- verification status
- required DNS records
- observed DNS records
- certificate status
- active release id
- last verification time
- last routing health check

For V0, support normal hostnames such as:

```text
www.customer.com
app.customer.com
demo.customer.com
```

Apex domains such as `customer.com` are useful, but they are operationally more
fragile because DNS providers handle apex flattening differently. V0 can support
apex domains only if the ingress and DNS instructions are explicit and tested.

Custom domains must not bypass the default public-name reservation. Every
published app still has a default:

```text
publicName.users.vibe64.dev
```

Custom domains are additional host bindings to that deployment.

## V0 Scope

Do first:

- first-come `public-name.users.vibe64.dev`
- reserved-name validation
- custom domain binding records
- DNS verification for custom domains
- certificate provisioning for verified custom domains
- publish button
- adapter publish contract
- JSKIT publish implementation
- build/migrate/start/health
- one current release per project
- release logs
- rollback to previous release
- wildcard default domain routing
- custom-domain routing to the same current release

Explicitly out of scope:

- multiple environments
- per-branch deploys
- per-release preview URLs
- team permission systems around publishing

Staging is not part of V0. It may be reconsidered much later, but it needs a
separate design because staging is not just a second URL. It raises database
copy/isolation, user access, whitelisting, routing, migration, and data-safety
questions.

## Key Principle

Publishing should be project-level and durable. Preview remains session-level and
temporary.

Both can reuse containers, environment generation, managed services, and proxy
mechanics, but they should not share the same lifecycle owner.
