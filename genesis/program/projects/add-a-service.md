# Add a service

People add a database, Redis, a files bucket or another App Service to a project
in one of their sessions. Vibe64 writes the declaration through Genesis's own
`stack add`, with the catalogue piece the session's Stack calls for, and the
`add-service` AI task then connects the app to it and proves it in that session.

## Sources

- Main: `packages/vibe64-project/src/server/stackServices.js`
- `packages/vibe64-project/src/server/service.js`
- `packages/vibe64-project/src/server/projectActions.js`
- `packages/vibe64-project/src/server/inputSchemas.js`
- `packages/vibe64-project/src/server/registerRoutes.js`
- `packages/vibe64-genesis/src/server/index.js`
- `packages/vibe64-genesis/src/shared/deploymentServiceNames.js`
- `packages/vibe64-ai-tasks/src/server/kinds/addService.js`
- `packages/vibe64-terminals/src/server/serviceSessionTerminals.js`
- `src/composables/useVibe64StackServices.js`
- `src/components/studio/Vibe64AddServiceDialog.vue`
- `packages/vibe64-training/src/shared/learningVocabulary.js`
- `tests/server/vibe64StackServices.unit.test.js`
- `tests/server/aiTaskAddService.unit.test.js`
- `tests/client/addServiceDialog.vitest.js`
- `tests/server/vibe64LearningVocabulary.unit.test.js`

## Public contract

`GET <project>/vibe64/sessions/:sessionId/stack/service-choices`
(`vibe64.project.stack.services.read`) answers `{ ok, sessionId, stackHash,
managed, choices }`. `managed` says whether a host provides the session's
resources (otherwise the person's own servers, from Env). `choices` holds one row
per kind in order: `postgresql`, `mysql`, `redis`, `bucket`, then `service`. A
resource row is `{ kind, piece, resourceId, bindings, alternatives, present,
needsAi, refused }`:

- `piece` is the catalogue piece (`listGenesisStackPieces`, Genesis's
  `listStackPieces` with each piece's `resourceDeclarations`) that declares a
  resource of the kind, whose Requires are all selected or are the kind's own
  piece (which Genesis adds with it), and that nothing selected conflicts with,
  in either direction. The one that builds on the most selected components wins.
  A tie or no candidate names none, and so does a selected piece whose resource
  the project no longer declares (`stack add` would add nothing). Public Vibe64
  names no framework: the catalogue's Requires decide.
- `bindings` are the preferred alternative's Env names, and `alternatives` the
  others', from the declared resource when `present`, else from the piece.
- `refused` says why it can't be added. Already declared:
  `Already added: <id> (<kind>)`. Another database declared:
  `A project has one database: this one has <id> (<kind>)`. The resource id
  declared with another kind. A conflicting piece. `needsAi` is true for a row
  that can be added but has no piece.

The `service` row adds `services` (`[{ id, exposure }]`, from
`inspectVibe64Deployment`). It is refused when the Deployment does not parse
(`The Deployment does not parse: …`), is unconfigured, or already has
`DEPLOYMENT_SERVICES_MAX` services.

`POST <project>/vibe64/sessions/:sessionId/stack/services`
(`vibe64.project.stack.services.add`) takes `{ kind }`, or `{ kind: "service",
serviceId, reachedBy? }`. It holds the session's agent-write lock and then the
project source lock. Inside them it refuses while the session is closed, its
agent's turn runs, an AI task is active (`vibe64_ai_task_active`, naming the
task) or Workspace setup runs (`vibe64_workspace_setup_running`). It re-reads the
choices and refuses a refused row (`vibe64_stack_service_refused`, 409). For a
row with a piece it runs `addGenesisStack({ projectRoot, pieces: [piece] })`;
Genesis's `STACK_RESOURCE_CONFLICT` becomes the same refusal with Genesis's own
message. It answers `{ ok, added: { component, id, kind, bindings, alternatives },
needsAi: false, aiTask, changedFiles, preparationPrompt, stackHash }`. For a row
without a piece, a piece that added no resource, or another App Service,
nothing is written and it answers `{ ok, added: null,
needsAi: true, aiTask }`.

`aiTask` is `{ kind: "add-service", input }`: `{ kind, resourceId }`, or
`{ kind: "service", serviceId, exposure: "internal", reachedBy? }`. A service id
follows the Deployment grammar (`DEPLOYMENT_SERVICE_ID`, shared with the form),
is not already declared, and `reachedBy` names a declared service.

Both actions are project operations for any member, excluded from the assistant
(`NOT_A_TOOL`). The routes declare no schema of their own, so the person's access
is decided before the action validates the input. The URL names the session; a
body's `sessionId` and `vibe64User` are never taken. Status: 404 for an unknown
session, 409 for a busy or refused one, 400 otherwise.

## The add-service AI task

The kind (`kinds/addService.js`) re-reads the choices to build its problem. It
refuses an unknown kind (400), a refused row (409), and a row with a piece whose
resource is not declared yet (`vibe64_ai_task_no_problem`). The brief names the
declared resource, its component and the Env names the app receives. A kind
without a piece opens with the `json genesis-resource` block to declare. It asks
for the framework's own client and, for a database, its migrations and an
idempotent seed, with preparation declared only as the app's own commands. A
bucket's brief says `genesis verify` reports its values missing until the person
enters them. The AI never changes the declaration, never writes a value into a
file, and never commits, pushes or saves.

A resource's check confirms the declaration, runs `sessions.retryWorkspaceSetup`
as the starter (judged by `setupCheckResult`), then calls
`terminals.restartPreviewAfterSetup(sessionId, { finishedAt, signal })`. That
restarts a running web Preview started before preparation finished, the same
restart preparation fires by itself and serialized with it under the launch start
lock, and waits for readiness. A Preview that isn't running stays stopped and the
check passes. A service's check reads the Deployment back: it passes once the
Deployment declares the service, and otherwise returns the row's refusal or
"declares no service yet". Failures return to the same conversation up to three
times.

## The dialog

`Vibe64AddServiceDialog.vue` takes `projectSlug`, `projectName`, the open
`sessions` (`{ sessionId, label }`) and the `sessionId` to start with. It also
takes a host's `refusals` by kind, and optionally `request` and
`startTask(sessionId, { kind, input })`. A host whose AI task window is open for
that session starts the task there; otherwise the dialog posts the task itself.
It emits `added` (`{ sessionId, added, needsAi, task }`) and `open-session`.
Slots `price` (the Production line, shown only when filled), `preview` and `note`
each receive the row as `choice`. A disabled row names its reason through
`aria-describedby`. A bucket row warns that `genesis verify` stays blocked until
its settings are in Env. After Add, the rows are read again.

The button that opens the dialog is the host's, on a page the host adds. The host
marks it `data-vibe64-guide="add-service"` and registers Colleague's and lessons'
`add-service` place with `addServicePlace(page)`
(`@local/vibe64-training/shared/learning-vocabulary`). `page` is `{ id, label,
pane }`: the page's guide id and pane, and its name as its Dashboard link shows
it. The ring follows Dashboard, that page, then **Add a service**. Public alone
registers no such place, so `navigation.guide` refuses `add-service` there and
lists the places it has.

There is no Remove: a person or the AI deletes the declaration and the app's use
of it in a session.
