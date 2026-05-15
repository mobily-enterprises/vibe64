# Running JSKIT-AI Studio inside JSKIT-AI Studio

This document explains the dogfood setup that lets JSKIT-AI Studio operate on
JSKIT-AI Studio itself, including the slightly unreasonable version where a
Studio session starts another Studio, which starts another Studio, and everyone
tries to keep a straight face.

The point is not recursion for its own sake. The point is that JSKIT-AI Studio
is supposed to be good enough to develop itself. That means it must handle the
same realities it asks user projects to handle: session worktrees, generated
app setup, dependency installs, app-test containers, Codex terminals, local
package development, GitHub PR flows, and dirty-tree checks.

For ordinary apps, this is already a lot. For Studio developing Studio, there is
one extra twist: Studio depends on JSKIT packages, and many of the changes we
need while building Studio actually belong in `jskit-ai`, especially
`@jskit-ai/jskit-cli`, which owns the issue-session runtime. Publishing a new
npm package for every local runtime tweak would make development slow and
fragile. So the dogfood setup needs a way to run Studio against local JSKIT
source, safely, inside managed session worktrees.

That is where devlinks and sibling repos come in.

## The Short Version

To run JSKIT-AI Studio inside JSKIT-AI Studio, we need four things to line up:

1. The Studio worktree must be fully provisioned, not just a bare Git checkout.
2. Its JSKIT package dependencies must point at editable local package source
   when requested.
3. Docker containers launched from nested Studio instances must see the same
   filesystem graph that Git and Node symlinks refer to.
4. Nested toolchain processes must inherit the right credentials and daemon
   access without inheriting the whole parent home directory.

The last two points are where most of the "how is this even failing?" moments
live. Git worktrees use `.git` files that point outside the worktree. Devlinks
use `node_modules` symlinks that point outside the worktree. Docker, by
default, only sees what we mount into it, and nested tools only see the
credentials we deliberately expose. If those contexts are incomplete, the
failure looks random:

- Git says the worktree is not a repository.
- Node says `@jskit-ai/kernel` cannot be found.
- Docker says port `4100` is already allocated even though the nested process
  thought it was free.
- GitHub CLI says it is not authenticated, even though the parent Studio is
  happily creating issues and comments.

All of these are true. None are the real story. The real story is: containers
need the correct host-side context.

## Devlinks: Local Packages Without The Publish Tax

Devlinks are the development-mode links from an app's `node_modules` back to a
local JSKIT source checkout.

In a normal install, `node_modules/@jskit-ai/jskit-cli` comes from npm. In a
dogfood install, we want it to point at local source, for example:

```text
node_modules/@jskit-ai/jskit-cli
  -> /path/to/session/sibling-repos/jskit-ai/tooling/jskit-cli
```

That matters because Studio is a UI over package-owned JSKIT behavior. When we
change the session runtime, command handling, app doctor behavior, or package
metadata contracts, the authoritative code often lives in `jskit-ai`, not in
the Studio repository. If Studio could only use published npm packages, the
loop would be:

1. Edit `jskit-ai`.
2. Publish packages.
3. Update Studio.
4. Install.
5. Discover the change is wrong.
6. Repeat until morale becomes a build artifact.

Devlinks remove that publish tax. The Studio worktree can run against editable
JSKIT package source immediately.

## What `npm run devlinks` Actually Does

In a generated JSKIT app, `npm run devlinks` is deliberately thin:

```json
{
  "scripts": {
    "devlinks": "jskit app link-local-packages"
  }
}
```

That is important. The behavior is not copied into every app as a shell script.
It lives in the installed JSKIT CLI, so the rule can improve over time without
asking old apps to carry around fossilized linking logic.

The command does something very specific: it rewires already-installed
`node_modules` entries so the app imports local JSKIT source packages instead
of the npm copies.

It is not `npm install`. It is not `npm link`. It is not a mystical portal,
although on a good day it can impersonate one. It is a controlled replacement
of package directories with symlinks.

The sequence is:

1. It expects `npm install` to have already run. If
   `node_modules/@jskit-ai` does not exist, it stops and tells you to install
   first.
2. It finds the JSKIT monorepo root. The root can come from:
   - `--repo-root <path>`
   - `JSKIT_REPO_ROOT`
   - a nearby directory literally named `jskit-ai`
3. It validates that the repo root looks like the JSKIT monorepo by checking for
   both `packages/` and `tooling/`.
4. It scans `packages/` and `tooling/` for directories with `package.json`
   files whose `name` is an `@jskit-ai/*` package.
5. For each discovered package, it replaces the matching app install path:

   ```text
   node_modules/@jskit-ai/<package>
   ```

   with a symlink to the source directory in the JSKIT repo:

   ```text
   /path/to/jskit-ai/packages/<package>
   /path/to/jskit-ai/tooling/<package>
   ```

6. If a linked package publishes binaries, it refreshes
   `node_modules/.bin`. For example, `@jskit-ai/jskit-cli` publishes `jskit`,
   so the app gets:

   ```text
   node_modules/.bin/jskit
     -> ../@jskit-ai/jskit-cli/bin/jskit.js
   ```

7. It handles declared companion packages that live beside `jskit-ai`, currently
   `json-rest-schema` and `json-rest-stores`. If the app declares one of those
   packages, the source repo must exist next to the JSKIT repo. The command then
   links it into both:

   ```text
   app/node_modules/<companion>
   jskit-ai/node_modules/<companion>
   ```

   That second link matters because JSKIT packages may import the companion from
   inside the JSKIT monorepo source tree.
8. It deletes `node_modules/.vite` so Vite does not keep stale prebundled paths
   from before the symlink swap.

Afterward, the app's dependency graph still looks like an npm install to Node,
Vite, and package resolution. But key packages now resolve to editable local
source. That is the tiny trick with large consequences: the app remains an app,
while selected dependencies become live development checkouts.

For Studio dogfooding, the same operation is run against session-owned sibling
repos, not the developer's main checkout. So `node_modules/@jskit-ai/jskit-cli`
does not point at "whatever happens to be open on the laptop"; it points at:

```text
.jskit/sessions/active/<session_id>/sibling-repos/jskit-ai/tooling/jskit-cli
```

That is why devlinks and sibling repos are paired. Devlinks provide the package
resolution trick. Sibling repos provide the session ownership boundary.

In this repo, the development hook is intentionally opt-in. The important pieces
are:

- `JSKIT_DEVLINKS=/path/to/jskit-ai`
- `JSKIT_AI_ROOT=/path/to/jskit-ai`
- `.jskit/config/devel_jskit_ai_root`
- `scripts/devel-link-local-packages-postinstall.sh`
- `scripts/devel-provision-jskit-ai-studio-session.sh`

The postinstall hook does not force devlinks on normal users. A clean checkout
with no development config installs normal npm packages. If development config
is present, the hook can link local JSKIT packages. Inside JSKIT issue sessions,
the provisioning script takes over and turns that local source into
session-owned sibling clones.

That distinction is important: devlinks are not "use whatever happens to be on
my laptop" forever. In a session, they become links into controlled sibling
repos that belong to the session.

## Why Sibling Repos Exist

At first glance, pulling sibling repos into a Studio session sounds excessive.
Why not just let Codex edit `/home/merc/Development/current/jskit-ai` directly?

Because sessions are supposed to be disposable, reviewable, and safe.

If a Studio session modifies the developer's main `jskit-ai` checkout directly,
we get a dangerous ownership problem:

- The Studio session may finish, rewind, or be destroyed.
- The main `jskit-ai` checkout may contain unpushed work.
- The PR finalization step for Studio may not know that a second repository is
  dirty.
- A protected branch may reject direct pushes, leaving the important changes in
  a place the workflow cannot finish.

That is not a development flow. That is a suspense novel with `git status`.

Sibling repos fix the ownership boundary.

For a session, Studio provisions sibling clones under:

```text
.jskit/sessions/active/<session_id>/sibling-repos/<repo-name>
```

For example:

```text
.jskit/sessions/active/2026-05-15_14-12-52/
  worktree/
  sibling-repos/
    jskit-ai/
    json-rest-schema/
    manifest.tsv
```

The Studio session worktree then links packages from those sibling clones. That
means Codex can edit both:

- the app under test, such as `jskit-ai-studio`
- supporting package source, such as `jskit-ai/tooling/jskit-cli`

without writing into the developer's main checkout.

The session records the sibling repo base commits in `manifest.tsv`, switches
each sibling clone to a session branch, and finalization can guard against dirty
sibling repos. If the sibling repo changed, the user must handle it deliberately,
usually by asking Codex to prepare the sibling PR too. The important bit is that
the workflow refuses to silently lose the work.

This is the "Aha" moment: sibling repos are not just a convenience for local
imports. They are how package-owned runtime work gets brought inside the same
session ownership model as the app worktree.

## Provisioning The Studio Worktree

A Git worktree is intentionally lean. It contains tracked files, but it does not
automatically contain ignored local configuration, development roots, Docker
dogfood flags, or sibling repo clones.

That is a problem for Studio developing itself, because the session worktree
needs the same local development contract as the parent checkout.

The solution is a development-only provisioning hook:

```json
{
  "scripts": {
    "jskit:provision-session": "bash scripts/devel-provision-jskit-ai-studio-session.sh"
  }
}
```

The JSKIT session runtime invokes that hook after the session worktree exists
and dependencies are installed or adopted. The script then:

1. Copies `.jskit/config` from the target root into the session worktree.
2. Reads development sibling configuration.
3. Clones configured sibling repos into the session.
4. Creates session branches in those siblings.
5. Writes session-local config such as `devel_jskit_ai_root`.
6. Runs `jskit app link-local-packages` so `node_modules` points at the
   session-owned package sources.

The behavior is marked clearly as development-only. Normal apps do not need it,
and normal installs should not accidentally inherit it.

## Docker: The Helpful Box That Cannot See Through Walls

Studio runs a lot of work inside Docker:

- app bootup checks
- app setup checks
- dependency installs
- Codex terminals
- app-test terminals
- nested Studio instances, when dogfooding gets ambitious

Docker is useful because it gives Studio a managed toolchain. But Docker only
sees paths that are mounted into the container. Git and Node, unfortunately for
our blood pressure, are very happy to follow paths outside the directory we
thought we mounted.

Two filesystem facts matter:

### Git Worktrees Point Outside The Worktree

A linked worktree does not have a `.git` directory. It has a `.git` file:

```text
gitdir: /path/to/main/repo/.git/worktrees/<name>
```

If a Docker command only mounts the worktree as `/workspace`, Git opens
`/workspace/.git`, follows the `gitdir:` path, and then finds nothing because
the main repo's `.git` directory was not mounted.

The fix is to detect linked worktrees and mount the owning repo root at the
same absolute path inside Docker.

### Devlinks Point Outside The Worktree Too

After devlinking, `node_modules` contains absolute symlinks into sibling repos:

```text
node_modules/@jskit-ai/kernel
  -> /path/to/session/sibling-repos/jskit-ai/packages/kernel
```

If Docker cannot see `/path/to/session/sibling-repos`, Node reports that package
imports are missing. The package is installed. The symlink is correct. The
container is simply missing the other side of the door.

The same linked-worktree owner-root mount solves this for the doctor containers
and the app-test containers. They do not just mount:

```text
<targetRoot>:/workspace
```

They also mount the linked worktree owner root:

```text
<repoRoot>:<repoRoot>
```

That lets Git find metadata, and lets Node follow devlink symlinks.

## Recursive Studio: Where The Floor Has Another Floor

Running Studio inside Studio introduces a second Docker wrinkle. The inner
Studio also wants to start Docker containers. That means the app-test container
needs access to the host Docker daemon.

For development, this is enabled with:

```text
.jskit/config/devel_app_test_host_docker
```

When that config is enabled, app-test containers get:

- `DOCKER_HOST=unix:///var/run/docker.sock`
- `/var/run/docker.sock:/var/run/docker.sock`
- the host Docker socket group added when available
- stale terminal cleanup disabled for the nested process

The stale cleanup flag matters because otherwise the nested Studio can mistake
its parent's terminals for abandoned toolchain containers and clean them up.
That is technically efficient. It is also not what anyone wanted.

With host Docker passthrough, the nested Studio can start its own app-test
containers. Then the next nested Studio can do the same, and so on until either
engineering curiosity is satisfied or the machine starts making reasonable
objections.

## The Tool Home Trap

Another recursive failure looks less like Docker and more like amnesia:

```text
GitHub CLI is not authenticated.
```

This is confusing because the parent Studio can be authenticated just fine. It
can create the GitHub issue, list PRs, and comment on issues. Then the child
Studio starts inside an app-test container, tries the exact same thing, and
`gh` looks around with empty pockets.

The reason is that app-test intentionally runs with an isolated home:

```text
HOME=/tmp/studio-home
```

That is good. It keeps npm cache, shell state, and other runtime scraps out of
the managed tool home. But `gh` stores its login under the home config
directory, usually:

```text
~/.config/gh
```

So the child Studio was not missing the `gh` binary. It was missing the `gh`
memory.

The fix is deliberately narrow. App-test containers mount Studio's managed
tool-home volume:

```text
jskit_ai_studio_tool_home:/home/studio
```

and expose only the GitHub CLI config location:

```text
GH_CONFIG_DIR=/home/studio/.config/gh
```

The child keeps `HOME=/tmp/studio-home`, but `gh` reads the same authenticated
config as the parent managed toolchain. This is the useful kind of sharing:
the credentials cross the boundary, the random home-directory clutter does not.

## The Port Trap

One failure only appears once recursion gets far enough:

```text
Bind for 127.0.0.1:4100 failed: port is already allocated
```

The bug was subtle. Studio selected an app-test port by checking whether
`127.0.0.1:4100` was free from inside its own process. In a nested app-test
container, that check happens inside the container network namespace.

But `docker run -p 127.0.0.1:4100:4100` publishes the port on the host Docker
daemon.

So the nested process could say "4100 is free" while the host daemon quite
correctly said "no, it is not."

The fix is to check both places:

- can this process bind the local port?
- does Docker already have a container publishing that port?

Only then is the port considered available.

## The Auto-Retry Trap

The GitHub auth failure exposed one more problem. When a nested session reached
the automatic `issue_created` step, the step failed because `gh` was not
authenticated. Studio then did something very earnest and very annoying: it
tried again. And again. And again.

The screen flickered because the UI had an automatic-step guard, but cleared
that guard after a failed immediate step. The sequence was:

1. `issue_created` is an immediate no-input step.
2. Studio auto-runs it.
3. `gh issue create` fails.
4. Studio clears the "already auto-ran this step" marker.
5. The busy-state watcher sees the same step again.
6. Back to step 2. Tiny treadmill, large irritation.

The fix is that automatic immediate steps are one-shot for the current
session-step key. If the automatic attempt fails, the error stays visible and
the user can explicitly retry after fixing the cause. Manual retry still works;
the UI just stops volunteering to run face-first into the same wall every few
milliseconds.

## What This Gives Us

The final development shape is:

1. Start Studio with local development config, such as `JSKIT_DEVLINKS` or
   `.jskit/config/devel_jskit_ai_root`.
2. Create a JSKIT issue session for `jskit-ai-studio`.
3. The session worktree is provisioned with copied config and sibling repos.
4. The worktree links JSKIT packages from session-owned sibling clones.
5. App bootup, app setup, app-test, and nested Studio containers mount the
   linked worktree owner root so Git and Node can follow their real paths.
6. If sibling repos become dirty, finalization can stop and force an explicit
   sibling PR path instead of losing work.

The result is not magic. It is better than magic: it is a set of visible
contracts.

- Devlinks decide which packages should be editable.
- Provisioning decides how a session receives local development context.
- Sibling repos decide who owns cross-repo changes.
- Docker mounts decide what filesystem truth containers can actually see.
- Tool-home mounts and `GH_CONFIG_DIR` decide which credentials nested tools
  can use.
- Port selection checks the namespace that will really bind the port.
- Immediate-step guards decide when Studio should stop helping and wait for a
  human to repair the underlying failure.

Once those contracts are in place, JSKIT-AI Studio can develop JSKIT-AI Studio
using JSKIT-AI Studio. It is recursive, but not mysterious. The stack stops
being a hall of mirrors and becomes a set of doors with labels on them.
