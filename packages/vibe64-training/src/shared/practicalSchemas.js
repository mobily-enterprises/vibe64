import { createSchema } from "@jskit-ai/kernel/shared/validators";
import { presentationClientId } from "./presentationSchemas.js";
const text = { type: "string", noTrim: false, maxLength: 256, required: false };
const clientId = presentationClientId;

// A version 2 lesson step's learner-origin exercise receipt, captured by the
// browser when the learner presses the App's own control in visible Preview.
const trainingStepObservationSchema = createSchema({
  control: { type: "string", required: true, enum: ["exercise-response"] },
  exercise: { type: "object", required: true, schema: createSchema(Object.fromEntries(["instanceId", "interactionId", "requestId"].map(key => [key, {
    ...clientId, noTrim: true, maxLength: 36, pattern: "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$" }]))) },
  workspace: { type: "object", required: true, schema: createSchema({
    projectSlug: { ...clientId, maxLength: 48, pattern: "^[a-z0-9][a-z0-9-]*$" }, sessionId: clientId,
    projectVisible: { type: "boolean", required: true }, pane: { ...text, required: true, maxLength: 64 },
    ready: { type: "boolean", required: true } }) }
});

export { trainingStepObservationSchema };
