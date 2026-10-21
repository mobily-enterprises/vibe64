import { createSchema } from "@jskit-ai/kernel/shared/validators";
import { authenticatedVibe64User, withVibe64ActionContext } from "@local/vibe64-core/server/actionContext";
import { trainingStepObservationSchema } from "../shared/practicalSchemas.js";
import { attemptId, attemptSummary, id, operationError, pick as pickPresent, practiceSlug, requestId, text } from "./actions.js";

// Learning v2 (Rev 4 C2): the lesson reader, step results, reader position,
// the lesson in progress and the archived lessons. Admission is the existing
// action context; decisions stay with their owners: the step owner
// (stepChecks.js) decides what may pass, the learner store saves, and the
// learning space (learningSpace.js) lists and closes attempts. "Browser"
// actions run only on the learner's own api channel and are excluded from
// Colleague's tools.
const MAX_RESULT_BYTES = 128 * 1024;
const MAX_PAGE_BODY_BYTES = 64 * 1024;
const opaque = { type: "object", additionalProperties: true, required: false };
const BROWSER = Object.freeze({ channels: ["api"], surfaces: ["app"] });

const stepResultOutput = {
  mode: "replace",
  schema: createSchema({
    ok: { type: "boolean", required: true }, stepId: { ...id, required: false },
    outcome: { type: "string", required: false, enum: ["passed", "not-yet-passed"] },
    recorded: { type: "boolean", required: false }, replayed: { type: "boolean", required: false },
    alreadyPassed: { type: "boolean", required: false },
    reason: { ...text, required: false, maxLength: 512 }, diagnostic: { ...text, required: false, maxLength: 512 }
  })
};
const lessonOutput = {
  mode: "replace",
  schema: createSchema({
    ok: { type: "boolean", required: true }, available: { type: "boolean", required: true },
    attempt: { ...opaque, nullable: true }, lesson: { ...opaque, nullable: true },
    results: { type: "array", required: false, maxLength: 64, items: opaque },
    passedStepIds: { type: "array", required: false, maxLength: 32, items: { ...id } },
    completion: { ...opaque, nullable: true }, reader: { ...opaque, nullable: true },
    page: { ...opaque }, error: { ...text, required: false, maxLength: 512 }
  })
};
const practiceOutput = {
  mode: "replace",
  schema: createSchema({
    ok: { type: "boolean", required: true }, available: { type: "boolean", required: true },
    current: { ...opaque, nullable: true },
    archived: { type: "array", required: false, maxLength: 64, items: opaque },
    attemptId: { ...attemptId, required: false },
    removed: { type: "boolean", required: false }, changed: { type: "boolean", required: false },
    error: { ...text, required: false, maxLength: 512 }
  })
};

// Step records may omit optional parts; a missing part projects as {}.
function pick(value = {}, fields) {
  return pickPresent(value, fields);
}

function refusalText(reason, fallback) {
  return typeof reason === "string" && reason.trim() ? reason.trim().slice(0, 512) : fallback;
}

function failure(message, code, statusCode = 409) {
  return Object.assign(new Error(message), { code, statusCode });
}

function bounded(result) {
  if (Buffer.byteLength(JSON.stringify(result)) > MAX_RESULT_BYTES) {
    throw failure("The lesson result exceeds 128 KiB. Ask the owner to inspect the content; nothing was silently omitted.",
      "VIBE64_TRAINING_ACTION_RESULT_TOO_LARGE", 413);
  }
  return structuredClone(result);
}

// Never the choice answer: only fields the reader and Colleague may see.
function stepProjection(step) {
  const check = step.check || { kind: "none" };
  return {
    ...pick(step, ["id", "title", "required"]),
    ...(step.visual ? { visual: { id: step.visual.id, play: (step.visual.play || []).map(entry => pick(entry, ["name", "parameters"])) } } : {}),
    ...(step.guide ? { guide: pick(step.guide, ["target", "navigate", "filePath", "caption"]) } : {}),
    check: { kind: check.kind,
      ...(check.kind === "auto" ? pick(check, ["check", "files"]) : {}),
      ...(check.kind === "choice" ? pick(check, ["question", "options"]) : {}) }
  };
}

function visualProjection(visual) {
  return {
    ...pick(visual.visual, ["title", "description", "initialState", "states"]), id: visual.id,
    commands: (visual.visual.commands || []).map(command => ({
      ...pick(command, ["name", "completionState", "description"]),
      parameters: (command.parameters || []).map(parameter => pick(parameter, ["name", "required", "maxLength"]))
    }))
  };
}

// A choice result's evidence is the learner's selected option set; with its
// outcome it would reveal the correct (or a rejected) answer, so Colleague's
// tool result keeps only the outcome. The learner's own reader keeps it.
function assistantLessonResult(result) {
  if (!Array.isArray(result?.results)) return result;
  return { ...result, results: result.results.map(value => {
    if (value.kind !== "choice") return value;
    const { evidence: _evidence, ...visible } = value;
    void _evidence;
    return visible;
  }) };
}

function resultProjection(result) {
  return pick(result, ["stepId", "kind", "outcome", "origin", "recordedAt", "reason", "evidence"]);
}

// Bodies are paged when they exceed 64 KiB together. Steps outside the
// requested page keep their metadata and name the page that carries their body.
function pageBodies(steps, notesText) {
  const bytes = value => Buffer.byteLength(value || "");
  let index = 0;
  let used = bytes(notesText);
  for (const step of steps) {
    const size = bytes(step.bodyText);
    if (used && used + size > MAX_PAGE_BODY_BYTES) {
      index += 1;
      used = 0;
    }
    used += size;
    step.bodyPage = index;
  }
  return index + 1;
}

// One learner-scoped Training action: the learner is always the authenticated
// actor. "Browser" actions run only on the learner's own api channel and are
// excluded from Colleague's tools; the others are always available to it.
const definition = (name, fields, { description = "", browser = false, kind = "command", output = stepResultOutput,
  idempotency = "domain_native", transformResult = null } = {}, execute) => withVibe64ActionContext({
  id: `vibe64.training.${name}`, version: 1, kind, idempotency,
  ...(browser ? BROWSER : {}),
  input: { mode: "create", schema: createSchema(fields) }, output: null,
  extensions: { assistant: browser ? { exclude: true } : { alwaysAvailable: true, description, output,
    ...(transformResult ? { transformResult } : {}) } },
  async execute(input, context) {
    const actor = authenticatedVibe64User(context);
    if (!actor) throw Object.assign(new Error("Log in to Vibe64 before using learning actions."), { code: "vibe64_auth_required", statusCode: 401 });
    try {
      return bounded(await execute(input, actor, context));
    } catch (cause) {
      if (cause.code === "VIBE64_TRAINING_ACTION_RESULT_TOO_LARGE" || cause.statusCode && cause.statusCode < 500 &&
          /^(VIBE64_TRAINING_|ACTION_VALIDATION_FAILED|vibe64_)/u.test(cause.code || "")) throw cause;
      throw operationError(cause);
    }
  }
}, { projectScoped: false });

function createTrainingStepActions({ learners, attemptLearners = learners, content, steps, exercises = null,
  learningSpace = null, publishLearnerChanged = null } = {}) {
  if (typeof learners?.readState !== "function" || typeof attemptLearners?.readState !== "function" ||
      typeof content?.readLesson !== "function" || typeof steps?.read !== "function") {
    throw new TypeError("Step actions require the original learner, installed content and step owners.");
  }

  const notify = async (actor, attempt, reason) => {
    if (typeof publishLearnerChanged === "function") await publishLearnerChanged({ actor, attemptId: attempt, reason });
  };

  async function readAttempt(actor, attempt) {
    const state = await attemptLearners.readState({ actor, attemptId: attempt });
    const saved = state.progress.attempts.find(value => value.attemptId === attempt);
    if (!saved) throw failure("This learner has no matching saved attempt.", "VIBE64_TRAINING_ATTEMPT_MISSING", 404);
    return { state, attempt: saved };
  }

  // Inner actions (session inspect, App run outputs) are re-admitted with the
  // learner's own request authority against the practice project's ordinary
  // project route: practice sessions are ordinary sessions (Learning v2 F1), so
  // no learning-scoped input remains.
  function stepContext(context) {
    const { vibe64Action: _admitted, ...inner } = context;
    void _admitted;
    return inner;
  }

  const lessonRead = definition("lesson.read", { attemptId: { ...attemptId, required: false },
    page: { type: "integer", required: false, min: 0, max: 31 } }, { kind: "query", idempotency: "none", output: lessonOutput,
    transformResult: assistantLessonResult,
    description: "Read the learner's lesson as the reader shows it: its steps in order with their text, visual and guide, each step's check kind (automatic, choice, self-check or none) and the learner's saved step results. Without attemptId this reads the active attempt; learning.read lists the others. Teach from this: explain the current step, open the real screens with navigation guides and replay the step's visual. A choice question never includes its answer; never guess or reveal one. Results are decided only by automatic checks, the learner's own answer and the learner's own Done; never say a step passed unless a result here says passed. When page.count is above 1, read the other pages for the remaining step text." },
  async (input, actor) => {
    let attempt;
    if (input.attemptId) attempt = (await readAttempt(actor, input.attemptId)).attempt;
    else attempt = (await learners.readState({ actor })).active;
    if (!attempt) return { ok: true, available: true, attempt: null, lesson: null };
    const slug = await practiceSlug({ attempt, actor, learningSpace });
    const lesson = await content.readLesson({ ...attempt.pin.topic, lessonCode: attempt.pin.lesson.code, lessonHash: attempt.pin.lesson.hash });
    const summary = attemptSummary(attempt, slug);
    const projected = lesson.steps.map(step => ({ ...stepProjection(step), bodyText: step.bodyText }));
    const count = pageBodies(projected, lesson.notesText);
    const index = input.page ?? 0;
    if (index >= count) throw failure(`This lesson has ${count} page(s).`, "ACTION_VALIDATION_FAILED", 400);
    for (const step of projected) if (step.bodyPage !== index) delete step.bodyText;
    const progress = await steps.read({ actor, attemptId: attempt.attemptId });
    const reader = typeof attemptLearners.readReader === "function"
      ? await attemptLearners.readReader({ actor, attemptId: attempt.attemptId }) : null;
    return {
      ok: true, available: true, attempt: summary,
      lesson: {
        schemaVersion: 2, code: lesson.lesson.code, hash: lesson.hash, title: lesson.lesson.title,
        ...pick(lesson.lesson, ["estimatedMinutes"]), exercise: Boolean(lesson.lesson.exercise),
        ...(lesson.notesText !== undefined && index === 0 ? { notesText: lesson.notesText } : {}),
        visuals: lesson.visuals.map(visualProjection), steps: projected
      },
      results: progress.results.map(resultProjection), passedStepIds: progress.passedStepIds,
      completion: pick(progress.completion, ["lessonCode", "lessonHash", "required", "passed", "completed"]),
      reader: reader?.attemptId === attempt.attemptId ? pick(reader, ["attemptId", "stepId", "scroll"]) : null,
      page: { index, count }
    };
  });

  const recorded = async (result, actor, attempt, reason) => {
    if (result?.recorded === true && result.replayed !== true) await notify(actor, attempt, reason);
    return pick(result, ["ok", "stepId", "outcome", "recorded", "replayed", "alreadyPassed", "reason", "diagnostic"]);
  };

  const unavailablePractice = operation => ({ ok: false, available: false,
    error: `${operation} lessons is unavailable in this installation. Nothing was changed.` });

  // A removal the learner asked for. Colleague needs the person's
  // confirmation; the learner's own one-click browser action does not. A
  // refusal (pinned session, not this learner's) is reported with nothing
  // changed; a removal that stopped part-way is reported and resumes on retry.
  const removal = (name, description, reason, run) => definition(name, { attemptId,
    confirmed: { type: "boolean", required: false } }, { output: practiceOutput, description },
  async (input, actor, context) => {
    if (context.channel !== "api" && input.confirmed !== true) {
      throw failure("Ask the person to confirm this deletion, then repeat with confirmed: true.",
        "VIBE64_TRAINING_PRACTICE_UNCONFIRMED");
    }
    let result;
    try { result = await run(input, actor); }
    catch (cause) {
      if (!(cause.statusCode < 500 && /^(VIBE64_TRAINING_(PRACTICE_|ATTEMPT_MISSING)|vibe64_project_pinned)/u.test(cause.code || ""))) {
        // A removal that stopped part-way changed the lesson (its project deleting).
        await notify(actor, input.attemptId, reason).catch(() => {});
        throw cause;
      }
      return { ok: false, available: true, attemptId: input.attemptId, error: refusalText(cause.message, "Nothing was changed.") };
    }
    if (result === null) return unavailablePractice("Deleting");
    await notify(actor, input.attemptId, reason);
    return { ok: true, available: true, attemptId: input.attemptId, ...pick(result, ["removed"]),
      ...(Object.hasOwn(result, "closed") ? { changed: result.closed } : {}) };
  });

  return Object.freeze([
    lessonRead,
    definition("step.observe", { attemptId, stepId: id,
      observation: { type: "object", required: true, schema: trainingStepObservationSchema } }, { browser: true },
    async (input, actor, context) => {
      await readAttempt(actor, input.attemptId);
      const result = await steps.observe({ actor, attemptId: input.attemptId, stepId: input.stepId,
        observation: input.observation, context: stepContext(context) });
      return recorded(result, actor, input.attemptId, "steps");
    }),
    definition("step.check.run", { attemptId, stepId: id, requestId }, {
      description: "Run the declared automatic check of one step of the learner's active lesson (lesson.read shows which steps have one). Use a new requestId for a new check and the same one to retry. A check you run is a diagnostic only: it tells you whether the work is ready and is never saved, so the step stays unpassed until the learner presses Check in the lesson. A response check needs the learner's own press of the App's control in this lesson's Preview first. Report the outcome and reason as returned; never claim the step passed." },
    async (input, actor, context) => {
      await readAttempt(actor, input.attemptId);
      const result = await steps.runCheck({ actor, attemptId: input.attemptId, stepId: input.stepId, requestId: input.requestId,
        context: stepContext(context) });
      return recorded(result, actor, input.attemptId, "steps");
    }),
    definition("step.answer", { attemptId, stepId: id, requestId,
      selected: { type: "array", required: true, minLength: 1, maxLength: 8, items: { type: "integer", required: true, min: 0, max: 7 } }
    }, { browser: true }, async (input, actor, context) => recorded(await steps.answer({ actor, context,
      ...pick(input, ["attemptId", "stepId", "selected", "requestId"]) }), actor, input.attemptId, "steps")),
    definition("step.done", { attemptId, stepId: id, requestId }, { browser: true },
      async (input, actor, context) => recorded(await steps.done({ actor, context,
        ...pick(input, ["attemptId", "stepId", "requestId"]) }), actor, input.attemptId, "steps")),
    definition("reader.save", { attemptId, stepId: id,
      scroll: { type: "number", required: true, min: 0, max: 10_000_000 } }, { browser: true, idempotency: "none" },
    async (input, actor) => {
      const { reader, baseline } = await steps.saveReader({ actor, ...pick(input, ["attemptId", "stepId", "scroll"]) });
      await notify(actor, input.attemptId, "steps");
      return { ok: true, reader: pick(reader, ["attemptId", "stepId", "scroll"]),
        ...(baseline ? { baseline: pick(baseline, ["recorded", "code", "reason"]) } : {}) };
    }),
    definition("practice.list", {}, { kind: "query", idempotency: "none", output: practiceOutput,
      description: "List the learner's lessons in the learning space: current is the one lesson in progress (attemptId, lesson code and title, its practice project slug when it has one, status in-progress, or deleting when a delete stopped part-way), or null; archived lists the archived lessons (finished, or archived by a restart or a new start), newest first, with their lesson, reason, archive date and whether a practice project was kept. Practice projects never appear among the person's normal projects. This is read-only." },
    async (_input, actor) => {
      if (typeof learningSpace?.list !== "function") return unavailablePractice("Listing");
      return { ok: true, available: true, ...await learningSpace.list(actor) };
    }),
    removal("lesson.delete", "Delete the lesson in progress for good, only after the person asked for it and then confirmed this exact deletion in the conversation; pass confirmed: true only then. Name the lesson and say its practice project (files, sessions, Preview) and its teacher conversation go away, with no archive; Restart keeps an archive instead. Lesson completion already earned is kept. A pinned session refuses the delete until it is unpinned; that refusal changes nothing. A delete that stopped part-way (status deleting) resumes. Use the attemptId from practice.list current.",
    "lesson", (input, actor) => typeof exercises?.deleteLesson === "function"
      ? exercises.deleteLesson({ actor, attemptId: input.attemptId }) : null),
    removal("practice.archived.delete", "Delete one archived lesson of the learner for good (its record, practice project and conversation), only after the person asked for it and then confirmed it in the conversation; pass confirmed: true only then. Use the attemptId from practice.list archived. Lesson completion already earned is kept.",
    "practice", (input, actor) => typeof learningSpace?.deleteArchive === "function"
      ? learningSpace.deleteArchive({ actor, attemptId: input.attemptId }) : null)
  ]);
}

export { createTrainingStepActions, definition as defineTrainingLearnerAction };
