# Publish your project as an app or package (Publish)

**Dashboard → Publish** is where a project becomes something people install: an
app on your own phone, or a package on a registry. On a phone, open Dashboard,
then choose **Publish** from the **Dashboard section** menu.

The page has four parts:

- **Releases use your saved work**: the saved commit and branch a release
  would use, whether it is pushed, whether the project's checks passed on it,
  and each package from Packaging with its current version.
- **Targets**: one card per place a release goes. With no targets yet, the page
  offers the destinations, those needing no account first: **Install on my
  phone**, **GitHub Releases**, **npm** and **PyPI**. Each shows what it needs,
  how long the first and later releases take, and what it costs.
- **History**: every release and dry run with each step, each target's outcome
  and its proof, and **Show log**. A running release updates live; you can
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
- **Recovery kit**: **Kit…** downloads every key as one file under a second
  passphrase; keep both off this computer. **Restore** brings them back on a
  new computer. The panel says when a key is newer than your last kit.

### Add a target

**Add target** (or a destination tile) asks where the release goes, then which
package (only packages that destination can publish are offered) and which
account. npm also takes an optional tag such as `next`; empty means `latest`.
Add the account first if the dialog says so. A card's **⋮** menu switches the
target to another account of the same kind or removes it. Targets are kept by
Vibe64 for this project on this computer, not in the project's files.

### Release

1. **Release → Version**: Vibe64 suggests the next patch, minor or major
   version for each package and drafts **What's new** from the saved commits.
   **Write version** puts the version bump and a `CHANGELOG.md` entry into this
   session as an ordinary change; review it and **Save** it (pushed, like any
   Save). **Release the saved version** skips this when the saved work is
   already the version you want.
2. **Review & publish**: choose targets, unlock your keys if asked, and read
   **Preflight**: saved and pushed work, Packaging, tags still free, checks
   passed (**Run checks** runs the project's verification on the saved
   commit), every sign-in valid, install key and recovery kit, Android
   requirements. A red line stops the release until fixed; a changed toolchain
   needs **I understand**. The plan has a short id such as `Plan 3f9c`.
3. **Dry run** builds once and asks each destination what would happen;
   nothing is tagged or uploaded. It appears in History as a dry run.
4. **Publish…** opens the confirmation: exactly which package goes where at
   which version, the saved commit and tag. **Publish** there (with your
   passphrase if the keys locked meanwhile) tags the saved commit, pushes the
   tag, builds each package once and sends the same files to every target,
   reading each back. If the saved work, targets or tools changed since you
   reviewed, it refuses and shows the new plan.

A release where some targets failed shows **Partly published**; fix the cause
and **Finish this release** retries only the unfinished targets of the same
plan. Published targets are not sent again.

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
  code your phone scans on the same Wi-Fi. This computer shares only that one
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
