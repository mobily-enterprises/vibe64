# Publish your project as an app or package (Publish)

**Dashboard → Publish** is where a project becomes something people install: an
app on your own phone, or a package on a registry. On a phone, open Dashboard,
then choose **Publish** from the **Dashboard section** menu.

The page has four parts:

- **Releases use your saved work**: the saved commit and branch a release
  would use, whether it is pushed, whether the project's checks passed on it,
  and each package from Packaging with its current version.
- **Targets**: one card per place a release goes, followed by an **Add
  target** tile. With no targets yet, the page offers the destinations, those
  this project can use first: **Install on my phone**, **GitHub Releases**,
  **npm** and **PyPI**. One that cannot be used yet says why (for example
  "Needs a Python package in Packaging" or "Needs this project's repository
  on GitHub"). Each shows what it needs, how long the first and later releases
  take, and what it costs.
- **History**: every release and dry run with each step, each target's outcome
  and its proof, and **Full log**. A running release updates live; you can
  leave the page and it carries on.
- **Accounts & keys** (top right) and **Release** (top right).

If the project has no `## Packaging` section yet, the page says **Tell Vibe64
what to build** instead of showing targets. Ask Colleague or a coding
conversation, for example "Set up packaging so I can install this app on my
phone", review the change and Save it.

### Publishing keys and accounts

**Accounts & keys** keeps every sign-in and install key Vibe64 uses for
publishing in one file in your home folder, encrypted under a passphrase of at
least 12 characters (an `age` file any age tool can open). Create it once;
afterwards **Unlock** it for 15 minutes when you add accounts or publish, and
**Lock** it any time. Vibe64 cannot recover a forgotten passphrase.

- **Add account**: npm (an access token and the registry address), PyPI (an
  API token and the upload address) or GitHub (**Use my GitHub CLI sign-in**,
  or paste a token). Tokens go straight into the keys file; the page and
  Colleague only ever see the account's name and address.
- **Replace token** (the key icon on an account) keeps the account's name and
  address, so targets using it keep working with the new token.
- **Recovery kit**: **Save kit** (or **Manage**) downloads every key as one file under a second
  passphrase; keep both off this computer. **Restore** brings them back on a
  new computer. The panel says when a key is newer than your last kit.

### Add a target

**Add target** (or a destination tile) asks where the release goes, then which
package (only packages that destination can publish are offered) and which
account. **What it needs** marks what this project and your keys already have.
npm also takes an optional tag such as `next`; empty means `latest`. When the
dialog asks for an account, **Add account** opens Accounts & keys and, when you
press Done, comes back to the same target. A card's **⋮** menu switches the
target to another account of the same kind or removes it. Targets are kept by
Vibe64 for this project on this computer, not in the project's files.

### Release

1. **Release → Version**: each package offers its saved version **as saved**
   while no release has published it, then the next patch, minor and major.
   Releasing as saved needs no session. A new version needs one: **Write
   1.4.3** puts the version bump and a `CHANGELOG.md` entry (drafted from the
   saved commits in **What's new**) into the session as an ordinary change;
   review it and **Save** it. Without a session the dialog says so and offers
   **Release as saved** while the saved version is still unpublished.
2. **Review & publish**: choose targets, unlock your keys if asked, and read
   **Before publishing**: saved and pushed work, Packaging, tags still free,
   checks passed, every sign-in valid, install key and recovery kit, Android
   requirements. What needs attention comes first; the rest folds into **All
   N checks passed**. A red line stops the release and the footer says so; an
   amber one (a changed toolchain) needs **I understand**. Failed checks name
   the check, **Show output** shows the end of its output and **Run again**
   reruns it; a refused sign-in offers **Fix sign-in**; saved work that is
   not on the remote yet offers **Push to origin** (fast-forward only, never
   forced; it is the person's button, not a Colleague tool). **What happens** lists
   the steps in order: build each package once, tag the saved commit, publish
   to each target (with its account and address), under a short plan id such
   as `Plan 3f9c`.
3. **Dry run** builds once and asks each destination what would happen;
   nothing is tagged or uploaded. It appears in History as a dry run.
4. **Publish…** opens the confirmation: exactly which package goes where at
   which version, the saved commit and tag. **Publish** there (with your
   passphrase if the keys locked meanwhile) builds each package once, then
   tags the saved commit and pushes the tag, then sends the same files to
   every target and reads each back. A failed build therefore leaves no tag
   behind. If the saved work, targets or tools changed since you reviewed, it
   refuses and shows the new plan. Builds use the saved commit without the
   project's Genesis and agent folders (`genesis/`, `.genesis/`, `.agents/`,
   `.claude/`, `.codex/`, `.opencode/`), so packages never ship them.

While a release runs each of its target cards shows **Publishing 1.4.3…**;
afterwards a card shows the version people get, **Live · published …** and a
**Verified** checksum read back from the destination. The Publish page's
**Checks** line runs the checks on the saved commit at any time and, when they
fail, shows which check failed with **Show output**.

When a build or upload fails, the target card says **Last release failed**
with the reason; pressing it opens that release in History with the tool's
own error output (credentials removed) and **Full log**. A release where some
targets failed shows **Partly published**; fix the cause and **Finish this
release** retries only the unfinished targets of the same plan (published
targets are not sent again). If the fix changed the saved work, the button
reads **Release the new saved work** and starts a new release instead; if the
plan itself changed (for example a check or setting), **Finish this release**
opens a new release with a note saying why. Long tool output keeps its start
and end. Checks that fail without blocking show in amber. Errors appear as a
short message at the bottom of the page.

### Colleague and publishing

Colleague can read the Publish state, suggest and write a version bump into
the session, read the plan and preflight, start a dry run, read history and
logs, and **ask** to publish. Asking only shows a banner, **Your Colleague asked
to publish plan …**, with **Review** and **Dismiss**; **Review** opens the same
confirmation. Only your **Publish** press publishes. Colleague never sees a
token, key, passphrase or file path, and cannot add accounts, unlock keys,
accept a licence or confirm.

How publishing works underneath:

Package registries Vibe64 releases to:

- **npm**: an `npm` package is packed once with `npm pack`; a dry run shows the
  exact files and what changed since the version people install today. Proof
  is the registry's own integrity value. Undo means moving `latest` back to an
  earlier version (npm versions cannot be replaced).
- **PyPI** (or TestPyPI): a `python-dist` package's sdist and wheel pass
  `twine check` first. Versions use PyPI's spelling, so `1.5.0-rc.1` is
  published as `1.5.0rc1`. Undo means yanking the release on pypi.org, which
  Vibe64 links to; a file name can never be reused.
- **GitHub Releases**: the built files are attached to the release of the tag
  Vibe64 put on your saved commit, as draft, prerelease or latest. Undo means
  making an earlier release latest again.
- Re-running a release that already reached a registry is safe: the same
  version with the same files counts as done. The same version with different
  files is refused; choose a new version instead.
- A project that already versions with Changesets, release-please,
  setuptools-scm or similar keeps that tool; its Packaging says
  `Version from: external` and Vibe64 only reads the version.

**Install on my phone** (Android, no store account):

- The app's web client is a `web-bundle` package and the phone app a
  `capacitor` package with an id such as `com.example.notes` (permanent once
  people install it), a name, a 1024×1024 PNG icon with no transparency, and
  one `Permission` line with a plain reason per capability (camera,
  microphone, location, notifications, photos, contacts, calendar, bluetooth,
  vibration). Native plugins are ordinary dependencies of the client at the
  exact versions in its `package-lock.json`, on Capacitor 8; Vibe64 builds
  with exactly those and stops if the lockfile disagrees.
- The build needs Java 21 and the Android SDK (platform 36). Vibe64 shows the
  Android SDK licence; only after **you** accept it does it download the SDK
  into a folder in your home directory. It never accepts the licence for you.
  The first build downloads about 2 GB in all and needs about 2 GB of free
  memory; later builds take a minute or two.
- The card lists three one-time tasks in order. **Android build tools → Set
  up** shows Google's licence in full; **Accept and download** records your
  acceptance and downloads Java and the SDK into your user cache folder.
  **Install key → Create** makes the app's **install key** in your publishing
  keys. **Recovery kit → Save kit** downloads a kit that includes it. Preflight
  stops a phone release until all three are done.
- Phones install an update only when it is signed with the same install key: a
  lost key (and no recovery kit) means everyone must uninstall and reinstall.
  On the command line, `vibe64-publish keygen app --out <folder>` creates a key
  as two private files.
- Every build gets a build number one higher than the last; it is never stored
  in the project. After a release the card shows **Install on phone**: a QR
  code your phone scans on the same Wi-Fi. Opened on an Android phone itself,
  it offers **Download** directly, with **Show a QR code for another phone**. This computer shares only that one
  APK, at an unguessable address, for 10 minutes or until you close the
  dialog. **Download APK** saves it here instead; History offers both for
  earlier releases.
- Phones that installed this APK must uninstall it before installing the same
  app from Google Play later (a different signing line). Since 30 September
  2026, phones in Brazil, Indonesia, Singapore and Thailand install apps only
  from developers verified by Google; this goes worldwide in 2027. Preflight
  says so before a release.

Colleague can open **Publish** for you and explain these steps. It cannot
publish, confirm a release or see any credential.
