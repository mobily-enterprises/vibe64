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

export { studioHealthQueryInputValidator, studioToolsQueryInputValidator };
