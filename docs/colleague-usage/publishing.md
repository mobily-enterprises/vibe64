# Publish your project as an app or package (Publish)

**Dashboard → Publish** is where a project becomes something people install: an
app on your own phone, or a package on a registry. On a phone, open Dashboard,
then choose **Publish** from the **Dashboard section** menu.

Today the page shows **Nothing published yet**. Adding publishing targets,
releasing and installing on a phone arrive in later updates; until then nothing
on this page builds, signs or uploads anything, and no account is needed.

How publishing will work, so Colleague can explain it:

- **Where** a project is published (each target, such as an npm package or
  "Android: install on my phone") is chosen by you on the Publish page and kept
  by Vibe64, not in the project's files.
- **How** it is packaged is a short `## Packaging` section in
  `genesis/stack.md`, written by a coding conversation only when you add your
  first target, and reviewed and saved by you like any other change. Run
  `vibe64-helper spec packaging` in a coding conversation for its exact grammar.
  The project never stores Android, Gradle or Xcode projects, keys or build
  numbers; Vibe64 generates the app shell for each build in a throwaway folder.
- A release uses only your saved and pushed work. The version bump and changelog
  are an ordinary change you Save; releasing then only adds a tag such as
  `v1.5.0` to that saved commit.
- Builds run without any of your credentials. Signing and uploading happen
  separately on exactly the built files, and a target counts as published only
  when Vibe64 reads the published version back.
- Anything that cannot be undone, such as publishing a version, runs only after
  you confirm the exact plan in Vibe64's own confirmation. Colleague or a coding
  agent can prepare a release and ask for that confirmation, but a "yes" in chat
  never publishes.
- Accounts, keys and build machines are always yours; Vibe64 never publishes
  under a shared account.

Package registries Vibe64 can release to, once the page offers them:

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

**Android: install on my phone** (no store account), once the page offers it:

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
- Each app has one **sideload key**. Phones install an update only when it is
  signed with the same key, so keep the backup Vibe64 asks you to make: a lost
  key means everyone must uninstall and reinstall. On the command line,
  `vibe64-publish keygen app --out <folder>` creates it as two private files.
- Every build gets a build number one higher than the last; it is never stored
  in the project. The signed APK is offered as a download and a QR code to scan
  with the phone.
- Phones that installed this APK must uninstall it before installing the same
  app from Google Play later (a different signing line). Since 30 September
  2026, phones in Brazil, Indonesia, Singapore and Thailand install apps only
  from developers verified by Google; this goes worldwide in 2027. Preflight
  says so before a release.

Colleague can open **Publish** for you and explain these steps. It cannot
publish, confirm a release or see any credential.
