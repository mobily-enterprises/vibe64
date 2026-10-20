import { createSchema } from "@jskit-ai/kernel/shared/validators";
import { authenticatedVibe64User, withVibe64ActionContext } from "@local/vibe64-core/server/actionContext";
import { trainingStepObservationSchema } from "../shared/practicalSchemas.js";
import { lessonSteps } from "./learnerState.js";
import { attemptId, attemptSummary, id, operationError, pick as pickPresent, practiceSlug, requestId, revision, text } from "./actions.js";

// Learning v2 (contract C3, Rev 3 R6): the lesson reader, step results, reader
// position and the learner's practice projects. Admission is the existing
// action context; decisions stay with their owners: the step owner
// (stepChecks.js) decides what may pass, the learner store saves, and the
// learning space (learningSpace.js) lists, archives and removes. "Browser"
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
// A practice project is named by the UUID of the attempt that created it.
const practiceId = attemptId;
const practiceOutput = {
  mode: "replace",
  schema: createSchema({
    ok: { type: "boolean", required: true }, available: { type: "boolean", required: true },
    projects: { type: "array", required: false, maxLength: 256, items: opaque },
    archived: { type: "array", required: false, maxLength: 64, items: opaque },
    revision: { ...revision, required: false }, attempt: { ...opaque, nullable: true },
    practiceId: { ...practiceId, required: false }, slug: { ...text, required: false, maxLength: 128 },
    archiveId: { ...text, required: false, maxLength: 128 },
    removed: { type: "boolean", required: false }, ended: { type: "boolean", required: false },
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
    description: "Read the learner's lesson as the reader shows it: its steps in order with their text, visual and guide, each step's check kind (automatic, choice, self-check or none) and the learner's saved step results. Without attemptId this reads the active attempt; learning.read lists the others. Teach from this: explain the current step, open the real screens with navigation guides and replay the step's visual. A choice question never includes its answer; never guess or reveal one. Results are decided only by automatic checks, the learner's own answer and the learner's own Done; never say a step passed unless a result here says passed. When page.count is above 1, read the other pages for the remaining step text. An earlier-format (version 1) lesson returns its identity only; it can be read in history but not continued." },
  async (input, actor) => {
    let attempt;
    if (input.attemptId) attempt = (await readAttempt(actor, input.attemptId)).attempt;
    else attempt = (await learners.readState({ actor })).active;
    if (!attempt) return { ok: true, available: true, attempt: null, lesson: null };
    const slug = await practiceSlug({ attempt, actor, learningSpace });
    const lesson = await content.readLesson({ ...attempt.pin.topic, lessonCode: attempt.pin.lesson.code, lessonHash: attempt.pin.lesson.hash });
    const summary = attemptSummary(attempt, slug);
    if (!lessonSteps(lesson)) {
      return { ok: true, available: true, attempt: summary,
        lesson: { schemaVersion: lesson.lesson.schemaVersion, code: lesson.lesson.code, hash: lesson.hash, title: lesson.lesson.title } };
    }
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
    error: `${operation} practice projects is unavailable in this installation. Nothing was changed.` });

  // A learning-space change the learner asked for. Colleague needs the
  // person's confirmation; the learner's own one-click browser action does
  // not. A refusal (pinned session, archive limit, storage, not this
  // learner's) is reported with nothing changed. A failure after the lesson in
  // progress ended still publishes the change and reports ended: true.
  const practiceCommand = (name, fields, description, run) => definition(name, { ...fields,
    confirmed: { type: "boolean", required: false } }, { output: practiceOutput, description },
  async (input, actor, context) => {
    if (context.channel !== "api" && input.confirmed !== true) {
      throw failure("Ask the person to confirm this practice project change, then repeat with confirmed: true.",
        "VIBE64_TRAINING_PRACTICE_UNCONFIRMED");
    }
    if (!learningSpace) return unavailablePractice("Changing");
    let result;
    try { result = await run(input, actor); }
    catch (cause) {
      const refusal = cause.statusCode < 500 && /^(VIBE64_TRAINING_PRACTICE_|vibe64_project_pinned)/u.test(cause.code || "");
      if (cause.ended === true) {
        await notify(actor, "", "practice");
        return { ok: false, available: true, practiceId: input.practiceId, ended: true,
          error: `${refusal ? `${refusalText(cause.message, "The change stopped.").slice(0, 400)} ` : "The change stopped part-way. "}The lesson in progress has ended (its results are kept); retry to finish.` };
      }
      if (!refusal) throw cause;
      return { ok: false, available: true, practiceId: input.practiceId, error: refusalText(cause.message, "Nothing was changed.") };
    }
    await notify(actor, "", "practice");
    return { ok: true, available: true, ...pick(result, ["practiceId", "slug", "archiveId", "removed", "ended"]) };
  });

  return Object.freeze([
    lessonRead,
    definition("step.observe", { attemptId, stepId: id,
      observation: { type: "object", required: true, schema: trainingStepObservationSchema } }, { browser: true },
    async (input, actor, context) => {
      await readAttempt(actor, input.attemptId);
      const result = await steps.observe({ actor, attemptId: input.attemptId, stepId: input.stepId,
        observation: input.observation, context: stepContext(context) });
      return recorded(result, actor, input.attemptId, "step");
    }),
    definition("step.check.run", { attemptId, stepId: id, requestId }, {
      description: "Run the declared automatic check of one step of the learner's active lesson (lesson.read shows which steps have one). Use a new requestId for a new check and the same one to retry. A check you run is a diagnostic only: it tells you whether the work is ready and is never saved, so the step stays unpassed until the learner presses Check in the lesson. A response check needs the learner's own press of the App's control in this lesson's Preview first. Report the outcome and reason as returned; never claim the step passed." },
    async (input, actor, context) => {
      await readAttempt(actor, input.attemptId);
      const result = await steps.runCheck({ actor, attemptId: input.attemptId, stepId: input.stepId, requestId: input.requestId,
        context: stepContext(context) });
      return recorded(result, actor, input.attemptId, "step");
    }),
    definition("step.answer", { attemptId, stepId: id, requestId,
      selected: { type: "array", required: true, minLength: 1, maxLength: 8, items: { type: "integer", required: true, min: 0, max: 7 } }
    }, { browser: true }, async (input, actor, context) => recorded(await steps.answer({ actor, context,
      ...pick(input, ["attemptId", "stepId", "selected", "requestId"]) }), actor, input.attemptId, "step")),
    definition("step.done", { attemptId, stepId: id, requestId }, { browser: true },
      async (input, actor, context) => recorded(await steps.done({ actor, context,
        ...pick(input, ["attemptId", "stepId", "requestId"]) }), actor, input.attemptId, "step")),
    definition("reader.save", { attemptId, stepId: id,
      scroll: { type: "number", required: true, min: 0, max: 10_000_000 } }, { browser: true, idempotency: "none" },
    async (input, actor) => {
      const { reader, baseline } = await steps.saveReader({ actor, ...pick(input, ["attemptId", "stepId", "scroll"]) });
      await notify(actor, input.attemptId, "reader");
      return { ok: true, reader: pick(reader, ["attemptId", "stepId", "scroll"]),
        ...(baseline ? { baseline: pick(baseline, ["recorded", "code", "reason"]) } : {}) };
    }),
    definition("practice.list", {}, { kind: "query", idempotency: "none", output: practiceOutput,
      description: "List the learner's practice projects in the learning space: each with its lesson (code, title), status (in-progress, finished, not-finished, or deleting when a delete stopped part-way) and practiceId; and archived practice projects with their lesson and archive date. Practice projects never appear among the person's normal projects. This is read-only." },
    async (_input, actor) => {
      if (typeof learningSpace?.list !== "function") return unavailablePractice("Listing");
      return { ok: true, available: true, ...await learningSpace.list(actor) };
    }),
    definition("practice.open", { practiceId, requestId, expectedRevision: revision }, { output: practiceOutput,
      description: "Open one of the learner's practice projects with its lesson, only after the person's direct request or accepted offer. Read practice.list and learning.read for the practiceId and current revision. When it is already the lesson in progress it is returned unchanged. Another lesson in progress is ended first (as Leave lesson: results and its practice project kept). Then the lesson continues in this practice project as a new attempt at the first step that has not passed, and learning mode turns on. Keep the same requestId on an uncertain retry." },
    async (input, actor) => {
      if (typeof exercises?.openPractice !== "function") return unavailablePractice("Opening");
      const result = await exercises.openPractice({ actor, ...pick(input, ["practiceId", "requestId", "expectedRevision"]) });
      await notify(actor, result.attempt?.attemptId || "", "learning-mode");
      return { ok: true, available: true, revision: result.revision, attempt: attemptSummary(result.attempt, result.attempt.projectSlug) };
    }),
    practiceCommand("practice.archive", { practiceId }, "Archive one of the learner's practice projects, only after the person asked for it and then confirmed it in the conversation; pass confirmed: true only then. Its lesson in progress, if any, ends first (results kept). The project's code and sessions are packed into an archive bundle (rebuildable dependencies such as node_modules are left out) and the project leaves the learning space; practice.list then shows it under archived. A pinned session refuses the archive until it is unpinned, and a learner keeps at most 20 archives; those refusals change nothing.",
      (input, actor) => learningSpace.archive({ actor, practiceId: input.practiceId })),
    practiceCommand("practice.delete", { practiceId }, "Delete one of the learner's practice projects, only after the person asked for it and then confirmed this exact deletion in the conversation; pass confirmed: true only then. Name the lesson and say the project's files, sessions and Preview go away for good, with no archive (practice.archive keeps one). Its lesson in progress, if any, ends first; step results are kept. A pinned session refuses the delete until it is unpinned; that refusal changes nothing. A delete that stopped part-way (status deleting) resumes. Another learner's practice project is not reachable here.",
      (input, actor) => learningSpace.remove({ actor, practiceId: input.practiceId })),
    practiceCommand("practice.archived.delete", { practiceId, archiveId: { ...text, maxLength: 128 } }, "Delete one archived practice project of the learner for good, only after the person asked for it and then confirmed it in the conversation; pass confirmed: true only then. Use the practiceId and archiveId from practice.list archived.",
      (input, actor) => learningSpace.deleteArchive({ actor, ...pick(input, ["practiceId", "archiveId"]) }))
  ]);
}

export { createTrainingStepActions, definition as defineTrainingLearnerAction };
