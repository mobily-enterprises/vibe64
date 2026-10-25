import { isDeepStrictEqual } from "node:util";
import { createSchema } from "@jskit-ai/kernel/shared/validators";

function conflict(path, detail) {
  return new TypeError(`Conversation products declare "${path}" differently (${detail}); give it one shared definition.`);
}

const nestedSchema = (field) => typeof field?.schema?.getFieldDefinitions === "function" ? field.schema : null;
const openObject = (field) => field.type === "object" && field.additionalProperties === true && !nestedSchema(field);

const LOWER_BOUNDS = ["minLength", "minItems", "min"];
const UPPER_BOUNDS = ["maxLength", "maxItems", "max"];

// A bound only one product declares does not bind the union.
function looserBound(key, left, right) {
  if (!Object.hasOwn(left, key) || !Object.hasOwn(right, key)) return {};
  return { [key]: (LOWER_BOUNDS.includes(key) ? Math.min : Math.max)(left[key], right[key]) };
}

function withoutDefaults({ required: _required, ...field }) {
  if (field.noTrim === false) delete field.noTrim;
  return field;
}

// The union of two products' definitions of one field: an input either product
// accepts passes. Enums and nested fields combine, length bounds loosen, and an
// open object absorbs a closed one. Any other difference is refused when the
// transport is set up, so no product's definition silently replaces another's.
function unionField(left, right, path) {
  const required = left.required === true && right.required === true;
  const a = withoutDefaults(left);
  const b = withoutDefaults(right);
  if (isDeepStrictEqual(a, b)) return { ...a, required };
  if (a.type !== b.type) throw conflict(path, `${a.type} or ${b.type}`);
  if (a.type === "object" && (openObject(a) || openObject(b))) {
    return { type: "object", additionalProperties: true, required };
  }
  const bounds = [...LOWER_BOUNDS, ...UPPER_BOUNDS];
  const rest = (field) => Object.fromEntries(Object.entries(field).filter(([key]) => !["schema", "enum", ...bounds].includes(key)));
  if (!isDeepStrictEqual(rest(a), rest(b)) || Boolean(a.schema) !== Boolean(b.schema) || Boolean(a.enum) !== Boolean(b.enum)) {
    throw conflict(path, "incompatible constraints");
  }
  return { ...rest(a), required, ...Object.assign({}, ...bounds.map(key => looserBound(key, a, b))),
    ...(a.enum ? { enum: [...new Set([...a.enum, ...b.enum])] } : {}),
    ...(a.schema ? { schema: unionSchemas([nestedSchema(a), nestedSchema(b)], path) } : {}) };
}

// One transport schema that accepts each product's own envelope. A field is
// required only where every product requires it; each product's original
// action still validates its complete input strictly.
function unionSchemas(schemas, path = "") {
  const present = schemas.filter(Boolean);
  if (present.length === 1) return present[0];
  const definitions = present.map(schema => schema.getFieldDefinitions());
  const keys = [...new Set(definitions.flatMap(Object.keys))];
  return createSchema(Object.fromEntries(keys.map((key) => {
    const declared = definitions.filter(fields => Object.hasOwn(fields, key)).map(fields => fields[key]);
    const field = declared.reduce((merged, next) => unionField(merged, next, path ? `${path}.${key}` : key));
    return [key, declared.length === definitions.length ? field : { ...field, required: false }];
  })));
}

export { unionSchemas as conversationTransportSchema };
