# Vibe64 Agent Notes

This repository is implemented as a JSKIT app, but the product is Vibe64. Use JSKIT commands for framework and app maintenance work, and run them through `npx jskit ...` from the repository. Do not assume a global `jskit` binary exists.

Important boundaries:

- `/home/merc/Development/current/vibe64` is the writable public Vibe64 source of truth.
- `/home/merc/Development/current/vibe64-online/submodules/public-vibe64-local-editor` is a deployment-managed read-only submodule mirror. Do not edit, commit, or deploy from inside that submodule.
- To deploy editor changes: change, commit, and push `/home/merc/Development/current/vibe64`; then update, commit, and push `/home/merc/Development/current/vibe64-online`; then run `npm run deploy` from `/home/merc/Development/current/vibe64-online`.
- Committed Vibe64 source contract lives in root `vibe64.project.json`, `vibe64.runtime-lock.json`, and optional `.vibe64/launcher`, `.vibe64/scripts`, `.vibe64/prompts`, and `.vibe64/project-knowledge`.
- Runtime/session state is Vibe64-owned runtime-local state, not source-owned repository content.
- Use `npx jskit ...` freely for app/framework tasks such as verification, scaffold checks, generator work, JSKIT metadata, and JSKIT-adapter project inspection.
- Do not create loose workboard files.
- Do not run bare `jskit ...`. Use `npx jskit ...`.
