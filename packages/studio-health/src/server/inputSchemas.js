import { createSchema } from "@jskit-ai/kernel/shared/validators";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";

const studioHealthQueryInputValidator = deepFreeze({
  schema: createSchema({}),
  mode: "create"
});

export { studioHealthQueryInputValidator };
