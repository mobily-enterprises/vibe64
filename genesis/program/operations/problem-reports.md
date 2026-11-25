# Problem reports

When something goes wrong, a person gathers what the editor saw around it into
one report, reads it whole, and downloads, copies or (with a host that delivers
reports) sends it, because a bug report should carry what happened without
carrying anyone's secrets.

## Sources

- Main: `packages/vibe64-terminals/src/server/problemReport/problemReportService.js`
- `packages/vibe64-core/src/shared/problemReport.js`
- `packages/vibe64-terminals/src/server/problemReport/problemReportSession.js`
- `packages/vibe64-terminals/src/server/problemReport/problemReportHost.js`
- `packages/vibe64-terminals/src/server/problemReport/problemReportActions.js`
- `packages/vibe64-terminals/src/server/problemReport/registerProblemReportRoutes.js`
- `packages/vibe64-terminals/src/server/problemReport/ProblemReportFeature.js`
- `packages/vibe64-terminals/src/server/assistantRoutingTimeline.js`
- `src/composables/useProblemReport.js`
- `src/lib/problemReportClientErrors.js`
- `src/lib/problemReportRequests.js`
- `src/lib/problemReportPresentation.js`
- `src/components/studio/Vibe64ProblemReportHost.vue`
- `src/components/StudioAppShellLayout.vue`
- `tests/server/problemReportCollect.unit.test.js`
- `tests/server/problemReportMasking.unit.test.js`
- `tests/server/assistantRoutingTimeline.unit.test.js`
- `tests/client/problemReport.vitest.js`
- `docs/colleague-usage/report-a-problem.md`

## Public contract

The app's shell (`StudioAppShellLayout`) makes the page's Report a problem once
(`provideProblemReport`) and holds its dialog; it records the errors the page
sees from its mount (window errors, unhandled rejections, and the shell error
runtime's reported errors and warnings), the newest 50. Inside the shell the
Account menu opens it on every page, and a failed routed request and a turn
interruption open it with the chat ticked in; a view that shows a session names
it while shown (`useProblemReportPlace`), the newest such view being the place
a report describes. Outside the shell nothing opens it.

`POST /api/app/:slug/vibe64/problem-report` (a project's page) and
`POST /api/studio/problem-report` (elsewhere) collect a report for the signed-in
person: `vibe64.problem-report.v1` with the place, the six hours before, the
session's turns described but never quoted, its timeline, plan, routed request
state and Preview, the editor's crashes without their messages, versions and
the AI engine, the page's errors, the host's sections, and the main chat's
newest messages only when included. Every string is masked (the project's
Development Env secrets, the host's exact secrets, and key, token, password and
cookie shapes become `[hidden]`) and the bundle is bounded. It is kept as that
person's draft for 30 minutes; `POST /api/studio/problem-report/send` with
`{ draftId, note, consents }` masks the note and hands exactly that draft, with
only the consents the host declared, to the host's `deliver`. None is an
assistant tool.

A host provides `vibe64.problem-reports.host` (`contribute`, `delivery`,
`deliver`); without one, Send is absent and a send is refused 409
`vibe64_problem_report_no_delivery`. Public names no host.

A session's timeline records each routed request delivery that failed and each
automatic next step refused (`routing` events with the error's code), observed
around the routing's delivery without changing what it decides.
