import { createSchema } from "@jskit-ai/kernel/shared/validators";
import { mainConversationRequestContext } from "./mainConversationAuthority.js";
import { runWithProjectRequestContext } from "@local/vibe64-core/server/projectRequestContext";
import { ACTION_READ_CANONICAL_AGENT_GOAL, ACTION_UPDATE_CANONICAL_AGENT_GOAL } from "@local/vibe64-terminals/server/actions";
import {
  ACTION_INTERRUPT_AGENT_TURN,
  ACTION_READ_CONVERSATION_CONTEXT,
  ACTION_SEND_AGENT_MESSAGE,
  ACTION_UPDATE_ASSISTANT_SELECTION
} from "./actions.js";
import { agentMessageActionInputValidator, assistantSelectionUpdateActionInputValidator } from "./inputSchemas.js";
import { mainConversationTarget, temporaryConversationTarget } from "../shared/conversationIdentity.js";

function withoutFields(schema, excluded) {
  return Object.fromEntries(Object.entries(schema.getFieldDefinitions()).filter(([key]) => !excluded.includes(key)));
}

const messageFields = withoutFields(agentMessageActionInputValidator.schema,
  ["sessionId", "vibe64User", "learningAttemptId", "message", "messageId", "attachmentIds", "submissionKind"]);
const selectionFields = withoutFields(assistantSelectionUpdateActionInputValidator.schema, ["sessionId", "vibe64User", "learningAttemptId"]);
const mainConversationDataSchema = createSchema(messageFields);
const mainConversationSelectionSchema = createSchema(selectionFields);

function unavailable(message = "This Main conversation is unavailable.", code = "conversation_forbidden", statusCode = 403) {
  return Object.assign(new Error(message), { code, statusCode });
}

function pickFields(input, fields) {
  return Object.fromEntries(Object.keys(fields).filter(key => Object.hasOwn(input || {}, key)).map(key => [key, input[key]]));
}

// Main's original browser acknowledges the product operation. A native turn ID
// is not an authored transcript receipt.
function operationResult(result) {
  const fields = { delivered: "boolean", duplicate: "boolean", messageId: "string", deliveryMode: "string",
    code: "string", error: "string", status: "string", interrupted: "boolean", routingCancelled: "boolean",
    operationOutcome: "string", retryable: "boolean", refreshRecommended: "boolean" };
  return { ok: result?.ok !== false,
    ...Object.fromEntries(Object.entries(fields).filter(([key, type]) => typeof result?.[key] === type)
      .map(([key]) => [key, result[key]])) };
}

function createMainBrowserConversations({ actions, terminals } = {}) {
  if (typeof actions?.execute !== "function" || typeof terminals?.openBrowserConversation !== "function") {
    throw new TypeError("Main browser conversations require the original action catalogue and terminal conversation owner.");
  }
  return Object.freeze({
    conversationDataSchema: terminals.temporaryConversationDataSchema ? createSchema({
      ...mainConversationDataSchema.getFieldDefinitions(), ...terminals.temporaryConversationDataSchema.getFieldDefinitions()
    }) : mainConversationDataSchema,
    conversationSelectionSchema: terminals.temporaryConversationSelectionSchema ? createSchema({
      ...terminals.temporaryConversationSelectionSchema.getFieldDefinitions(), ...mainConversationSelectionSchema.getFieldDefinitions()
    }) : mainConversationSelectionSchema,
    async open({ id, context } = {}) {
      const temporary = temporaryConversationTarget(id);
      const target = temporary || mainConversationTarget(id);
      if (!target) throw unavailable();
      const accessTarget = target.learningAttemptId
        ? { learningAttemptId: target.learningAttemptId, sessionId: target.sessionId }
        : { projectSlug: target.projectSlug, sessionId: target.sessionId };
      // Never retain an action contributor's cached authority for a later read,
      // subscription publication or mutation.
      const requestContext = mainConversationRequestContext(context);
      const grant = await actions.execute({ actionId: ACTION_READ_CONVERSATION_CONTEXT, input: accessTarget, context: requestContext });
      const actorId = grant.actor.id;

      async function currentAccess() {
        const current = await actions.execute({ actionId: ACTION_READ_CONVERSATION_CONTEXT, input: accessTarget, context: requestContext });
        if (current.actor.id !== actorId) throw unavailable();
        return current;
      }
      async function withConversation(operation) {
        const current = await currentAccess();
        return runWithProjectRequestContext({ ...current.project, vibe64User: current.user }, async () => {
          const options = {
            vibe64User: current.user,
            browserAuthority: { ...target, actorId, requestContext }
          };
          const conversation = await (temporary ? terminals.openTemporaryBrowserConversation(target.sessionId, target.conversationId, options)
            : terminals.openBrowserConversation(target.sessionId, options));
          return operation(conversation);
        });
      }
      async function execute(actionId, input = {}) {
        await currentAccess();
        return actions.execute({ actionId, input: { ...input, ...target }, context: requestContext });
      }

      return Object.freeze({
        async read(query = {}) {
          const options = { limit: temporary ? "12" : "20" };
          for (const key of ["beforeTurnId", "limit"]) if (Object.hasOwn(query, key)) options[key] = query[key];
          const { configuration: _configuration, ...state } = await withConversation(conversation => conversation.read(options));
          return { ...state, id };
        },
        async send(input) {
          if (temporary) return operationResult(await withConversation(conversation => conversation.send(input)));
          return operationResult(await execute(ACTION_SEND_AGENT_MESSAGE, {
            ...pickFields(input.data, messageFields),
            message: input.text, messageId: input.messageId,
            submissionKind: input.steer === true ? "steer" : "send",
            ...(Object.hasOwn(input, "attachmentIds") ? { attachmentIds: input.attachmentIds } : {})
          }));
        },
        async cancel() { return operationResult(temporary ? await withConversation(conversation => conversation.cancel()) : await execute(ACTION_INTERRUPT_AGENT_TURN)); },
        async select(input) {
          if (temporary) return operationResult(await withConversation(conversation => conversation.select(input)));
          return operationResult(await execute(ACTION_UPDATE_ASSISTANT_SELECTION, pickFields(input, selectionFields)));
        },
        async inspectDelivery(input) { return withConversation(conversation => conversation.inspectDelivery(input)); },
        async readGoal() { return temporary ? withConversation(conversation => conversation.readGoal()) : execute(ACTION_READ_CANONICAL_AGENT_GOAL); },
        async updateGoal(input) { return temporary ? withConversation(conversation => conversation.updateGoal(input)) : execute(ACTION_UPDATE_CANONICAL_AGENT_GOAL, input); },
        async subscribe(listener) {
          if (typeof listener !== "function") throw new TypeError("A conversation listener is required.");
          return withConversation(conversation => conversation.subscribe(event => listener({ ...event, conversationId: id })));
        }
      });
    }
  });
}

export { createMainBrowserConversations };
