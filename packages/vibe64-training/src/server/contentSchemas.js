import { createSchema, validateSchemaPayload } from "@jskit-ai/kernel/shared/validators";
import { isDeepStrictEqual } from "node:util";

const text = { type: "string", required: true, noTrim: true, minLength: 1, maxLength: 256 };
const id = { ...text, maxLength: 64 };
const list = (items, maxLength = 100) => ({
  type: "array", required: true, maxLength, items,
  validator: value => Array.isArray(value) && value.length > maxLength
    ? `Expected at most ${maxLength} items.` : undefined
});
const version = { type: "integer", required: true, enum: [1] };
const prerequisites = list(createSchema({ code: id }), 24);
const assessment = createSchema({
  id, kind: { ...text, enum: ["answer", "practical"] }, required: { type: "boolean", required: true }, rubric: text,
  evidence: { type: "object", required: false, schema: createSchema({
    producer: { ...text, enum: ["workspace", "colleague", "exercise"] }, operation: id,
    check: { ...id, required: false }, explanationRequired: { type: "boolean", required: false }
  }) }
});
const lessonSchema = createSchema({
  schemaVersion: version, code: id, title: text, document: text, prerequisites,
  estimatedMinutes: { type: "integer", required: true, min: 1, max: 180 },
  visuals: list(createSchema({ id, descriptor: text }), 12),
  exercise: { type: "object", required: false, schema: createSchema({
    kind: { ...text, enum: ["bundled"] }, source: text,
    reuse: { ...text, enum: ["attempt", "sequence"] }, sequenceId: { ...id, required: false },
    sequenceMode: { ...text, required: false, enum: ["create", "continue"] }
  }) },
  checks: { ...list(createSchema({ id, file: text, assets: { ...list(text, 32), required: false } }), 12), required: false },
  assessments: list(assessment, 32)
});
const topicSchema = createSchema({
  schemaVersion: version, topicId: id, domainId: id, title: text,
  status: { ...text, enum: ["preview", "released"] }, outline: text, prerequisites: list(createSchema({ topicId: id }), 24),
  lessons: list(createSchema({ code: id, descriptor: text,
    status: { ...text, enum: ["draft", "published"] }, required: { type: "boolean", required: true } }), 64)
});
const courseSchema = createSchema({
  schemaVersion: version, courseId: id, title: text, release: text,
  status: { ...text, enum: ["preview", "released"] },
  topics: list(createSchema({ topicId: id, release: text }), 32)
});
const visualSchema = createSchema({
  schemaVersion: version, id, title: text, svg: text, controller: text,
  assets: { ...list(text, 32), required: false },
  initialState: id, states: list(id, 32), description: { ...text, maxLength: 2000 },
  commands: list(createSchema({ name: id, parameters: list(createSchema({
    name: id, required: { type: "boolean", required: true }, maxLength: { type: "integer", required: true, min: 1, max: 256 }
  }), 8), completionState: id, description: { ...text, maxLength: 2000 } }), 32)
});

function validateContent(schema, value, label) {
  const validated = validateSchemaPayload({ schema, mode: "create" }, value, { context: label });
  // Content is authored JSON: reject unknown fields and coercion rather than silently changing the release input.
  if (!isDeepStrictEqual(value, validated)) throw new Error(`${label}: unknown fields or noncanonical values.`);
  return validated;
}

export { courseSchema, lessonSchema, topicSchema, visualSchema, validateContent, list };
