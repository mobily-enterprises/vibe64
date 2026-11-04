import { createSchema } from "json-rest-schema";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";

function validator(fields) {
  return deepFreeze({
    mode: "create",
    schema: createSchema({
      vibe64User: { additionalProperties: true, required: false, type: "object" },
      sessionId: { type: "string", noTrim: false, required: true, minLength: 1, maxLength: 200 },
      ...fields
    })
  });
}

const taskId = { type: "string", noTrim: false, required: true, minLength: 1, maxLength: 200 };

const aiTaskSessionInput = validator({});
const aiTaskStartInput = validator({
  kind: { type: "string", noTrim: false, required: true, minLength: 1, maxLength: 64 },
  input: { type: "object", required: false, additionalProperties: true }
});
const aiTaskInput = validator({ taskId });
const aiTaskCheckInput = validator({
  taskId,
  reviewedConflictId: { type: "string", noTrim: false, required: false, maxLength: 200 }
});

export {
  aiTaskCheckInput,
  aiTaskInput,
  aiTaskSessionInput,
  aiTaskStartInput
};
