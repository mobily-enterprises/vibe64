# Connected JSKIT and its pins

A JSKIT app pins its JSKIT packages: the `@jskit-ai/*` versions in its
`package.json` and `package-lock.json`. When the project connects the JSKIT
repository (see [Configure connected repositories](connected-projects.md)), each
session runs the session's own JSKIT copy in place of the published packages,
and the pins decide what a saved commit, Staging and Production use.

## Moving the pins

A JSKIT app moves its JSKIT pins only with `npm run jskit:update`, which moves
every `@jskit-ai` pin to one published catalog and installs it, never with
`npm install`, `npm update` or `npm audit fix`. Ask the coding agent to run it;
Colleague can explain what it does.

## When the copy and the pins disagree

- **The copy carries a newer published version than the pins.** `jskit check`,
  the first step of `npm run verify`, refuses with
  `JSKIT project graph is inconsistent`. `npm run jskit:update` moves the pins,
  and the next Preview start puts the connected copy back in place of the
  published one the update installed. **Save** would also move the pins, but
  only when it runs.
- **The copy holds only unpublished edits.** It keeps the version of its last
  release, so with the pins at that version the checks accept it and the pins
  stay. The edits reach Staging and Production once JSKIT publishes them and
  the pins move to that release. A version in the copy changes only with
  JSKIT's own release, never by hand.
- **An unrelated dependency update, such as an audit fix.** It leaves every
  `@jskit-ai` entry as it was: if `git diff package.json package-lock.json`
  shows one moved, restore both files and update only the packages the fix
  names. Install the new lockfile with `npm ci`, then start Preview so
  preparation puts the connected copy back before verifying.

`npm install --no-save`, like any ordinary install, puts the published package
back, so the checks then pass for code the session does not run.
