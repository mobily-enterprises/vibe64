# Vibe64 Agent Notes

This repository is implemented as a JSKIT app, but the product is Vibe64. Use JSKIT commands for framework and app maintenance work, and run them through `npx jskit ...` from the repository. Do not assume a global `jskit` binary exists.

Important boundaries:

- Session truth lives in `<target-root>/.vibe64/sessions/active/<session_id>/`.
- Studio owns the Vibe64 session runtime directly. Inspect Vibe64 sessions through `.vibe64`.
- Use `npx jskit ...` freely for app/framework tasks such as verification, scaffold checks, generator work, JSKIT metadata, and JSKIT-adapter project inspection.
- Do not create loose workboard files.
- Do not run bare `jskit ...`. Use `npx jskit ...`.
