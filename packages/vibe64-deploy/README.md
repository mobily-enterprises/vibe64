# @local/vibe64-deploy

Public Vibe64's deploy engine: Production's needs from a project's `genesis/stack.md` (`needs.js`,
`needsOfStack.js`), the package each service runs (`package.js`), the Plan (`plan.js`), the record of what was made
(`record.js`), the steps that make it (`steps.js`) and the provider adapters, mobilynet first
(`adapters/mobilynet/`).

It is plain Node ESM with no editor or JSKIT dependency. It runs only in Vibe64's editor, which gives it the
credential, the folder that keeps the record and the prices; it knows no host. Nothing here holds a key or a value of
the Production Env beyond the call that uses it.
