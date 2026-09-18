# GitHub issues

People can read and manage a connected repository's issues from the project-wide
Dashboard without opening a session.

## Sources

- `packages/vibe64-project/src/server/githubApi.js`
- `packages/vibe64-project/src/server/githubIssues.js`
- `packages/vibe64-project/src/server/service.js`
- `packages/vibe64-project/src/server/registerRoutes.js`
- `packages/vibe64-project/src/server/actions.js`
- `packages/vibe64-project/src/server/Vibe64ProjectProvider.js`
- `packages/vibe64-terminals/src/server/codexGitCommand.js`
- `packages/vibe64-genesis/src/server/promptContext.js`
- `src/composables/useVibe64Issues.js`
- `src/composables/useVibe64AppPage.js`
- `src/lib/vibe64GithubProject.js`
- `src/components/studio/GithubIssuesPanel.vue`
- `src/components/studio/GithubIssueEditorDialog.vue`
- `src/components/studio/GithubLabelChip.vue`
- `src/components/studio/GithubBrowserTabs.vue`
- `src/components/studio/Vibe64DashboardShell.vue`
- `src/components/SectionContainerShell.vue`
- `src/placement.js`
- `src/pages/app/project/[slug]/dashboard/issues/index.vue`
- `tests/server/githubIssues.unit.test.js`
- `tests/server/vibe64ProjectActions.unit.test.js`

## Public contract

The single Issues/PR menu entry appears only for projects with a GitHub repository.
It sits above session tools, with tabs between the two browsers that preserve URL
filters and selection. Both collapse Dashboard navigation while open. Back to dashboard restores
the ordinary navigation. Open/Closed/All, literal title/body search, selected
labels and list pagination live in the URL; issue details, tabs and browser
history retain those filters when returning. The label selector uses repository
colors and matches every selected label. State and single-label filtering use
GitHub's repository issue connection, loading 25 issues per page even beyond
1,000 issues. Text search and multiple labels use GitHub search with safely
quoted label qualifiers and explain its 1,000-match limit when the result count
exceeds it. Changing any filter returns to the first page.
Descriptions and comments use the existing safe Markdown renderer. The newest
25 comments appear in chronological order, with access to older pages.

GitHub remains the only issue store. Each server request resolves the project's
repository and the acting person's existing GitHub credential context, then uses
the managed execution gateway. Browser input cannot choose a different
repository, account or executable. Hosted project membership uses the existing
project route access gate. GitHub checks every operation, and Close/Reopen also
check current viewer permissions before writing. A pull request number is not
accepted as an issue. No source checkout or active session is required.

Comment submission, Close and Reopen are deliberate native actions. Neither
the server nor the HTTP client retries a write automatically. An uncertain
comment result asks the person to refresh before posting again. Drafts stay in
tab memory by project and issue until posted or cleared; a failed write keeps
the draft. Successful actions refresh the affected cached issue and list.
Load errors stay in the panel; command outcomes use shared action feedback.
After GitHub confirms a comment, the existing project-change channel carries its
issue number, comment id, author login and originating browser tab, without its
contents. Other tabs viewing that project receive the existing shared snackbar
and invalidate the issue and list queries. The posting tab retains its ordinary
success feedback. Hosted delivery uses the existing project read-access gate.
Notification failure cannot turn a successfully posted comment into a failed
write. Notifications are transient and cover comments posted through Vibe64;
there is no inbox, polling or webhook subscription for external GitHub activity.
After changing GitHub issues, comments, labels or PRs, agents run
`vibe64-github refresh`. Session guidance supplies this instruction alongside
the existing managed Git commands. The command uses their authenticated Unix
socket, session generation, stored actor and project access checks. It accepts
no repository or project override and performs no GitHub operation. The existing
project-change event invalidates that project's issue lists, details, label
catalog and PR queries in connected browsers without clearing drafts or filters.
Other projects remain untouched. A failed notification is reported by the command.
New issue opens a title, Markdown description and label form; successful creation
opens the resulting issue. The same dialog edits labels on an existing issue.
Both forms preserve their inputs after failure and use explicit submissions.
An uncertain creation asks the person to refresh the list before retrying.
Repository labels load across every page, retain GitHub names and colors, and
use Vuetify foreground contrast. Labels appear in the list and issue details.
The backend rechecks label permissions and rejects unavailable labels before
writing. Existing issue labels require triage access or higher; GitHub
requires write access to attach labels during issue creation. Empty selections
remove existing labels. Repository label definitions are not changed.
The browser uses the available pane width without the Dashboard frame, with
the same compact Back control as Changes.
Project boards, AI dispatch and automatic closure are not included.
