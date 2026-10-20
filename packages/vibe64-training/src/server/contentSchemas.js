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
    producer: { ...text, enum: ["workspace", "colleague", "exercise", "code"] }, operation: id,
    check: { ...id, required: false }, explanationRequired: { type: "boolean", required: false },
    // A code practical names the exercise files the learner edits (exercise-relative).
    files: { ...list(text, 8), required: false, minLength: 1 }
  }) }
});
// Fields shared by every lesson format version.
const lessonFields = {
  code: id, title: text, prerequisites,
  estimatedMinutes: { type: "integer", required: true, min: 1, max: 180 },
  visuals: list(createSchema({ id, descriptor: text }), 12),
  exercise: { type: "object", required: false, schema: createSchema({
    kind: { ...text, enum: ["bundled"] }, source: text,
    reuse: { ...text, enum: ["attempt", "sequence"] }, sequenceId: { ...id, required: false },
    sequenceMode: { ...text, required: false, enum: ["create", "continue"] }
  }) },
  checks: { ...list(createSchema({ id, file: text, assets: { ...list(text, 32), required: false },
    kind: { ...text, required: false, enum: ["response", "code"] },
    timeoutSeconds: { type: "integer", required: false, min: 1, max: 60 } }), 12), required: false },
  // Exercise data-changing routes: validated with the lesson; no current reader consumes them.
  appRoutes: { ...list(createSchema({ method: { ...text, enum: ["POST", "PUT", "PATCH", "DELETE"] },
    path: { ...text, maxLength: 128, pattern: "^/[A-Za-z0-9._~:/-]*$" } }), 16), required: false }
};
const lessonSchema = createSchema({
  schemaVersion: version, ...lessonFields, document: text,
  assessments: list(assessment, 32)
});
// Lesson format v2: ordered steps replace the teaching document and its
// assessments. Check verdicts are final; v2 has no rubric and no AI grader.
// Cross-field rules (per-kind fields, references, counts) live in the bundler.
const stepSchema = createSchema({
  id, title: text, body: text, required: { type: "boolean", required: true },
  visual: { type: "object", required: false, schema: createSchema({
    id,
    // Each entry's parameters are a flat name -> string map, checked against
    // the visual's declared command by the bundler.
    play: { ...list(createSchema({ name: id, parameters: { type: "object", required: true } }), 16), required: false }
  }) },
  guide: { type: "object", required: false, schema: createSchema({
    target: id, navigate: { type: "boolean", required: false },
    filePath: { ...text, required: false, maxLength: 512 }, caption: { ...text, required: false }
  }) },
  check: { type: "object", required: true, schema: createSchema({
    kind: { ...text, enum: ["auto", "choice", "self", "none"] },
    check: { ...id, required: false },
    files: { ...list(text, 8), required: false },
    question: { ...text, required: false, maxLength: 2000 },
    options: { ...list(text, 8), required: false },
    answer: { ...list({ type: "integer", required: true, min: 0, max: 7 }, 8), required: false }
  }) }
});
const lessonSchemaV2 = createSchema({
  schemaVersion: { type: "integer", required: true, enum: [2] }, ...lessonFields,
  notes: { ...text, required: false },
  steps: list(stepSchema, 32)
});
const lessonSchemas = new Map([[1, lessonSchema], [2, lessonSchemaV2]]);

// Select the authored lesson format by its declared version before validating.
function validateLesson(value, label) {
  const schema = lessonSchemas.get(value?.schemaVersion) || lessonSchema;
  return validateContent(schema, value, label);
}
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

export { courseSchema, id, list, text, topicSchema, visualSchema, validateContent, validateLesson };
