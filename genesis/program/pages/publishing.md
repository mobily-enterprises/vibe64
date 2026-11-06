# Publishing pages

A session's AI publishes a page with one shell command that Codex, Claude and
OpenCode all run, so a result meant for others becomes a page everyone on the
project can open, outside the repository.

## Sources

- Main: `packages/vibe64-pages/src/server/service.js`
- `packages/vibe64-pages/src/server/pageStore.js`
- `packages/vibe64-pages/src/server/pageFiles.js`
- `packages/vibe64-pages/src/shared/pageLinks.js`
- `packages/vibe64-pages/src/shared/pageLimits.js`
- `packages/vibe64-pages/src/server/Vibe64PagesFeature.js`
- `packages/vibe64-terminals/src/server/agentPagesCommand.js`
- `packages/vibe64-terminals/src/server/agentHelperCommand.js`
- `packages/vibe64-terminals/src/server/sessionGuidanceInput.js`
- `packages/vibe64-genesis/src/server/promptContext.js`

## Public contract

- `vibe64-helper pages publish <file.html | folder> [--title "Title"] [--json]`
  publishes one HTML file (as `index.html`) or a folder with an `index.html` at
  its top. The wrapper reads the files with the agent's own access, skips hidden
  entries and refuses links. The title is `--title`, else the page's `<title>`,
  else the file or folder name.
- `update <page-id> <file.html | folder>` adds a version under the same link and
  keeps the title unless `--title` changes it; an archived page refuses updates.
  `revert <page-id> <version>` brings a kept version back as the newest one.
  `list` prints every page with its id, title, version, last update, archived
  state and link; `--json` prints the service's answer.
- Publish, update and revert print the page's link first: its app path,
  `/app/project/<slug>/dashboard/pages/<page id>`, then a Markdown link to give
  in the chat. Mistakes exit 2 with the usage; refusals exit 1 with their reason.
- A page holds at most 500 files and 20 MiB, with paths of at most 240
  characters; no part may be empty, `.`, `..` or hidden, and the top `_vibe64`
  folder belongs to Vibe64. A page id is the title's words and six random hex
  digits.
- Storage: `<project state>/pages/<page id>/page.json` (contract
  `vibe64.page.v1`: title, maker, session, created and updated times and makers,
  archived state, the current version and the kept versions, each with its title) and
  `versions/<n>/`. The last ten versions are kept. A version is written beside the
  others and renamed into place before `page.json` is replaced, so a reader sees
  one whole version. The maker is the person behind the session's latest
  message, else whoever runs Vibe64 here.
- The engine-neutral session guidance names the command for every engine and
  tells the AI when to offer a page in one line, when to make one without
  asking, to say a changing page can be kept up to date, to update a relevant
  page instead of making another, not to offer pages for quick answers, code
  changes or repository documents, to offer once per topic, and never to put
  secrets in a page. Guidance registered before pages existed stays valid.
