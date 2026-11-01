import { createSchema } from "@jskit-ai/kernel/shared/validators";
import { guideReceipt, presentationClientId } from "@local/vibe64-training/shared/presentation-schemas";
import { TRAINING_GUIDE_CAPTION_LIMIT } from "@local/vibe64-training/shared/learning-vocabulary";
import { maxGuideCharacters } from "./usageKnowledge.js";

// The schemas of Colleague's actions: their field builders, inputs and the outputs the assistant reads.

const text = { type: "string", noTrim: false, maxLength: 256, required: false };
const integrationId = { ...text, noTrim: true, minLength: 1, maxLength: 200 };
const integrationEnvironment = { type: "string", required: false, enum: ["development", "production"] };
const databaseView = { type: "string", required: false, enum: ["overview", "erd", "data"] };
const databaseTable = { ...text, noTrim: true, minLength: 1 };
const planView = { type: "string", required: false, enum: ["default", "current", "history"] };
const learningAttemptId = {
  ...text,
  maxLength: 36,
  pattern: "^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$"
};
const learningStepId = { ...text, noTrim: true, minLength: 1, maxLength: 64 };
// Learn mode: open or close the Courses catalogue (the project menu beside L),
// keeping its state ({ open }), or show one step of the current lesson in the
// Learn page's Lesson pane ({ attemptId, stepId? }, no open).
const learningPanel = {
  type: "object",
  required: false,
  schema: createSchema({
    open: { type: "boolean", required: false },
    attemptId: learningAttemptId,
    stepId: learningStepId
  })
};
// One place of this installation's learning vocabulary (public's built-ins and
// the places its host registers); the server validates it through
// trainingGuideRequest, whose refusal lists the places available here.
const guideFields = {
  target: { type: "string", required: true, minLength: 1, maxLength: 64 },
  navigate: { type: "boolean", required: false },
  highlight: { type: "boolean", required: false },
  filePath: { ...text, noTrim: true, minLength: 1, maxLength: 512 },
  caption: { ...text, minLength: 1, maxLength: TRAINING_GUIDE_CAPTION_LIMIT }
};
const focusSchema = createSchema({
  ...Object.fromEntries(["projectSlug", "sessionId", "conversationId", "pane", "route"].map((key) => [key, text])),
  integrationId,
  databaseView,
  databaseTable,
  planView: { ...planView, enum: ["current", "history"] },
  databaseScreen: { type: "string", required: false, enum: ["workspace", "loading", "unavailable"] },
  integrationEnvironment,
  integrationDirty: { type: "boolean", required: false },
  previewScreen: {
    type: "string",
    required: false,
    enum: ["existing-project-setup", "new-project-setup", "checking-project-setup", "outputs", "outputs-with-setup-warning"]
  },
  learningAttemptId,
  learningOpen: { type: "boolean", required: false },
  learningSurface: { type: "string", required: false, enum: ["courses", "progress", "archived"] },
  learningStepId,
  // The lesson step bar's current beat (0-based) on a step with beats.
  learningBeat: { type: "integer", required: false, min: 0, max: 8 }
});
const focusField = { type: "object", schema: focusSchema, required: false };
const navigationOutput = {
  mode: "replace",
  schema: createSchema({
    ok: { type: "boolean", required: true },
    error: { ...text, maxLength: 2000 },
    focus: focusField,
    guide: guideReceipt
  })
};
const clientId = presentationClientId;
const modelSelectionFields = {
  assistantSelection: { type: "object", additionalProperties: true, required: false }
};
const watchFields = {
  watchId: clientId,
  projectSlug: { ...text, required: true },
  sessionId: { ...text, required: true },
  conversationId: text,
  condition: { type: "string", enum: ["reply", "finished", "attention"], required: true },
  question: { ...text, maxLength: 1000, required: true },
  once: { type: "boolean", required: false }
};
// A registered state source's watch (watchSources.js): its source, that
// source's input and one of its conditions.
const sourceWatchFields = {
  watchId: clientId,
  source: { ...text, minLength: 1, maxLength: 64, required: true },
  input: { type: "object", additionalProperties: true, required: true },
  condition: { ...text, minLength: 1, maxLength: 64, required: true },
  question: { ...text, maxLength: 1000, required: true },
  once: { type: "boolean", required: false }
};
const watchSchema = createSchema({
  ...watchFields,
  projectSlug: text,
  sessionId: text,
  condition: { ...text, required: true },
  source: text,
  input: { type: "object", additionalProperties: true, required: false },
  status: { ...text, required: true },
  error: { ...text, maxLength: 512 }
});
const watchOutput = {
  mode: "replace",
  schema: createSchema({
    ok: { type: "boolean", required: true },
    watch: { type: "object", schema: watchSchema, required: false },
    watches: { type: "array", items: watchSchema, required: false }
  })
};
const assignmentSchema = createSchema({
  assignmentId: clientId,
  requestMessageId: clientId,
  projectSlug: text,
  sessionId: text,
  conversationId: text,
  reviewerConversationId: text,
  request: { ...text, maxLength: 24000 },
  requestTruncated: { type: "boolean", required: true },
  criteria: { ...text, maxLength: 4000 },
  status: text,
  summary: { ...text, maxLength: 2000 },
  evidence: { ...text, maxLength: 4000 },
  turnLimit: { type: "integer", required: true },
  turnsUsed: { type: "integer", required: true },
  waitingForAssignmentId: text,
  links: {
    type: "array",
    required: false,
    items: createSchema({
      assignmentId: clientId,
      requestMessageId: clientId,
      purpose: { ...text, maxLength: 2000 },
      request: { ...text, maxLength: 24000 }
    })
  },
  turns: {
    type: "array",
    required: false,
    items: createSchema({
      messageId: clientId,
      recipient: text,
      conversationId: text,
      planRevision: text,
      status: text,
      answerId: text,
      sourceAssignmentId: text,
      sourceMessageId: text,
      implementationTurn: { type: "integer", required: true }
    })
  },
  amendments: { type: "array", required: false, items: createSchema({ messageId: clientId, text: { ...text, maxLength: 24000 } }) }
});
const assignmentOutput = {
  mode: "replace",
  schema: createSchema({
    ok: { type: "boolean", required: true },
    assignment: { type: "object", schema: assignmentSchema, required: false },
    assignments: { type: "array", items: assignmentSchema, required: false }
  })
};
const usageTopicsReadInput = createSchema({
  query: { ...text, maxLength: 200 },
  offset: { type: "integer", min: 0, required: false },
  limit: { type: "integer", min: 1, max: 20, required: false }
});
const usageTopicsReadOutput = {
  mode: "replace",
  schema: createSchema({
    ok: { type: "boolean", required: true },
    error: { ...text, maxLength: 1000 },
    topics: {
      type: "array",
      required: true,
      maxLength: 20,
      items: createSchema({
        topicId: text,
        title: text,
        summary: { ...text, maxLength: 400 },
        error: { ...text, maxLength: 1000 }
      })
    },
    total: {
      type: "integer",
      required: false
    },
    hasMore: {
      type: "boolean",
      required: true
    },
    nextOffset: {
      type: "integer",
      required: false
    }
  })
};
const usageGuideReadOutput = {
  mode: "replace",
  schema: createSchema({
    ok: { type: "boolean", required: true },
    topicId: text,
    title: text,
    summary: {
      ...text,
      maxLength: 400
    },
    text: {
      type: "string",
      noTrim: true,
      maxLength: maxGuideCharacters,
      required: false
    },
    error: {
      ...text,
      maxLength: 1000
    }
  })
};
const conversationStartFreshInput = createSchema({
  operationId: clientId,
  expectedConversationId: clientId,
  unconfirmedMessages: {
    type: "array",
    required: false,
    description: "At most eight exact client-reported unconfirmed submissions; these are retained as annotations, never executed.",
    items: createSchema({
      messageId: clientId,
      clientId,
      text: { type: "string", noTrim: true, minLength: 1, maxLength: 24000, required: true },
      focus: focusField
    })
  }
});
const conversationHistoryReadInput = createSchema({
  offset: { type: "integer", min: 0, required: false },
  limit: { type: "integer", min: 1, max: 20, required: false }
});
const conversationHistoryPageReadInput = createSchema({
  conversationId: clientId,
  beforeTurnId: { ...clientId, required: false },
  limit: { type: "integer", min: 1, max: 100, required: false }
});
const messageSendInput = createSchema({
  clientId,
  focus: focusField,
  expectedConversationId: { ...clientId, required: false },
  messageId: clientId,
  message: { type: "string", noTrim: false, minLength: 1, maxLength: 24000, required: true },
  assistantSelection: { type: "object", additionalProperties: true, required: false }
});
const watchSourcesReadOutput = {
  mode: "replace",
  schema: createSchema({
    ok: { type: "boolean", required: true },
    sources: {
      type: "array",
      maxItems: 32,
      required: true,
      items: createSchema({
        source: { ...text, required: true },
        label: {
          ...text,
          required: true
        },
        description: {
          ...text,
          maxLength: 1000,
          required: true
        },
        scope: {
          ...text,
          required: true
        },
        input: { type: "object", additionalProperties: true, required: true },
        conditions: { type: "object", additionalProperties: true, required: true }
      })
    }
  })
};
const assignmentCreateInput = createSchema({
  assignmentId: clientId,
  requestMessageId: clientId,
  projectSlug: { ...text, minLength: 1, required: true },
  sessionId: { ...text, minLength: 1, required: true },
  conversationId: text,
  criteria: {
    ...text,
    minLength: 1,
    maxLength: 4000,
    required: true
  },
  turnLimit: {
    type: "integer",
    min: 1,
    max: 64,
    required: false
  }
});
const assignmentLinkInput = createSchema({
  assignmentId: clientId,
  relatedAssignmentId: clientId,
  requestMessageId: clientId,
  purpose: { ...text, minLength: 1, maxLength: 2000, required: true }
});
const assignmentRelayInput = createSchema({
  assignmentId: clientId,
  sourceAssignmentId: clientId,
  sourceMessageId: clientId,
  messageId: clientId,
  message: { ...text, minLength: 1, maxLength: 22000, required: true }
});
const assignmentMessageSendInput = createSchema({
  assignmentId: clientId,
  messageId: clientId,
  recipient: { type: "string", enum: ["implementer", "reviewer"], required: true },
  message: { ...text, minLength: 1, maxLength: 24000, required: true },
  planRevision: { ...text, maxLength: 64 }
});
const assignmentUpdateInput = createSchema({
  assignmentId: clientId,
  status: { type: "string", enum: ["active", "waiting", "needs-user", "ready", "cancelled"], required: true },
  summary: { ...text, minLength: 1, maxLength: 2000, required: true },
  evidence: { ...text, maxLength: 4000 },
  waitingForAssignmentId: { ...text, maxLength: 128 },
  extraTurns: { type: "integer", min: 1, max: 64, required: false }
});
const conversationSummaryReadInput = createSchema({
  projectSlug: { ...text, required: true },
  sessionId: { ...text, required: true },
  conversationId: text,
  beforeTurnId: text,
  beforeMessageId: text,
  question: { ...text, maxLength: 2000, required: true }
});
const conversationSummaryReadOutput = {
  mode: "replace",
  schema: createSchema({
    ok: { type: "boolean", required: true },
    mode: { type: "string", enum: ["summary", "excerpts"], required: true },
    summary: { ...text, maxLength: 1600 },
    error: { ...text, maxLength: 512 },
    nextBefore: text,
    hasMoreBefore: { type: "boolean", required: false },
    truncated: { type: "boolean", required: false },
    citations: { type: "array", maxLength: 6, items: { type: "string", maxLength: 128 }, required: false },
    messages: {
      type: "array",
      required: true,
      items: createSchema({
        id: text,
        role: text,
        text: { type: "string", maxLength: 8000, required: true },
        truncated: { type: "boolean", required: true }
      })
    }
  })
};
const navigationAcknowledgeInput = createSchema({
  clientId,
  commandId: clientId,
  ok: { type: "boolean", required: true },
  error: { ...text, maxLength: 2000 },
  focus: focusField,
  guide: guideReceipt
});
const contextReadOutput = {
  schema: createSchema({ ok: { type: "boolean", required: true }, focus: { ...focusField, required: true } }),
  mode: "replace"
};

// What a browser conversation of Colleague's carries with each message, and how it selects a model.
const colleagueConversationDataSchema = createSchema({ clientId, focus: focusField });
const colleagueConversationSelectionSchema = createSchema(modelSelectionFields);

export {
  assignmentCreateInput,
  assignmentLinkInput,
  assignmentMessageSendInput,
  assignmentOutput,
  assignmentRelayInput,
  assignmentUpdateInput,
  clientId,
  colleagueConversationDataSchema,
  colleagueConversationSelectionSchema,
  contextReadOutput,
  conversationHistoryPageReadInput,
  conversationHistoryReadInput,
  conversationStartFreshInput,
  conversationSummaryReadInput,
  conversationSummaryReadOutput,
  databaseTable,
  databaseView,
  focusField,
  guideFields,
  integrationEnvironment,
  integrationId,
  learningPanel,
  messageSendInput,
  modelSelectionFields,
  navigationAcknowledgeInput,
  navigationOutput,
  planView,
  sourceWatchFields,
  text,
  usageGuideReadOutput,
  usageTopicsReadInput,
  usageTopicsReadOutput,
  watchFields,
  watchOutput,
  watchSourcesReadOutput
};
