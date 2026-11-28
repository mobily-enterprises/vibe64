# @local/vibe64-deploy

Public Vibe64's deploy engine: Production's needs from a project's `genesis/stack.md` (`needs.js`,
`needsOfStack.js`), the package each service runs (`package.js`), the Plan (`plan.js`), the record of what was made
(`record.js`), the steps that make it (`steps.js`) and the provider adapters, mobilynet first
(`adapters/mobilynet/`). A Production the Stack releases as a signed release (`- Signed release`) is no Plan: it is
built at the saved commit, signed where the release key is (never here) and handed to an app a provider's machine
already runs as one prebuilt release (`signedRelease.js`, the mobilynet adapter's `prebuilt.js`).

It is plain Node ESM with no editor or JSKIT dependency; its record is written by Vibe64's one atomic file writer
(`@local/vibe64-atomic-file`, plain Node too). It runs only in Vibe64's editor, which gives it the credential, the
folder that keeps the record and the prices; it knows no host. Nothing here holds a key or a value of the Production Env
beyond the call that uses it.

What is left to build, and what an earlier plan asked that was built or replaced:
[docs/deployment-adapters.md](../../docs/deployment-adapters.md).
