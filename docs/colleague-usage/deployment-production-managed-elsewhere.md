# Production managed somewhere else

Some apps are not deployed to production from Vibe64: their own release
tooling, another console or a team's pipeline does it. One line in the
`## Deployment` section of the project's `genesis/stack.md` says so. Vibe64
then never deploys that app to production, and a host's **Deploy** page sends
people to the place that does.

## The line

The line names who manages Production and the address where it is deployed:

```markdown
## Deployment

- Production: managed by `Example Console` at `https://console.example.com/deployments`
```

It can stand alone, as above, or sit beside the steps that publish the app to
staging:

```markdown
## Deployment

- Runtimes: `nodejs`
- Production: managed by `Example Console` at `https://console.example.com/deployments`
- Prepare `Install`: `npm` `ci`
- Serve `Start`: `node` `server.js`
- Ready when: `GET` `/health` returns `200`
```

- The name is what people know the place by: 1 to 60 letters, digits, single
  spaces and `. & ' + ( ) _ -`, starting with a letter or digit.
- The address starts with `https://` and has no user name or password in it.
  It is shown and linked exactly as written.
- The line belongs to the whole Deployment, above any `### Service` heading. A
  service's own `- Production: \`2\` instances` line is something else: how many
  instances Production starts that service with.
- The line is the only place the name and address are kept. Change them in
  `genesis/stack.md` and **Save**; the Deploy page shows the new ones at its
  next read.

## Who writes it

The line is part of the project's source. In a session, ask the coding agent,
for example "Production of this app is deployed from Example Console at
https://console.example.com/deployments: say so in the Stack". The agent reads
the exact rules with `vibe64-helper spec deployment`. Review the change and
**Save** the session as usual.

Colleague can explain the line, what it changes and what a refusal means; the
line itself is written in a session.

## What changes

| Where | What happens |
| --- | --- |
| A host's Deploy page, Production card | It says "Production is managed by Example Console", shows the address, and offers **Open Example Console**, which opens the address in a new tab. It shows no **Deploy to production** button, no plan and no Production Env. |
| Deploy to production | Refused before anything is sent: "genesis/stack.md says Example Console manages this app's Production, at https://console.example.com/deployments, so Vibe64 doesn't deploy it to production…". |
| Publish to staging | Unchanged. With steps, the app publishes to staging as before; with the line alone, there is nothing to publish, as with `- Nothing.`. |
| Development and Preview | Unchanged. |

If Vibe64 deployed the app to production before, take that Production offline
on the Production card first: once the line is saved, the card shows only the
link.

## To deploy from Vibe64 again

Remove the line in a session, **Save**, then use **Deploy to production** on
the Deploy page.

## When the line is refused

A line Vibe64 can't read is refused with its line number in the section and
the fix, and the Deploy page shows that refusal:

- "Deployment Production says who deploys Production instead of a host, such
  as …": write the line as `- Production: managed by \`name\` at \`https://…\``.
  A service's instance count goes under its `### Service` heading.
- "Deployment Production names who manages it in 1 to 60 letters…": shorten the
  name, or remove characters such as `<`, `/` or a double space.
- "Deployment Production gives the https address where Production is managed…":
  use an `https://` address without a user name, password or spaces.
- "Duplicate Deployment Production.": keep one line.
- "Service `web`: who manages Production is the whole Deployment's…": move the
  line above the first `### Service` heading.
