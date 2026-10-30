import assert from "node:assert/strict";
import test from "node:test";

import { createCapabilityHttpRuntime } from "@jskit-ai/kernel/server/http";

import { registerRoutes as registerStudioHealthRoutes } from "../../packages/studio-health/src/server/registerRoutes.js";
import { registerRoutes as registerCurrentAppRoutes } from "../../packages/current-app/src/server/registerRoutes.js";
import { registerRoutes as registerAccountRoutes } from "../../packages/vibe64-accounts/src/server/registerRoutes.js";
import { registerColleagueRoutes } from "../../packages/vibe64-colleague/src/server/Vibe64ColleagueProvider.js";
import { registerRoutes as registerDatabaseRoutes } from "../../packages/vibe64-database-tools/src/server/registerRoutes.js";
import { registerRoutes as registerProjectRoutes } from "../../packages/vibe64-project/src/server/registerRoutes.js";
import { registerRoutes as registerPublishingRoutes } from "../../packages/vibe64-publishing/src/server/registerRoutes.js";
import { registerRoutes as registerSessionRoutes } from "../../packages/vibe64-sessions/src/server/registerRoutes.js";
import { registerRoutes as registerSourceEditorRoutes } from "../../packages/vibe64-source-editor/src/server/registerRoutes.js";
import { registerRoutes as registerSystemGraphRoutes } from "../../packages/vibe64-system-graph/src/server/registerRoutes.js";
import { registerUsageRoutes } from "../../packages/vibe64-system-graph/src/server/usageRoutes.js";
import { registerRoutes as registerTerminalRoutes } from "../../packages/vibe64-terminals/src/server/registerRoutes.js";
import { registerTrainingRoutes } from "../../packages/vibe64-training/src/server/registerRoutes.js";
import { registerTrainingVisualResourceRoutes } from "../../packages/vibe64-training/src/server/visualResourceRoutes.js";
import { registerRoutes as registerUsageRecordingRoutes } from "../../packages/vibe64-usage-recording/src/server/registerRoutes.js";

// Every Vibe64 route as the kernel router records it: method, path, auth,
// surface, body limit and the action it runs. Recorded from the route
// registrations before they moved to createActionRouteScope; a change here is
// a change to the HTTP surface and must be deliberate.
const EXPECTED_ROUTE_TABLE = `

DELETE /api/app/:slug/vibe64/accounts/auth/:sessionId public app - vibe64.accounts.auth-session.cancel
DELETE /api/app/:slug/vibe64/codex-terminal/:terminalSessionId public app - vibe64.terminals.global-terminal.close
DELETE /api/app/:slug/vibe64/database/sessions/:sessionId/snippets/:snippetId public app 16384 vibe64.database.snippet.delete
DELETE /api/app/:slug/vibe64/project-files/:area/file public app 2097152 vibe64.source-editor.file-area.delete
DELETE /api/app/:slug/vibe64/publishing/accounts/:accountId public app 65536 vibe64.publication.account.remove
DELETE /api/app/:slug/vibe64/publishing/confirmation/request public app 65536 vibe64.publication.confirmation.dismiss
DELETE /api/app/:slug/vibe64/publishing/share public app 65536 vibe64.publication.share.stop
DELETE /api/app/:slug/vibe64/publishing/targets/:targetId public app 65536 vibe64.publication.target.remove
DELETE /api/app/:slug/vibe64/sessions/:sessionId/agent-attachments/:attachmentId public app - vibe64.terminals.agent-attachment.delete
DELETE /api/app/:slug/vibe64/sessions/:sessionId/agent-terminal/:terminalSessionId public app - vibe64.terminals.agent-terminal.close
DELETE /api/app/:slug/vibe64/sessions/:sessionId/files/:area/file public app 2097152 vibe64.source-editor.file-area.delete
DELETE /api/app/:slug/vibe64/sessions/:sessionId/output-runs/:terminalSessionId/terminal public app - vibe64.terminals.output-terminal.close
DELETE /api/app/:slug/vibe64/sessions/:sessionId/source-editor/explanations/:explanationId public app 131072 vibe64.source-editor.explanation.delete
DELETE /api/app/:slug/vibe64/sessions/:sessionId/temporary-conversations/:conversationId public app - vibe64.terminals.temporary-conversation.delete
DELETE /api/app/:slug/vibe64/usage-recordings/sessions/:sessionId/:recordingId public app - vibe64.usage-recording.delete
DELETE /api/vibe64/accounts/auth/:sessionId public app - vibe64.accounts.auth-session.cancel
GET /api/app/:slug/studio/current-app public app - vibe64.current-app.read
GET /api/app/:slug/vibe64/accounts public app - vibe64.accounts.read
GET /api/app/:slug/vibe64/accounts/auth/:sessionId public app - vibe64.accounts.auth-session.read
GET /api/app/:slug/vibe64/accounts/codex-providers public app - vibe64.accounts.codex-providers.read
GET /api/app/:slug/vibe64/accounts/model-routing public app - vibe64.accounts.model-routing.read
GET /api/app/:slug/vibe64/assistants/capabilities public app - vibe64.assistants.capabilities.list
GET /api/app/:slug/vibe64/codex-terminal public app - vibe64.terminals.global-terminal.status
GET /api/app/:slug/vibe64/codex-terminal/:terminalSessionId public app - vibe64.terminals.global-terminal.read
GET /api/app/:slug/vibe64/codex-terminal/:terminalSessionId/control/quiet public app - vibe64.terminals.global-terminal.control.snapshot
GET /api/app/:slug/vibe64/codex-terminal/:terminalSessionId/control/snapshot public app - vibe64.terminals.global-terminal.control.snapshot
GET /api/app/:slug/vibe64/database/sessions/:sessionId public app - vibe64.database.state.read
GET /api/app/:slug/vibe64/database/sessions/:sessionId/server public app - vibe64.database.server.check
GET /api/app/:slug/vibe64/env public app - vibe64.project.env.read
GET /api/app/:slug/vibe64/incoming public app - vibe64.repository.incoming.inspect
GET /api/app/:slug/vibe64/incoming/:id public app - vibe64.repository.incoming.review
GET /api/app/:slug/vibe64/issue-labels public app - vibe64.project.issues.labels
GET /api/app/:slug/vibe64/issue-mentions public app - vibe64.project.issues.mentions
GET /api/app/:slug/vibe64/issues public app - vibe64.project.issues.list
GET /api/app/:slug/vibe64/issues/:number public app - vibe64.project.issues.read
GET /api/app/:slug/vibe64/onboarding public app - vibe64.project.onboarding.read
GET /api/app/:slug/vibe64/preview-identities public app - vibe64.project.preview-identities.read
GET /api/app/:slug/vibe64/project-files/:area/archive public app - -
GET /api/app/:slug/vibe64/project-files/:area/download public app - -
GET /api/app/:slug/vibe64/project-files/:area/file public app 2097152 vibe64.source-editor.file-area.file
GET /api/app/:slug/vibe64/project-files/:area/tree public app 2097152 vibe64.source-editor.file-area.tree
GET /api/app/:slug/vibe64/projects public app - vibe64.project.projects.list
GET /api/app/:slug/vibe64/publishing public app 65536 vibe64.publication.state.read
GET /api/app/:slug/vibe64/publishing/release/suggestion public app 65536 vibe64.publication.release.suggest
GET /api/app/:slug/vibe64/publishing/releases public app 65536 vibe64.publication.history.list
GET /api/app/:slug/vibe64/publishing/releases/:releaseId public app 65536 vibe64.publication.release.read
GET /api/app/:slug/vibe64/publishing/releases/:releaseId/logs public app 65536 vibe64.publication.logs.read
GET /api/app/:slug/vibe64/publishing/releases/:releaseId/targets/:targetId/apk public app - -
GET /api/app/:slug/vibe64/publishing/toolchains/android/licence public app 65536 vibe64.publication.toolchain.licence.read
GET /api/app/:slug/vibe64/pull-requests public app - vibe64.project.pull-requests.list
GET /api/app/:slug/vibe64/pull-requests/:number public app - vibe64.project.pull-requests.read
GET /api/app/:slug/vibe64/repository/branches public app - vibe64.project.repository.branches.read
GET /api/app/:slug/vibe64/repository/history public app - vibe64.repository.history.inspect
GET /api/app/:slug/vibe64/repository/history/:commit/diff public app - vibe64.repository.history.diff.inspect
GET /api/app/:slug/vibe64/repository/history/:commit/files public app - vibe64.repository.history.files.inspect
GET /api/app/:slug/vibe64/repository/remote public app - vibe64.project.repository.remote.read
GET /api/app/:slug/vibe64/sessions public app - vibe64.sessions.list
GET /api/app/:slug/vibe64/sessions/:sessionId public app - vibe64.sessions.inspect
GET /api/app/:slug/vibe64/sessions/:sessionId/agent-attachments/:attachmentId public app - -
GET /api/app/:slug/vibe64/sessions/:sessionId/agent-goal public app - vibe64.terminals.agent-goal.read
GET /api/app/:slug/vibe64/sessions/:sessionId/agent-plan-usage public app - vibe64.terminals.agent-plan-usage.read
GET /api/app/:slug/vibe64/sessions/:sessionId/agent-terminal/:terminalSessionId public app - vibe64.terminals.agent-terminal.read
GET /api/app/:slug/vibe64/sessions/:sessionId/agent-terminal/:terminalSessionId/control/quiet public app - vibe64.terminals.agent-terminal.control.snapshot
GET /api/app/:slug/vibe64/sessions/:sessionId/agent-terminal/:terminalSessionId/control/snapshot public app - vibe64.terminals.agent-terminal.control.snapshot
GET /api/app/:slug/vibe64/sessions/:sessionId/assistant-access public app - vibe64.sessions.assistant-access.inspect
GET /api/app/:slug/vibe64/sessions/:sessionId/changes public app - vibe64.sessions.changes.inspect
GET /api/app/:slug/vibe64/sessions/:sessionId/changes/diff public app - vibe64.sessions.changes.diff.inspect
GET /api/app/:slug/vibe64/sessions/:sessionId/connected/replacement public app - vibe64.sessions.connected.replacement.inspect
GET /api/app/:slug/vibe64/sessions/:sessionId/conversation-log public app - vibe64.sessions.conversation-log.read
GET /api/app/:slug/vibe64/sessions/:sessionId/files public app - vibe64.source-editor.file-areas.read
GET /api/app/:slug/vibe64/sessions/:sessionId/files/:area/archive public app - -
GET /api/app/:slug/vibe64/sessions/:sessionId/files/:area/download public app - -
GET /api/app/:slug/vibe64/sessions/:sessionId/files/:area/file public app 2097152 vibe64.source-editor.file-area.file
GET /api/app/:slug/vibe64/sessions/:sessionId/files/:area/tree public app 2097152 vibe64.source-editor.file-area.tree
GET /api/app/:slug/vibe64/sessions/:sessionId/integrations public app - vibe64.source-editor.integrations.read
GET /api/app/:slug/vibe64/sessions/:sessionId/integrations/providers public app - vibe64.source-editor.integrations.providers.read
GET /api/app/:slug/vibe64/sessions/:sessionId/main-chat-approvals public app - vibe64.sessions.main-chat-approvals.read
GET /api/app/:slug/vibe64/sessions/:sessionId/output-results/:resultId public app - -
GET /api/app/:slug/vibe64/sessions/:sessionId/output-runs/:terminalSessionId/terminal public app - vibe64.terminals.output-terminal.read
GET /api/app/:slug/vibe64/sessions/:sessionId/outputs public app - vibe64.terminals.outputs.read
GET /api/app/:slug/vibe64/sessions/:sessionId/renewal public app - vibe64.sessions.renewal.inspect
GET /api/app/:slug/vibe64/sessions/:sessionId/source-editor/changes/stream public app - -
GET /api/app/:slug/vibe64/sessions/:sessionId/source-editor/download public app - -
GET /api/app/:slug/vibe64/sessions/:sessionId/source-editor/file public app - vibe64.source-editor.file.read
GET /api/app/:slug/vibe64/sessions/:sessionId/source-editor/files public app - vibe64.source-editor.files.find
GET /api/app/:slug/vibe64/sessions/:sessionId/source-editor/search public app - vibe64.source-editor.search
GET /api/app/:slug/vibe64/sessions/:sessionId/source-editor/stars public app - vibe64.source-editor.stars.read
GET /api/app/:slug/vibe64/sessions/:sessionId/source-editor/tree public app - vibe64.source-editor.tree.read
GET /api/app/:slug/vibe64/sessions/:sessionId/temporary-conversations public app - vibe64.terminals.temporary-conversation.list
GET /api/app/:slug/vibe64/sessions/:sessionId/temporary-conversations/:conversationId public app - vibe64.terminals.temporary-conversation.read
GET /api/app/:slug/vibe64/sessions/:sessionId/work public app - vibe64.sessions.work.inspect
GET /api/app/:slug/vibe64/sessions/:sessionId/work-plan public app - vibe64.terminals.work-plan.read
GET /api/app/:slug/vibe64/sessions/archived public app - vibe64.sessions.archived.list
GET /api/app/:slug/vibe64/settings public app - vibe64.project.settings.read
GET /api/app/:slug/vibe64/settings/engineering public app - vibe64.project.engineering.read
GET /api/app/:slug/vibe64/system-graph/sessions/:sessionId/architecture public app - vibe64.system-graph.architecture.read
GET /api/app/:slug/vibe64/system-graph/sessions/:sessionId/refresh/status public app - vibe64.system-graph.refresh.status
GET /api/app/:slug/vibe64/system-graph/sessions/:sessionId/status public app - vibe64.system-graph.status.read
GET /api/app/:slug/vibe64/system-graph/sessions/:sessionId/usage/entries public app - vibe64.system-graph.usage.entries.read
GET /api/app/:slug/vibe64/system-graph/sessions/:sessionId/usage/function public app - vibe64.system-graph.usage.function.read
GET /api/app/:slug/vibe64/system-graph/sessions/:sessionId/usage/web public app - vibe64.system-graph.usage.web.read
GET /api/app/:slug/vibe64/usage-recordings/sessions/:sessionId public app - vibe64.usage-recording.list
GET /api/app/:slug/vibe64/usage-recordings/sessions/:sessionId/:recordingId/requests public app - vibe64.usage-recording.requests.read
GET /api/app/:slug/vibe64/usage-recordings/sessions/:sessionId/:recordingId/requests/:requestId/functions public app - vibe64.usage-recording.request-functions.read
GET /api/app/:slug/vibe64/usage-recordings/sessions/:sessionId/current public app - vibe64.usage-recording.current.read
GET /api/app/:slug/vibe64/usage-recordings/sessions/:sessionId/targets public app - vibe64.usage-recording.targets.read
GET /api/studio/health public app - vibe64.studio-health.read
GET /api/studio/health/tools public app - vibe64.studio-health.tools
GET /api/vibe64/accounts public app - vibe64.accounts.read
GET /api/vibe64/accounts/auth/:sessionId public app - vibe64.accounts.auth-session.read
GET /api/vibe64/accounts/codex-providers public app - vibe64.accounts.codex-providers.read
GET /api/vibe64/accounts/model-routing public app - vibe64.accounts.model-routing.read
GET /api/vibe64/colleague public app - vibe64.colleague.state.read
GET /api/vibe64/colleague/conversations/history public app - vibe64.colleague.conversation.history.read
GET /api/vibe64/colleague/conversations/history/page public app - vibe64.colleague.conversation.history-page.read
GET /api/vibe64/colleague/models public app - vibe64.assistants.capabilities.list
GET /api/vibe64/colleague/usage/guide public app - vibe64.colleague.usage.guide.read
GET /api/vibe64/colleague/usage/topics public app - vibe64.colleague.usage.topics.read
GET /api/vibe64/training/attempts/:attemptId/lesson public app - vibe64.training.lesson.read
GET /api/vibe64/training/attempts/:attemptId/visuals/:visualId public app - -
GET /api/vibe64/training/available public app - vibe64.training.available.list
GET /api/vibe64/training/courses public app - vibe64.training.courses.list
GET /api/vibe64/training/learning public app - vibe64.training.learning.read
GET /api/vibe64/training/learning-mode public app - vibe64.training.learning-mode.read
GET /api/vibe64/training/lesson public app - vibe64.training.lesson.read
GET /api/vibe64/training/practice public app - vibe64.training.practice.list
GET /api/vibe64/training/teacher-notes public app - vibe64.training.learner-notes.read
PATCH /api/app/:slug/vibe64/accounts/codex-providers public app - vibe64.accounts.codex-providers.save
PATCH /api/app/:slug/vibe64/accounts/model-routing public app - vibe64.accounts.model-routing.save
PATCH /api/app/:slug/vibe64/accounts/personal-ai-profile public app - vibe64.accounts.personal-ai-profile.save
PATCH /api/app/:slug/vibe64/assistants/model-access public app 8192 vibe64.assistants.model-access.update
PATCH /api/app/:slug/vibe64/database/sessions/:sessionId/cells public app 262144 vibe64.database.cell.update
PATCH /api/app/:slug/vibe64/issues/:number public app - vibe64.project.issues.state
PATCH /api/app/:slug/vibe64/issues/:number/comments/:commentId public app 300000 vibe64.project.issues.edit-comment
PATCH /api/app/:slug/vibe64/publishing/targets/:targetId public app 65536 vibe64.publication.target.update
PATCH /api/app/:slug/vibe64/sessions/:sessionId/assistant-selection public app 32768 vibe64.sessions.assistant-selection.update
PATCH /api/app/:slug/vibe64/sessions/:sessionId/main-chat-approvals/:approvalId public app - vibe64.sessions.main-chat-approvals.edit
PATCH /api/app/:slug/vibe64/sessions/:sessionId/name public app 4096 vibe64.sessions.rename
PATCH /api/app/:slug/vibe64/sessions/:sessionId/pin public app - vibe64.sessions.pin
PATCH /api/app/:slug/vibe64/sessions/:sessionId/renewal/draft public app 262144 vibe64.sessions.renewal.draft.update
PATCH /api/app/:slug/vibe64/sessions/:sessionId/temporary-conversations/:conversationId public app - vibe64.terminals.temporary-conversation.update
PATCH /api/vibe64/accounts/codex-providers public app - vibe64.accounts.codex-providers.save
PATCH /api/vibe64/accounts/model-routing public app - vibe64.accounts.model-routing.save
PATCH /api/vibe64/accounts/personal-ai-profile public app - vibe64.accounts.personal-ai-profile.save
POST /api/app/:slug/vibe64/accounts/auth public app - vibe64.accounts.auth.start
POST /api/app/:slug/vibe64/accounts/codex-providers/remove public app - vibe64.accounts.codex-providers.remove
POST /api/app/:slug/vibe64/accounts/git-identity public app - vibe64.accounts.git-identity.save
POST /api/app/:slug/vibe64/accounts/logout public app - vibe64.accounts.logout
POST /api/app/:slug/vibe64/accounts/model-routing/preview public app - vibe64.accounts.model-routing.preview
POST /api/app/:slug/vibe64/agent-sessions/reconcile public app - vibe64.terminals.agent-sessions.reconcile
POST /api/app/:slug/vibe64/codex-terminal public app - vibe64.terminals.global-terminal.start
POST /api/app/:slug/vibe64/codex-terminal/:terminalSessionId/control/check-text public app - vibe64.terminals.global-terminal.control.check-text
POST /api/app/:slug/vibe64/codex-terminal/:terminalSessionId/control/key public app - vibe64.terminals.global-terminal.control.key
POST /api/app/:slug/vibe64/codex-terminal/:terminalSessionId/control/text public app - vibe64.terminals.global-terminal.control.text
POST /api/app/:slug/vibe64/database/sessions/:sessionId/assistant public app 2097152 vibe64.database.assistant.ask
POST /api/app/:slug/vibe64/database/sessions/:sessionId/lookups/search public app 65536 vibe64.database.lookup.search
POST /api/app/:slug/vibe64/database/sessions/:sessionId/queries public app 786432 vibe64.database.query.run
POST /api/app/:slug/vibe64/database/sessions/:sessionId/queries/:queryId/cancel public app 16384 vibe64.database.query.cancel
POST /api/app/:slug/vibe64/database/sessions/:sessionId/rows public app 524288 vibe64.database.row.insert
POST /api/app/:slug/vibe64/database/sessions/:sessionId/rows/delete public app 262144 vibe64.database.row.delete
POST /api/app/:slug/vibe64/database/sessions/:sessionId/schema/refresh public app 16384 vibe64.database.schema.refresh
POST /api/app/:slug/vibe64/env/download public app - -
POST /api/app/:slug/vibe64/env/reveal public app - -
POST /api/app/:slug/vibe64/incoming/:id public app - vibe64.repository.incoming.change
POST /api/app/:slug/vibe64/issue-labels public app - vibe64.project.issues.create-label
POST /api/app/:slug/vibe64/issues public app 300000 vibe64.project.issues.create
POST /api/app/:slug/vibe64/issues/:number/comments public app 300000 vibe64.project.issues.comment
POST /api/app/:slug/vibe64/project-files/:area/conflicts public app 2097152 vibe64.source-editor.file-area.conflicts
POST /api/app/:slug/vibe64/project-files/:area/directory public app 2097152 vibe64.source-editor.file-area.mkdir
POST /api/app/:slug/vibe64/project-files/:area/file public app 2097152 vibe64.source-editor.file-area.create
POST /api/app/:slug/vibe64/project-files/:area/rename public app 2097152 vibe64.source-editor.file-area.rename
POST /api/app/:slug/vibe64/project-files/:area/transfer public app 2097152 vibe64.source-editor.file-area.transfer
POST /api/app/:slug/vibe64/project-files/:area/upload public app 525336576 -
POST /api/app/:slug/vibe64/project-runtime/close public app - vibe64.terminals.project-runtime.close
POST /api/app/:slug/vibe64/project-runtime/open public app - vibe64.terminals.project-runtime.open
POST /api/app/:slug/vibe64/projects public app - vibe64.project.projects.create
POST /api/app/:slug/vibe64/projects/select public app - vibe64.project.projects.select
POST /api/app/:slug/vibe64/publishing/accounts public app 65536 vibe64.publication.account.add
POST /api/app/:slug/vibe64/publishing/baseline/push public app 65536 vibe64.publication.baseline.push
POST /api/app/:slug/vibe64/publishing/checks public app 65536 vibe64.publication.checks.run
POST /api/app/:slug/vibe64/publishing/confirmation public app 65536 vibe64.publication.confirmation.open
POST /api/app/:slug/vibe64/publishing/dry-run public app 65536 vibe64.publication.dryrun.run
POST /api/app/:slug/vibe64/publishing/keys public app 65536 vibe64.publication.keys.create
POST /api/app/:slug/vibe64/publishing/keys/lock public app 65536 vibe64.publication.keys.lock
POST /api/app/:slug/vibe64/publishing/keys/unlock public app 65536 vibe64.publication.keys.unlock
POST /api/app/:slug/vibe64/publishing/plan public app 65536 vibe64.publication.plan.read
POST /api/app/:slug/vibe64/publishing/recovery-kit public app 65536 vibe64.publication.recovery-kit.create
POST /api/app/:slug/vibe64/publishing/recovery-kit/restore public app 12582912 vibe64.publication.recovery-kit.restore
POST /api/app/:slug/vibe64/publishing/release/prepare public app 65536 vibe64.publication.release.prepare
POST /api/app/:slug/vibe64/publishing/releases public app 65536 vibe64.publication.release.confirm
POST /api/app/:slug/vibe64/publishing/share public app 65536 vibe64.publication.share.start
POST /api/app/:slug/vibe64/publishing/targets public app 65536 vibe64.publication.target.add
POST /api/app/:slug/vibe64/publishing/targets/:targetId/install-key public app 65536 vibe64.publication.install-key.create
POST /api/app/:slug/vibe64/publishing/toolchains/android public app 65536 vibe64.publication.toolchain.android.install
POST /api/app/:slug/vibe64/publishing/toolchains/android/licence public app 65536 vibe64.publication.toolchain.licence.accept
POST /api/app/:slug/vibe64/publishing/toolchains/python public app 65536 vibe64.publication.toolchain.python.install
POST /api/app/:slug/vibe64/pull-requests/:number/merge public app - vibe64.project.pull-requests.merge
POST /api/app/:slug/vibe64/pull-requests/:number/ready public app - vibe64.project.pull-requests.ready
POST /api/app/:slug/vibe64/pull-requests/:number/update-branch public app - vibe64.project.pull-requests.update-branch
POST /api/app/:slug/vibe64/repository/remote public app - vibe64.project.repository.remote
POST /api/app/:slug/vibe64/sessions public app - vibe64.sessions.create
POST /api/app/:slug/vibe64/sessions/:sessionId/agent-attachments public app 525336576 -
POST /api/app/:slug/vibe64/sessions/:sessionId/agent-goal public app - vibe64.terminals.agent-goal.update
POST /api/app/:slug/vibe64/sessions/:sessionId/agent-message public app - vibe64.sessions.agent-message.send
POST /api/app/:slug/vibe64/sessions/:sessionId/agent-session public app - vibe64.terminals.agent-session.prepare
POST /api/app/:slug/vibe64/sessions/:sessionId/agent-terminal public app - vibe64.terminals.agent-terminal.start
POST /api/app/:slug/vibe64/sessions/:sessionId/agent-terminal/:terminalSessionId/control/check-text public app - vibe64.terminals.agent-terminal.control.check-text
POST /api/app/:slug/vibe64/sessions/:sessionId/agent-terminal/:terminalSessionId/control/key public app - vibe64.terminals.agent-terminal.control.key
POST /api/app/:slug/vibe64/sessions/:sessionId/agent-terminal/:terminalSessionId/control/text public app - vibe64.terminals.agent-terminal.control.text
POST /api/app/:slug/vibe64/sessions/:sessionId/agent-turn/interrupt public app - vibe64.sessions.agent-turn.interrupt
POST /api/app/:slug/vibe64/sessions/:sessionId/archive public app - vibe64.sessions.archive
POST /api/app/:slug/vibe64/sessions/:sessionId/connected/prepare public app - vibe64.sessions.connected.prepare
POST /api/app/:slug/vibe64/sessions/:sessionId/connected/replacement public app - vibe64.sessions.connected.replace
POST /api/app/:slug/vibe64/sessions/:sessionId/files/:area/conflicts public app 2097152 vibe64.source-editor.file-area.conflicts
POST /api/app/:slug/vibe64/sessions/:sessionId/files/:area/directory public app 2097152 vibe64.source-editor.file-area.mkdir
POST /api/app/:slug/vibe64/sessions/:sessionId/files/:area/file public app 2097152 vibe64.source-editor.file-area.create
POST /api/app/:slug/vibe64/sessions/:sessionId/files/:area/rename public app 2097152 vibe64.source-editor.file-area.rename
POST /api/app/:slug/vibe64/sessions/:sessionId/files/:area/transfer public app 2097152 vibe64.source-editor.file-area.transfer
POST /api/app/:slug/vibe64/sessions/:sessionId/files/:area/upload public app 525336576 -
POST /api/app/:slug/vibe64/sessions/:sessionId/integration-setup/resume public app - vibe64.sessions.integration-setup.resume
POST /api/app/:slug/vibe64/sessions/:sessionId/integration-setup/skip public app - vibe64.sessions.integration-setup.skip
POST /api/app/:slug/vibe64/sessions/:sessionId/integrations/:integrationId/oauth-client public app 2097152 vibe64.source-editor.integrations.oauth-client.register
POST /api/app/:slug/vibe64/sessions/:sessionId/integrations/:integrationId/setup public app 32768 vibe64.source-editor.integrations.setup
POST /api/app/:slug/vibe64/sessions/:sessionId/integrations/n8n/discovery public app 4096 vibe64.source-editor.integrations.n8n.discover
POST /api/app/:slug/vibe64/sessions/:sessionId/main-chat-approvals/:approvalId/approve public app - vibe64.sessions.main-chat-approvals.approve
POST /api/app/:slug/vibe64/sessions/:sessionId/main-chat-approvals/:approvalId/decline public app - vibe64.sessions.main-chat-approvals.decline
POST /api/app/:slug/vibe64/sessions/:sessionId/main-chat-approvals/:approvalId/withdraw public app - vibe64.sessions.main-chat-approvals.withdraw
POST /api/app/:slug/vibe64/sessions/:sessionId/output-runs public app - vibe64.terminals.output-target.start
POST /api/app/:slug/vibe64/sessions/:sessionId/output-runs/:terminalSessionId/stop public app - vibe64.terminals.output-target.stop
POST /api/app/:slug/vibe64/sessions/:sessionId/output-runs/open public app - vibe64.terminals.output-target.open
POST /api/app/:slug/vibe64/sessions/:sessionId/presence public app 4096 vibe64.sessions.presence.update
POST /api/app/:slug/vibe64/sessions/:sessionId/preview-diagnostics public app - vibe64.terminals.preview-diagnostics.record
POST /api/app/:slug/vibe64/sessions/:sessionId/preview-identity public app - vibe64.terminals.preview-identity.select
POST /api/app/:slug/vibe64/sessions/:sessionId/preview-state public app - vibe64.sessions.preview-state.broadcast
POST /api/app/:slug/vibe64/sessions/:sessionId/prompt-hints public app - vibe64.terminals.prompt-hints.generate
POST /api/app/:slug/vibe64/sessions/:sessionId/prompt-hints/cancel public app - vibe64.terminals.prompt-hints.cancel
POST /api/app/:slug/vibe64/sessions/:sessionId/pull-request public app 300000 vibe64.sessions.pull-request.create
POST /api/app/:slug/vibe64/sessions/:sessionId/renewal/cancel public app 32768 vibe64.sessions.renewal.cancel
POST /api/app/:slug/vibe64/sessions/:sessionId/renewal/confirm public app 32768 vibe64.sessions.renewal.confirm
POST /api/app/:slug/vibe64/sessions/:sessionId/renewal/draft public app 32768 vibe64.sessions.renewal.draft.request
POST /api/app/:slug/vibe64/sessions/:sessionId/renewal/retry public app 32768 vibe64.sessions.renewal.retry
POST /api/app/:slug/vibe64/sessions/:sessionId/save public app - vibe64.sessions.work.save
POST /api/app/:slug/vibe64/sessions/:sessionId/source-editor/explanations/:explanationId/followups/stream public app 131072 -
POST /api/app/:slug/vibe64/sessions/:sessionId/source-editor/explanations/:explanationId/stop public app 131072 vibe64.source-editor.explanation.stop
POST /api/app/:slug/vibe64/sessions/:sessionId/source-editor/explanations/cleanup public app 16384 vibe64.source-editor.explanations.cleanup
POST /api/app/:slug/vibe64/sessions/:sessionId/source-editor/explanations/stream public app 262144 -
POST /api/app/:slug/vibe64/sessions/:sessionId/source-editor/file public app 32768 vibe64.source-editor.file.create
POST /api/app/:slug/vibe64/sessions/:sessionId/source-editor/resolve-path public app 32768 vibe64.source-editor.path.resolve
POST /api/app/:slug/vibe64/sessions/:sessionId/source-editor/stars public app 16384 vibe64.source-editor.star.set
POST /api/app/:slug/vibe64/sessions/:sessionId/temporary-conversations public app - vibe64.terminals.temporary-conversation.create
POST /api/app/:slug/vibe64/sessions/:sessionId/temporary-conversations/:conversationId/stop public app - vibe64.terminals.temporary-conversation.stop
POST /api/app/:slug/vibe64/sessions/:sessionId/temporary-conversations/:conversationId/turns public app - vibe64.terminals.temporary-conversation.turn.start
POST /api/app/:slug/vibe64/sessions/:sessionId/updates/apply public app - vibe64.sessions.updates.apply
POST /api/app/:slug/vibe64/sessions/:sessionId/updates/check public app - vibe64.sessions.updates.check
POST /api/app/:slug/vibe64/sessions/:sessionId/work-plan/archive public app - vibe64.terminals.work-plan.archive
POST /api/app/:slug/vibe64/sessions/:sessionId/work-plan/restore public app - vibe64.terminals.work-plan.restore
POST /api/app/:slug/vibe64/sessions/:sessionId/workspace-setup/retry public app - vibe64.sessions.workspace-setup.retry
POST /api/app/:slug/vibe64/system-graph/sessions/:sessionId/refresh public app 16384 vibe64.system-graph.refresh
POST /api/app/:slug/vibe64/system-graph/sessions/:sessionId/refresh/cancel public app 16384 vibe64.system-graph.refresh.cancel
POST /api/app/:slug/vibe64/system-graph/sessions/:sessionId/usage/join public app 1048576 vibe64.system-graph.usage.join
POST /api/app/:slug/vibe64/templates/apply public app - vibe64.project.templates.apply
POST /api/app/:slug/vibe64/usage-recordings/sessions/:sessionId public app 16384 vibe64.usage-recording.start
POST /api/app/:slug/vibe64/usage-recordings/sessions/:sessionId/:recordingId/dismiss public app 16384 vibe64.usage-recording.dismiss
POST /api/app/:slug/vibe64/usage-recordings/sessions/:sessionId/:recordingId/interactions public app 16384 vibe64.usage-recording.interaction.record
POST /api/app/:slug/vibe64/usage-recordings/sessions/:sessionId/:recordingId/stop public app 16384 vibe64.usage-recording.stop
POST /api/vibe64/accounts/auth public app - vibe64.accounts.auth.start
POST /api/vibe64/accounts/codex-providers/remove public app - vibe64.accounts.codex-providers.remove
POST /api/vibe64/accounts/git-identity public app - vibe64.accounts.git-identity.save
POST /api/vibe64/accounts/logout public app - vibe64.accounts.logout
POST /api/vibe64/accounts/model-routing/preview public app - vibe64.accounts.model-routing.preview
POST /api/vibe64/colleague/conversations/fresh public app - vibe64.colleague.conversation.start-fresh
POST /api/vibe64/colleague/focus public app - vibe64.colleague.focus.update
POST /api/vibe64/colleague/messages public app - vibe64.colleague.message.send
POST /api/vibe64/colleague/navigation/ack public app - vibe64.colleague.navigation.acknowledge
POST /api/vibe64/colleague/stop public app - vibe64.colleague.turn.stop
POST /api/vibe64/colleague/watches/cancel public app - vibe64.colleague.watch.cancel
POST /api/vibe64/colleague/watches/pause public app - vibe64.colleague.watch.pause
POST /api/vibe64/colleague/watches/resume public app - vibe64.colleague.watch.resume
POST /api/vibe64/training/archives/:attemptId/delete public app 8192 vibe64.training.practice.archived.delete
POST /api/vibe64/training/attempts/:attemptId/delete public app 8192 vibe64.training.lesson.delete
POST /api/vibe64/training/attempts/:attemptId/finish public app 8192 vibe64.training.lesson.finish
POST /api/vibe64/training/attempts/:attemptId/reader public app 8192 vibe64.training.reader.save
POST /api/vibe64/training/attempts/:attemptId/restart public app 8192 vibe64.training.lesson.restart
POST /api/vibe64/training/attempts/:attemptId/resume public app 8192 vibe64.training.lesson.resume
POST /api/vibe64/training/attempts/:attemptId/steps/answer public app 8192 vibe64.training.step.answer
POST /api/vibe64/training/attempts/:attemptId/steps/check public app 8192 vibe64.training.step.check.run
POST /api/vibe64/training/attempts/:attemptId/steps/done public app 8192 vibe64.training.step.done
POST /api/vibe64/training/attempts/:attemptId/steps/observe public app 8192 vibe64.training.step.observe
POST /api/vibe64/training/attempts/:attemptId/steps/review public app 8192 vibe64.training.step.review.run
POST /api/vibe64/training/courses public app 8192 vibe64.training.courses.create
POST /api/vibe64/training/courses/install public app 8192 vibe64.training.course.install
POST /api/vibe64/training/learning-mode public app 8192 vibe64.training.learning-mode.set
POST /api/vibe64/training/lessons/start public app 8192 vibe64.training.lesson.start
POST /api/vibe64/training/teacher-notes public app 32768 vibe64.training.learner-notes.update
POST /api/vibe64/training/teacher-notes/clear public app 8192 vibe64.training.learner-notes.clear
PUT /api/app/:slug/vibe64/database/sessions/:sessionId/layout public app 4210688 vibe64.database.layout.save
PUT /api/app/:slug/vibe64/database/sessions/:sessionId/overview public app 524288 vibe64.database.overview.save
PUT /api/app/:slug/vibe64/database/sessions/:sessionId/snippets public app 786432 vibe64.database.snippet.save
PUT /api/app/:slug/vibe64/env/user-values public app - vibe64.project.env.user-values.save
PUT /api/app/:slug/vibe64/issues/:number public app 300000 vibe64.project.issues.edit
PUT /api/app/:slug/vibe64/issues/:number/labels public app - vibe64.project.issues.set-labels
PUT /api/app/:slug/vibe64/preview-identities public app - vibe64.project.preview-identities.save
PUT /api/app/:slug/vibe64/project-files/:area/file public app 2097152 vibe64.source-editor.file-area.save
PUT /api/app/:slug/vibe64/repository/workflow public app - vibe64.project.repository.workflow.save
PUT /api/app/:slug/vibe64/sessions/:sessionId/files/:area/file public app 2097152 vibe64.source-editor.file-area.save
PUT /api/app/:slug/vibe64/sessions/:sessionId/integrations public app 2097152 vibe64.source-editor.integrations.save
PUT /api/app/:slug/vibe64/sessions/:sessionId/source-editor/file public app 2097152 vibe64.source-editor.file.save
PUT /api/app/:slug/vibe64/sessions/current public app - vibe64.sessions.current.update
PUT /api/app/:slug/vibe64/settings/collaboration public app - vibe64.project.collaboration.save
PUT /api/app/:slug/vibe64/settings/connections public app - vibe64.project.connections.save
PUT /api/app/:slug/vibe64/settings/development-database public app - vibe64.project.development-database.scope.save
PUT /api/app/:slug/vibe64/settings/engineering public app - vibe64.project.engineering.profile.save
PUT /api/app/:slug/vibe64/settings/prompt-hints public app - vibe64.project.prompt-hints.save
`.trim().split("\n");

function routeTable() {
  const http = createCapabilityHttpRuntime({ fastify: { route() {} }, actions: { registerContextContributor() {} } });
  const fastify = { get() {} };
  registerStudioHealthRoutes(http);
  registerCurrentAppRoutes(http);
  registerAccountRoutes(http, { accounts: { subscribeAuthTerminal() {} }, fastify });
  registerColleagueRoutes(http);
  registerDatabaseRoutes(http);
  registerProjectRoutes(http);
  registerPublishingRoutes(http, { publishing: {} });
  registerSessionRoutes(http);
  registerSourceEditorRoutes(http, { sourceEditor: { readTree() {} } });
  registerSystemGraphRoutes(http);
  registerUsageRoutes(http);
  registerTerminalRoutes(http, { fastify, terminals: {}, uploads: { readSingleMultipartFile() {} } });
  registerTrainingRoutes(http);
  registerTrainingVisualResourceRoutes(http);
  registerUsageRecordingRoutes(http);
  return http.router.list().map((route) => [
    route.method, route.path, route.auth, route.surface, route.bodyLimit ?? "-", route.actionId || "-"
  ].join(" ")).sort();
}

test("Vibe64's route table is the recorded one, with the action each route runs", () => {
  const actual = routeTable();
  assert.deepEqual(actual.filter((line) => !EXPECTED_ROUTE_TABLE.includes(line)), [], "routes not in the recorded table");
  assert.deepEqual(EXPECTED_ROUTE_TABLE.filter((line) => !actual.includes(line)), [], "recorded routes no longer registered");
  assert.deepEqual(actual, EXPECTED_ROUTE_TABLE);
});
