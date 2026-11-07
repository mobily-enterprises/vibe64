import assert from "node:assert/strict";
import test from "node:test";
import { createActionCatalogue } from "@jskit-ai/kernel/server/actions";
import { createSchema } from "@jskit-ai/kernel/shared/validators";
import { CONTEXT_IDENTITY_FIELDS, WORKSPACE_OPERATION, createVibe64ActionPolicy } from "@local/vibe64-core/server/actionContext";
import { VIBE64_COMMAND } from "@local/vibe64-core/shared/actionFields";
import { createCurrentAppActions } from "../../packages/current-app/src/server/currentAppActions.js";
import { createStudioHealthActions } from "../../packages/studio-health/src/server/studioHealthActions.js";
import { createAccountsActions, createAiConnectionActions } from "../../packages/vibe64-accounts/src/server/accountsActions.js";
import { createAiTaskActions } from "../../packages/vibe64-ai-tasks/src/server/aiTaskActions.js";
import { NO_HOST_PANES } from "../../packages/vibe64-colleague/src/shared/navigationPanes.js";
import { createColleagueActions } from "../../packages/vibe64-colleague/src/server/colleagueActions.js";
import { createColleagueUsageKnowledge } from "../../packages/vibe64-colleague/src/server/usageKnowledge.js";
import { createDatabaseActions } from "../../packages/vibe64-database-tools/src/server/databaseActions.js";
import { createPagesActions } from "../../packages/vibe64-pages/src/server/pagesActions.js";
import { createProjectActions } from "../../packages/vibe64-project/src/server/projectActions.js";
import { createPublishingActions } from "../../packages/vibe64-publishing/src/server/publishingActions.js";
import { createProjectWatchActions, createSessionActions } from "../../packages/vibe64-sessions/src/server/sessionActions.js";
import { createSourceEditorActions } from "../../packages/vibe64-source-editor/src/server/sourceEditorActions.js";
import { createSystemGraphActions } from "../../packages/vibe64-system-graph/src/server/systemGraphActions.js";
import { createTerminalActions } from "../../packages/vibe64-terminals/src/server/terminalActions.js";
import { createTrainingLearnerNotesActions } from "../../packages/vibe64-training/src/server/learnerNotesActions.js";
import { createTrainingStepActions } from "../../packages/vibe64-training/src/server/stepActions.js";
import { createTrainingActions } from "../../packages/vibe64-training/src/server/trainingActions.js";
import { createTrainingVisualResourceActions } from "../../packages/vibe64-training/src/server/visualResourceActions.js";
import { createUsageRecordingActions } from "../../packages/vibe64-usage-recording/src/server/usageRecordingActions.js";
import { createVoiceActions } from "../../packages/vibe64-voice/src/server/voiceActions.js";

// A stand-in for any feature's service: every property and call answers another
// one, it iterates as empty and prints as "", so a creator builds its
// definitions without a running feature. No action is executed here.
function anyService() {
  return new Proxy(() => {}, {
    get(_target, key) {
      if (key === "then") return undefined;
      if (key === Symbol.toPrimitive) return () => "";
      if (key === Symbol.iterator) return function* empty() {};
      return anyService();
    },
    apply: () => anyService()
  });
}

// Every action creator a Vibe64 feature registers in the application's catalogue,
// as each feature's actions hook (and the accounts setup) calls it.
const ACTION_CREATORS = Object.freeze({
  currentApp: () => createCurrentAppActions({ currentApp: anyService() }),
  studioHealth: () => createStudioHealthActions({ studioHealth: anyService() }),
  accounts: () => createAccountsActions({ accounts: anyService() }),
  aiConnections: () => createAiConnectionActions({ managedAiConnections: anyService() }),
  aiTasks: () => createAiTaskActions({ aiTasks: anyService() }),
  colleague: () => createColleagueActions({ colleague: anyService(), usage: createColleagueUsageKnowledge(), navigationPanes: NO_HOST_PANES }),
  database: () => createDatabaseActions({ databaseTools: anyService() }),
  pages: () => createPagesActions({ pages: anyService() }),
  project: () => createProjectActions({ project: anyService() }),
  publishing: () => createPublishingActions({ publishing: anyService() }),
  sessions: () => createSessionActions({ sessions: anyService() }),
  projectWatch: () => createProjectWatchActions({ repositoryUpdates: anyService() }),
  sourceEditor: () => createSourceEditorActions({ sourceEditor: anyService() }),
  systemGraph: () => createSystemGraphActions({ systemGraph: anyService() }),
  terminals: () => createTerminalActions({ terminals: anyService() }),
  training: () => createTrainingActions({ operations: anyService() }),
  trainingSteps: () => createTrainingStepActions({ stepOperations: anyService() }),
  trainingLearnerNotes: () => createTrainingLearnerNotesActions({ learnerNotes: anyService() }),
  trainingVisuals: () => createTrainingVisualResourceActions({ lessonVisuals: anyService() }),
  usageRecording: () => createUsageRecordingActions({ usageRecording: anyService() }),
  voice: () => createVoiceActions({ voice: anyService() })
});

function declaredFields(input) {
  return input?.schema?.getFieldDefinitions?.() || {};
}

test("every registered action that declares an identity the context sets carries the Vibe64 scope that strips and sets it", () => {
  const policy = createVibe64ActionPolicy({ localhostCheckBypassed: false });
  let declaring = 0;
  for (const [creator, create] of Object.entries(ACTION_CREATORS)) {
    const definitions = create();
    assert.ok(definitions.length > 0, creator);
    for (const definition of definitions) {
      const fields = declaredFields(definition.input);
      for (const field of CONTEXT_IDENTITY_FIELDS.filter((name) => Object.hasOwn(fields, name))) {
        declaring += 1;
        assert.ok(definition.extensions?.vibe64,
          `${definition.id} (${creator}) declares ${field} without extensions.vibe64, so a caller could supply it.`);
      }
      const registered = definition.input?.schema ? policy.input(definition) : definition.input;
      for (const field of CONTEXT_IDENTITY_FIELDS) {
        assert.equal(Object.hasOwn(declaredFields(registered), field), false,
          `${definition.id} (${creator}) is registered with an input that accepts ${field}.`);
      }
    }
  }
  // The walk reaches the actions that do take the signed-in person from the context.
  assert.ok(declaring > 0);
});

test("the action policy refuses to register an action that declares vibe64User without the Vibe64 scope", () => {
  const policy = createVibe64ActionPolicy({ localhostCheckBypassed: false });
  const input = Object.freeze({
    schema: createSchema({
      vibe64User: { type: "object", additionalProperties: true, required: false },
      note: { type: "string", required: false }
    }),
    mode: "create"
  });
  const unscoped = Object.freeze({
    ...VIBE64_COMMAND,
    id: "example.unscoped.identity",
    input,
    extensions: {},
    execute: (value) => value
  });
  assert.throws(() => policy.input(unscoped), { name: "TypeError", message: /example\.unscoped\.identity declares vibe64User/ });
  const actions = createActionCatalogue({ policy });
  assert.throws(() => actions.register({ contributorId: "example", domain: "example", actions: [unscoped] }), /vibe64User/);

  const scoped = { ...unscoped, id: "example.scoped.identity", extensions: { vibe64: WORKSPACE_OPERATION } };
  const registered = declaredFields(policy.input(scoped));
  assert.equal(Object.hasOwn(registered, "vibe64User"), false);
  assert.equal(Object.hasOwn(registered, "note"), true);

  const plain = { ...unscoped, id: "example.plain", input: { schema: createSchema({ note: { type: "string", required: false } }), mode: "create" } };
  assert.equal(policy.input(plain), plain.input);
});
