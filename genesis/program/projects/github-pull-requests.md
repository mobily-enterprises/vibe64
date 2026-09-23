# GitHub pull requests and sessions

People can turn an existing GitHub PR into an isolated session, or publish session
work as a new PR. GitHub remains the PR store.

## Sources

- `packages/vibe64-project/src/server/githubApi.js`
- `packages/vibe64-project/src/server/githubPullRequests.js`
- `packages/vibe64-project/src/server/service.js`
- `packages/vibe64-project/src/server/registerRoutes.js`
- `packages/vibe64-core/src/server/projectRepository.js`
- `packages/vibe64-sessions/src/server/service.js`
- `packages/vibe64-sessions/src/server/actions.js`
- `packages/vibe64-sessions/src/server/inputSchemas.js`
- `packages/vibe64-sessions/src/server/registerRoutes.js`
- `packages/vibe64-terminals/src/server/service.js`
- `packages/vibe64-terminals/src/server/sessionSource.js`
- `packages/vibe64-terminals/src/server/sessionWorkSave.js`
- `packages/vibe64-terminals/src/server/repositoryHistory.js`
- `packages/vibe64-runtime/src/server/runtime.js`
- `packages/vibe64-runtime/src/server/sessionStore.js`
- `src/components/studio/GithubPullRequestsPanel.vue`
- `src/components/studio/GithubBrowserTabs.vue`
- `src/components/studio/vibe64-session/Vibe64CreatePullRequestDialog.vue`
- `src/components/studio/vibe64-session/Vibe64AutopilotView.vue`
- `src/composables/useVibe64SessionData.js`
- `src/composables/useVibe64SessionRepositoryStatusRegistry.js`
- `src/lib/vibe64RepositoryRealtime.js`
- `src/lib/vibe64SessionInfo.js`
- `src/lib/vibe64GithubProject.js`
- `src/placement.js`
- `tests/server/githubPullRequests.unit.test.js`

## Public contract

All Issues and PR navigation and session actions are hidden without a GitHub
repository. The backend independently rejects non-GitHub project operations.
The Issues/PR Dashboard entry opens a browser with Issues and Pull requests tabs,
returning to each browser's list while retaining its URL filters and pagination.
Pull requests is
project-wide, available without an active session, and collapses
the Dashboard menu while open. Open, Closed, Merged and All filters, literal
title/body search, and 25-item pagination use URL state. Descriptions use the
existing safe Markdown renderer. The source repository and branch, base branch,
draft state and change counts appear before Open as session.
The browser keeps Back to dashboard, Refresh and Create from session in its
toolbar without a separate title/repository header. Compact tabs sit close to
the toolbar and filters. List rows use compact spacing and place branch details
beside metadata when space permits, wrapping at narrower widths.

Opening uses the existing assistant picker and session admission policy. The
server re-reads the PR with the acting user's GitHub credentials; the browser
supplies only its number. Closed, merged, deleted-head, archived and unwritable
source repositories cannot become editable sessions. Writable forks are supported;
maintainer-only permission to edit another person's fork is not inferred from
permission to edit PR metadata. The session clones the observed head commit and
persists the verified PR source outside project source. GitHub command identity
is initialized before the first assistant message, so Save and Update work
immediately. The description reaches
the assistant as background data, not an instruction. PR identity and Save
destination remain visible in chat and session info.

Create pull request is available in session actions and in the PR browser for
the selected session, and is the recommended GitHub action in Review changes.
The form captures and submits the reviewed source destination, explains the
head-to-base direction and code-only effects, preserves its text on failure and defaults to a
draft. Members do not need AI access to publish a PR; optional commit naming
follows Save's access check and non-AI fallback. The server serializes publication with the existing assistant/repository
write lock, checks GitHub write permission, binds a session-specific branch,
and creates that branch only if absent. The empty Git lease rejects a concurrent
creator without replacing an existing ref. It supports locally committed
baselines and publishes captured session changes through the ordinary Save
implementation. The session stays bound to its branch after a partial failure;
an explicit retry finds an existing open PR before attempting another creation.
An explicitly selected non-default hosted branch becomes the PR head instead
of generating another branch. Existing session work is never silently retargeted
to an unrelated existing branch. Project owners may require PR publication in
Vibe64; direct commits then require a numbered PR, while the server-owned
Create PR operation can first publish its reviewed head. Repository-wide push
restrictions remain GitHub's responsibility.
GitHub mutations are never automatically retried. Saving to a PR branch does
not merge it or advance the PR base branch.

Save, Update and renewal use the bound source rather than the project's default
branch. PR authority survives renewal and archive indexing, and canonical-change
notifications affect only sessions sharing that source. Forks do not use the base
repository's disposable mirror. UI outcomes use shared command feedback and
loading failures remain inline.
