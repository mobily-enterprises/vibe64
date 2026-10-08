import { createSchema } from "@jskit-ai/kernel/shared/validators";

const text = { type: "string", noTrim: false, maxLength: 256, required: false };
const presentationReceipt = { type: "object", required: false, schema: createSchema({
  attemptId: { ...text, required: true, maxLength: 36 }, visualId: { ...text, required: true, maxLength: 64 },
  playerInstanceId: { ...text, required: true, minLength: 1, maxLength: 64 },
  phase: { type: "string", required: false, enum: ["ready", "armed", "completed"] },
  commandId: { ...text, maxLength: 64 }, state: { ...text, maxLength: 64 },
  cueId: { ...text, maxLength: 64 }, navigationId: { ...text, maxLength: 128 },
  conversationId: text, turnId: text, clientId: text, outputId: text,
  canonicalFinal: { type: "boolean", required: false },
  audioPhase: { ...text, maxLength: 32 }, visualPhase: { ...text, maxLength: 32 }, error: { ...text, maxLength: 2000 },
  description: { ...text, maxLength: 2000 },
  snapshot: { type: "object", required: false, schema: createSchema({
    state: { ...text, required: true, maxLength: 64 }, paused: { type: "boolean", required: true },
    labels: { type: "object", additionalProperties: true, required: true }
  }) }
}) };
const presentationCueReceipt = { type: "object", required: false, schema: createSchema({
        ...Object.fromEntries(["cueId", "commandId", "navigationId", "conversationId", "turnId", "clientId", "attemptId", "visualId", "playerInstanceId", "outputId"]
          .map(key => [key, { ...text, required: true, maxLength: key === "attemptId" ? 36 : 256 }])),
        phase: { type: "string", required: true, enum: ["completed", "interrupted", "failed"] },
        canonicalFinal: { type: "boolean", required: true },
        audioPhase: { type: "string", required: true, enum: ["waiting", "off", "started", "completed", "interrupted", "failed"] },
        visualPhase: { type: "string", required: true, enum: ["ready", "pending", "accepted", "completed", "interrupted", "failed"] },
        state: { ...text, maxLength: 64 }, description: { ...text, maxLength: 2000 }, error: { ...text, maxLength: 2000 }
      }) };
const presentationClientId = { ...text, minLength: 1, maxLength: 128, required: true };

export { presentationReceipt, presentationCueReceipt, presentationClientId };
