import { createSchema } from "json-rest-schema";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";

function validator(fields) {
  return deepFreeze({
    mode: "create",
    schema: createSchema({ vibe64User: { additionalProperties: true, required: false, type: "object" }, ...fields })
  });
}

const pageId = { type: "string", noTrim: false, required: true, minLength: 1, maxLength: 64 };

const pagesListInput = validator({});
const pageInput = validator({ pageId });
const pageViewInput = validator({ pageId, theme: { type: "string", noTrim: false, required: false, maxLength: 8 } });
const pageVersionInput = validator({ pageId, version: { type: "integer", required: true, min: 1 } });

export { pageInput, pagesListInput, pageVersionInput, pageViewInput };
