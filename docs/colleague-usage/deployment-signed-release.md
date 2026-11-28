# Production as a signed release

Some apps can't be deployed by the Production they run: a provider's own
control plane, for example, runs on a machine the provider manages, so its
Production is a new release of an app that machine already runs. One line in
the `## Deployment` section of the project's `genesis/stack.md` says so.
Production is then one **signed release**: built from the saved commit, signed
by whoever holds the release key, on their own computer, and handed to that
app. Vibe64 never holds the key.

## The line

The line names the release and the command that builds it:

```markdown
## Deployment

- Signed release `Control plane release`: `sh` `release/signed-release.sh`
```

It can stand alone, as above, or sit beside the steps that publish the app to
staging.

- The name is what people know the release by: 1 to 60 letters, digits, single
  spaces and `. & ' + ( ) _ -`, starting with a letter or digit.
- The command is written as a step's is, each word in backticks. It runs in a
  fresh checkout of the saved commit, and is given `V64_COMMIT` (that commit),
  `V64_RELEASE_DIR` (an empty folder) and `V64_RELEASE_KEY` (the fingerprint
  of the release key chosen). It must leave in that folder the provider's
  `output.tar` and `manifest.json`, the manifest naming that key, as the
  provider's own release tooling writes them (for mobilynet, a prebuilt
  release). It never sets those three names and serves nothing.
- The line belongs to the whole Deployment, above any `### Service` heading,
  and never beside `- Production: managed by`: Production is released one way.

## Who writes it

The line and the release script are part of the project's source. In a
session, ask the coding agent, for example "Production of this app is a signed
release of the app its machine runs: add the Signed release line and its
script". The agent reads the exact rules with `vibe64-helper spec deployment`.
Review the change and **Save** the session as usual.

## A release, step by step

| Step | What happens |
| --- | --- |
| Build | The person picks the machine's app and one of the project's release keys, and builds. The command runs at the saved commit; its `manifest.json` and `output.tar` are checked against each other and the key. |
| Sign | The release waits for its signature. The person downloads the manifest (named after the app and the commit), signs it with the release key on the computer that holds the key, and pastes the signature: one line of 88 characters ending in `==`. The release keeps waiting through a restart of the editor. |
| Hand over | The manifest, the signature and the output go to the provider as one prebuilt release of that app, and nothing else: no App Service, hosted service, link or setting is made or changed. |
| Follow | The app is read until it runs the release. If the release's check fails on the machine, its host switches the app back to the version it ran, and the release ends failed, saying why. |

Building again while a release waits for its signature replaces it. While a
release is being handed over or followed, a new one waits until it ends.

## What changes

| Where | What happens |
| --- | --- |
| Deploy to production | Refused, naming the line: such a Production makes no App Services. A host offers the signed release instead. |
| Publish to staging | Unchanged. With steps, the app publishes to staging as before; with the line alone, there is nothing to publish, as with `- Nothing.`. |
| Development and Preview | Unchanged. |

## When something is refused

- "Deployment Signed release names the release and the command that builds it
  …": write the line as `- Signed release \`name\`: \`command\` \`argument\``.
- "Deployment Signed release names the release in 1 to 60 letters…": shorten
  the name, or remove characters such as `<`, `/` or a double space.
- "Deployment Signed release never sets V64_RELEASE_DIR…" (or `V64_COMMIT`,
  `V64_RELEASE_KEY`): remove the setting; the host gives it.
- "Deployment says both who manages Production elsewhere and that Production is
  a signed release from here…": keep one of the two lines.
- "The manifest names the key …, not the release key you chose": the script
  must write `V64_RELEASE_KEY` into the manifest, or choose that key.
- "output.tar is … bytes with the SHA-256 …; its manifest names …": the script
  wrote the manifest for another output; write it last, from the output it
  leaves.
- "The signature is one line of 88 base64 characters…": paste the whole line
  the signing printed, and nothing else.
- "mobilynet refused the release: The release isn't signed by any of the
  project's release keys …": sign this release's manifest with the key it
  names, one of the project's release keys.
- "mobilynet refused the release: Its server runs an older host agent, which
  does this once MobilyNet updates it.": the machine's server can't take a
  prebuilt release yet. Nothing changed on the machine. Build again once the
  provider has updated it.
- "Switched back to …: …": the release's check failed on the machine; the app
  runs the version before. Fix the cause, then build again.
- "The release's files are gone from the machine that built it": build again.

## To deploy from Vibe64 again

Remove the line in a session, **Save**, then use **Deploy to production** on
the Deploy page.
