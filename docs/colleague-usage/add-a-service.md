# Add a service to a project

**Add a service** adds a database, Redis, a files bucket or another App Service to
a project. You choose a session and what to add. Vibe64 writes the declaration into
that session's `genesis/stack.md`, then the AI connects your app to it in the same
session. Nothing is saved: review the work and **Save** it as usual.

The dialog opens from the page where your editor offers **Add a service**, such as
the host's **Deploy** page, where you publish to staging and deploy to production.
There, Colleague can show you the **Add a service** button and explain these
steps, but it can't press **Add** for you.

## Choose the session

**Adds it in session** lists your open sessions and starts with the one you used
last. Add changes only that session's files.

With no session open, the dialog says **Open a session first** and offers
**Open a session**.

## Choose what to add

Each row is one kind:

| Row | What it is |
| --- | --- |
| **PostgreSQL database** | A PostgreSQL database for the app |
| **MySQL database** | A MySQL database for the app |
| **Redis** | Redis, for live updates and short-lived shared state |
| **Files bucket** | S3-compatible storage for the app's files |
| **Another App Service** | Another process of the app, such as a worker, that runs beside it |

Under each row:

- **The app gets** names the Env variables the app reads, such as
  `DB_HOST, DB_NAME, DB_PASSWORD, DB_PORT, DB_USER (or DATABASE_URL)` for a JSKIT
  app's PostgreSQL. These come from the Stack component that fits your project.
- **Preview** says what Preview uses:
  - A database or Redis comes from Vibe64 when your host provides one. Otherwise
    it is your own server, from the values you enter in [Env](development-env.md).
  - A files bucket uses the app's own storage until you enter the bucket's
    settings in Env.
  - Another App Service runs in Preview only if the AI also declares it for
    Preview.
- **Production** appears when your host shows what the service costs there.

A row you can't choose is greyed out and says why:

- **Already added: database (postgresql)**. The Stack already declares one.
- **A project has one database: this one has database (mysql)**. A project uses
  one database, so the other database rows are off once one is declared.
- A name the Stack already uses for another kind of resource. The reason says
  which name to change in `## Resources`.
- A Stack component that conflicts with one the project selects.
- For **Another App Service**: a Deployment that doesn't parse (the reason
  quotes the problem), a project with no `## Deployment` yet, or one that already
  has 8 services.
- Your host may add its own reason.

**Vibe64 has no ready entry for this stack: the AI declares it** means no Stack
component matches your framework and this kind (for example Redis in a Laravel
app). The row still works: the AI writes the declaration itself, naming the Env
variables your app reads.

A files bucket also says that `genesis verify` reports the project blocked until
the bucket's settings are in Env. Genesis counts every declared resource as
required, a bucket too. Preview still runs with the app's own storage.

### Another App Service

Choosing **Another App Service** shows two fields:

- **Service name**: lowercase letters, digits and dashes, starting with a letter,
  up to 16 characters, such as `worker`. A name the Deployment already has is
  refused.
- **Reached by**: the service that talks to the new one, at first the public
  one (`web`). Choose **Nothing: it works on its own** for a worker that no other
  service calls.

The new service is internal: it has no public address of its own.

## Add

Choose **Add PostgreSQL database** (the button names your choice). It reads
**Adding PostgreSQL database…** while Vibe64 works.

- With a ready Stack component, Vibe64 adds it through Genesis's own
  `genesis stack add`. The component line and its `json genesis-resource` block
  go into `genesis/stack.md`, beside any resources the project already declares.
  The dialog then says, for example, **Added `database` (postgresql) to
  genesis/stack.md in Checkout. Next: the AI connects your app to it.**
- Without one, and for another App Service, Vibe64 writes nothing itself. The
  dialog says, for example, **The AI declares Redis in genesis/stack.md in
  Checkout, then connects your app to it.**

Add is refused, and nothing changes, while that session is busy: the session's AI
is working, an AI task is running (**Fix Update is still running. Wait for it to
finish first.**), or workspace preparation is running. Wait, then add it again.

## What the AI does

The [AI task window](ai-tasks.md) opens an **Add a service** task in the chosen
session. Its two steps are **The AI connects the app to the service** and
**Vibe64 prepares the workspace and restarts Preview**.

For a database, Redis or bucket, the AI:

- uses the framework's own client, and for a database its own migrations, with
  an idempotent seed;
- declares any preparation in `## Workspace setup` and the Deployment, using
  only commands the app already has;
- never changes the resource's declaration, and never writes a value of it into
  a file;
- never commits, pushes or saves.

When it reports it has finished, Vibe64 checks the work:

1. `genesis/stack.md` declares the resource.
2. Workspace preparation runs and succeeds.
3. Preview, if it is running, restarts on what was prepared and becomes ready.

A failure goes back to the same conversation with its reason, such as the
migration's error, up to three times. The task ends **Done** when every check
passes. If Preview isn't running, the task still ends **Done**, and the app uses
the service the next time Preview starts.

For another App Service, the AI adds a `### Service` entry to `## Deployment`,
with its Serve command and Ready check taken from the app's own code. On the
service that reaches it, it adds a `- Reaches:` line. Vibe64's check reads the
Deployment back: it must parse and declare the new service.

## Remove a service

There is no **Remove** button. Ask the AI in the session to remove the
declaration from `genesis/stack.md` and the app's use of it, then Save.
Removing a declaration deletes no data by itself: Vibe64 removes nothing when
the declaration goes, and your own servers are untouched.
