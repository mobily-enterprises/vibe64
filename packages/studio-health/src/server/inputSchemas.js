import { createSchema } from "@jskit-ai/kernel/shared/validators";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";

const studioHealthQueryInputValidator = deepFreeze({
  schema: createSchema({}),
  mode: "create"
});

// Comma-separated tool ids (Stack runtime ids or AI tool ids) to check now.
const studioToolsQueryInputValidator = deepFreeze({
  schema: createSchema({
    ids: { type: "string", required: true, minLength: 1, maxLength: 400, pattern: "^[a-z0-9-]+(,[a-z0-9-]+)*$" }
  }),
  mode: "create"
});

// The newest crash the person was shown: acknowledging covers it and every older one, never one recorded after it.
const crashesAcknowledgeInputValidator = deepFreeze({
  schema: createSchema({
    through: { type: "string", required: true, minLength: 1, maxLength: 64, pattern: "^\\d{8}T\\d{9}Z-\\d+-[0-9a-f]{4}$" }
  }),
  mode: "create"
});

export { crashesAcknowledgeInputValidator, studioHealthQueryInputValidator, studioToolsQueryInputValidator };
