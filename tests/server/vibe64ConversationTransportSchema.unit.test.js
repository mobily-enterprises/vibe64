import assert from "node:assert/strict";
import test from "node:test";
import { createSchema } from "@jskit-ai/kernel/shared/validators";
import { conversationTransportSchema } from "../../packages/vibe64-sessions/src/server/conversationTransportSchema.js";
import { createMainBrowserConversations } from "../../packages/vibe64-sessions/src/server/mainBrowserConversations.js";
import { temporaryConversationUpdateInputValidator } from "../../packages/vibe64-terminals/src/server/inputSchemas.js";
import { colleagueConversationSelectionSchema } from "../../packages/vibe64-colleague/src/server/actions.js";

const selectBody = (schema) => createSchema({ selection: { type: "object", required: true, schema } });

function facade() {
  const temporary = temporaryConversationUpdateInputValidator.schema.getFieldDefinitions();
  return createMainBrowserConversations({ actions: { execute() {} }, terminals: { openBrowserConversation() {},
    temporaryConversationSelectionSchema: createSchema({ agentSettings: temporary.agentSettings, assistantRouting: temporary.assistantRouting })
  } });
}

test("the shared selection transport accepts both Main's and a temporary chat's routing", async () => {
  const body = selectBody(facade().conversationSelectionSchema);
  for (const assistantRouting of [{ mode: "fix" }, { mode: "auto", review: true, autoSave: false }, { mode: "junior" }]) {
    const { errors } = await body.create({ selection: { assistantRouting } });
    assert.deepEqual(errors, {}, JSON.stringify(assistantRouting));
  }
  const { errors } = await body.create({ selection: { assistantRouting: { mode: "elsewhere" } } });
  assert.notDeepEqual(errors, {});
});

test("Colleague's open selection joins Main's without replacing its routing", async () => {
  const fields = conversationTransportSchema([facade().conversationSelectionSchema, colleagueConversationSelectionSchema])
    .getFieldDefinitions();
  assert.deepEqual([...fields.assistantRouting.schema.getFieldDefinitions().mode.enum].sort(),
    ["auto", "custom", "fix", "junior", "senior"]);
  assert.equal(fields.assistantSelection.additionalProperties, true);
  assert.equal(fields.assistantSelection.required, false);
});

test("a field is required only where every product requires it", () => {
  const fields = conversationTransportSchema([
    createSchema({ clientId: { type: "string", maxLength: 64, required: true }, only: { type: "string", required: true } }),
    createSchema({ clientId: { type: "string", maxLength: 128, minLength: 1, required: true } })
  ]).getFieldDefinitions();
  assert.deepEqual(fields.clientId, { type: "string", maxLength: 128, required: true });
  assert.equal(fields.only.required, false);
});

test("two products declaring one field incompatibly are refused at setup", () => {
  assert.throws(() => conversationTransportSchema([
    createSchema({ focus: { type: "string", required: false } }),
    createSchema({ focus: { type: "object", required: false } })
  ]), /declare "focus" differently/u);
  assert.throws(() => conversationTransportSchema([
    createSchema({ id: { type: "string", pattern: "^a$", required: false } }),
    createSchema({ id: { type: "string", pattern: "^b$", required: false } })
  ]), /declare "id" differently/u);
});
