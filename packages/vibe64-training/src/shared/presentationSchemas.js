import { createSchema } from "@jskit-ai/kernel/shared/validators";

const text = { type: "string", noTrim: false, maxLength: 256, required: false };
// What the guide overlay actually drew; shown=false always names why.
const guideReceipt = { type: "object", required: false, schema: createSchema({
  shown: { type: "boolean", required: true },
  reason: { type: "string", required: false, enum: ["highlight-off", "target-hidden", "overlay-unavailable"] },
  step: { ...text, maxLength: 64 }
}) };
const presentationClientId = { ...text, minLength: 1, maxLength: 128, required: true };

export { guideReceipt, presentationClientId };
