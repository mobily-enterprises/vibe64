# Install tools once with a machine setup script

The `## Deployment` section of a project's `genesis/stack.md` can name a
**machine setup script**. A host that builds the machine your app runs on runs
the script there once, as root, before your Prepare step, and keeps what it
installs for every later build while the script stays the same. Tools it
installs are then downloaded once instead of at every deploy to production,
and they are no longer part of the app's build output.

Most apps need none: the runtime and `- Packages:` give them what they need.
Use a machine setup script for what those can't give, such as a pinned tool
downloaded by URL (a release archive, a vendor's program, a voice or model
file). A sign that you need one: a Prepare step that downloads tools into the
release makes the build output large, and every deploy fetches, stores and
copies them again.

## Who writes it

The script and its line are part of the project's source. In a session, ask
the coding agent in the session's chat, for example "Install our pinned tools
with a machine setup script instead of in Prepare". The agent reads the exact
rules with `vibe64-helper spec deployment`, writes the script and the line,
and points the app at the tools' new folder. Review the change and **Save** the
session as usual.

Colleague can explain the line and the rules below, and what a refusal means;
the script itself is written in a session.

## The line

One line, among the entries above any `### Service` heading, names the script
by its path from the project's root:

```markdown
## Deployment

- Runtimes: `nodejs`
- Packages: `gnutar` `xz`
- Machine setup: `deploy/machine-setup.sh`
- Prepare `Install`: `npm` `ci`
- Serve `Start`: `node` `server.js`
- Ready when: `GET` `/health` returns `200`
```

- The path is made of plain names (letters, digits and `. _ @ + -`, none
  starting with `-`) separated by `/`, never `.` or `..`.
- The file is committed in the saved work: a plain file, not a link or a
  folder, of 1 byte to 64 KiB of UTF-8 text.
- The line belongs to the whole Deployment, so every service gets it. Under a
  `### Service` heading it is refused with "Machine setup is the whole
  Deployment's: put it above the first ### heading."

## What the script can do

- It runs as root, once for each machine a host builds with it, before Prepare.
  It starts in `/` and runs with `bash -e` (it stops at the first failing
  command), unless its first line names another interpreter, such as
  `#!/usr/bin/env bash`.
- It has the internet and the app's packages on `PATH` (the runtime's, the
  Deployment's `- Packages:` and the service's own), and nothing else: no Env
  value, secret or `APP_ENV`, and no other file of the project. So put each
  download's URL and SHA-256 in the script's own text, and check each one.
- What it writes under `/opt`, `/usr` and `/etc` is kept read-only on every
  machine built with it. What it writes under `/tmp`, `/var/tmp`, `/home`,
  `/root`, `/run`, `/var/log` or `/srv` is dropped.
- Install into a folder of the app's own, such as `/opt/shop-tools`, with
  folders and programs every account can read and run: the app's steps and
  its service run as accounts of their own. Then tell the app where that folder
  is, for example with a setting its Serve step sets.
- The same script, packages and base reuse what it installed. A changed script
  (a new pin) runs again at the next deploy, which installs the new version.

## Where it runs

| Where | What happens |
| --- | --- |
| Production on mobilynet | Each build runs the script once on its own setup layer, before Prepare. Services built from one source share one build, so the script runs once for them; a build whose packages change gets a new layer. |
| Production on a container provider | The image's build runs it as root, after its packages and before the app's release. The image's system is Nix's, so `apt-get` isn't there. |
| A host's staging | It doesn't run there. A host's staging runs the app on the host's own machine, which nothing builds for the app, and runs none of the app's code as root, so publishing to staging is refused before anything starts and the release on staging keeps serving. A project with a machine setup script is deployed to production only. |
| Development and Preview | It never runs. Workspace setup or Prepare provides the same tools in development, in the session's own folder. |

## When a deploy refuses it

Deploy to production checks the script before it sends anything, and each
refusal names the script and the fix:

- "…names the machine setup script deploy/machine-setup.sh, which the saved
  work doesn't have": commit the script at that path, or fix the path.
- "…which is a link in the saved work, not a file" (or "a folder"): name the
  script itself.
- "…holds 0 bytes" or "…holds 70,000 bytes, and a host takes 1 byte to
  64 KiB": write the script, or make it shorter by fetching what it installs
  instead of holding it.
- "…isn't UTF-8 text" or "…holds a NUL character": save it as a plain
  UTF-8 text script.
- "The saved work has its own vibe64-machine-setup.sh": that name is where
  Vibe64 puts the script in the package it sends, so rename your file.

Fix it in a session with the coding agent, **Save**, then deploy to production
again. Nothing changed in Production meanwhile.

A script that fails while it runs, a download whose SHA-256 doesn't match say,
fails that build (every service built from it). The build's log at the host shows the script's
output. Production keeps serving the version it served before.
