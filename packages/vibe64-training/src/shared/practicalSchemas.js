import { createSchema } from "@jskit-ai/kernel/shared/validators";
import { presentationClientId } from "./presentationSchemas.js";
const text = { type: "string", noTrim: false, maxLength: 256, required: false };
const clientId = presentationClientId;

const trainingQuestionField = { type: "object", required: false, schema: createSchema({
  attemptId: { type: "string", required: true, noTrim: true, maxLength: 36,
    pattern: "^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$" },
  questionId: { type: "string", required: true, noTrim: true, maxLength: 64,
    pattern: "^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$" },
  assessmentId: { type: "string", required: true, noTrim: true, maxLength: 64,
    pattern: "^[a-zA-Z][a-zA-Z0-9-]{0,63}$" },
  issuedRevision: { type: "integer", required: true, min: 1, max: Number.MAX_SAFE_INTEGER },
  topicHash: { type: "string", required: true, noTrim: true, maxLength: 64, pattern: "^[a-f0-9]{64}$" },
  lessonHash: { type: "string", required: true, noTrim: true, maxLength: 64, pattern: "^[a-f0-9]{64}$" }
}) };

const trainingObservationFields = {
    clientId, conversationId: clientId,
    gestureId: { ...clientId, noTrim: true, maxLength: 64, pattern: "^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$" },
    control: { type: "string", required: true,
      enum: ["project-select", "session-select", "preview-select", "chat-show", "colleague-minimize", "colleague-restore", "exercise-response"] },
    reference: { ...trainingQuestionField, required: true },
    exercise: { type: "object", required: false, schema: createSchema({
      ...Object.fromEntries(["instanceId", "interactionId", "requestId", "playerInstanceId"].map(key => [key, {
        ...clientId, noTrim: true, maxLength: 36,
        pattern: "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
      }])),
      frameRequestId: { type: "integer", required: true, min: 1, max: Number.MAX_SAFE_INTEGER }
    }) },
    workspace: { type: "object", required: true, schema: createSchema({
      projectSlug: { ...clientId, maxLength: 48, pattern: "^[a-z0-9][a-z0-9-]*$" },
      sessionId: clientId,
      mainChatVisible: { type: "boolean", required: true }, projectVisible: { type: "boolean", required: true },
      pane: { ...text, required: true, maxLength: 64 }, ready: { type: "boolean", required: true },
      colleagueVisible: { type: "boolean", required: false }
    }) }

};

const trainingPracticalProgressField = { type: "object", required: false, schema: createSchema({
  reference: { ...trainingQuestionField, required: true }, assessmentId: { ...clientId, maxLength: 64 },
  phase: { type: "string", required: true, enum: ["collecting"] },
  acceptedSteps: { type: "integer", required: true, min: 1, max: 2 },
  lastControl: { type: "string", required: true,
    enum: ["project-select", "session-select", "chat-show", "preview-select", "colleague-minimize"] }
}) };
const trainingPracticalField = { type: "object", required: false, schema: createSchema({
  reference: { ...trainingQuestionField, required: true }, observationId: clientId,
  assessmentId: { ...clientId, maxLength: 64 }, producer: { type: "string", required: true, enum: ["workspace", "colleague", "exercise"] },
  operation: { ...clientId, maxLength: 64 }, observedAt: { ...clientId, maxLength: 24 },
  assistance: { type: "string", required: true, enum: ["none", "hint", "demonstration", "substantial"] },
  origin: { type: "string", required: true, enum: ["learner", "teacher"] },
  checkOutcome: { type: "string", required: false, enum: ["passed", "not-yet-passed"] }
}) };

export { trainingQuestionField, trainingObservationFields, trainingPracticalProgressField, trainingPracticalField };
