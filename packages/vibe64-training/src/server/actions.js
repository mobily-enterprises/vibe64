import { createSchema } from "@jskit-ai/kernel/shared/validators";
import { authenticatedVibe64User, withVibe64ActionContext } from "@local/vibe64-core/server/actionContext";

const MAX_RESULT_BYTES = 128 * 1024;
const text = { type: "string", required: true, noTrim: true, minLength: 1, maxLength: 256 };
const revision = { type: "integer", required: true, min: 0, max: Number.MAX_SAFE_INTEGER };
const id = { ...text, maxLength: 64, pattern: "^[a-zA-Z][a-zA-Z0-9-]{0,63}$" };
const requestId = { ...text, maxLength: 64, pattern: "^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$" };
const attemptId = { ...text, maxLength: 36, pattern: "^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$" };
const opaque = { type: "object", additionalProperties: true, required: true };
const learningSessionSummary = { type: "object", required: true, schema: createSchema({
  sessionId: id, sessionName: { ...text, minLength: 0, maxLength: 1024 },
  status: { ...text, maxLength: 64 }, revision,
  createdAt: { ...text, minLength: 0, maxLength: 64 }, updatedAt: { ...text, minLength: 0, maxLength: 64 },
  archived: { type: "boolean", required: false }, archivedAt: { ...text, required: false, minLength: 0, maxLength: 64 },
  purpose: { ...text, enum: ["learning"] }, learningAttemptId: attemptId, lessonCode: id,
  noExercise: { type: "boolean", required: false },
  projectSlug: { ...text, required: false, maxLength: 48, pattern: "^[a-z0-9][a-z0-9_-]*$" }
}) };
const resultOutput = {
  mode: "replace",
  schema: createSchema({
    ok: { type: "boolean", required: true }, available: { type: "boolean", required: true },
    revision: { ...revision, required: false }, activeSummaryCurrent: { type: "boolean", required: false },
    courses: { type: "array", required: false, items: opaque },
    sessions: { type: "array", required: false, maxLength: 16, items: learningSessionSummary },
    active: { ...opaque, required: false, nullable: true },
    attempt: { ...opaque, required: false }, history: { type: "array", required: false, items: opaque },
    replayed: { type: "boolean", required: false },
    completion: { ...opaque, required: false, nullable: true },
    brief: { ...opaque, required: false },
    previewReady: { type: "boolean", required: false }, setupStatus: { ...text, required: false, maxLength: 64 },
    error: { ...text, required: false, maxLength: 512 }
  })
};

function pick(value, fields) {
  return Object.fromEntries(fields.filter(field => Object.hasOwn(value, field)).map(field => [field, value[field]]));
}

function pin(value) {
  return {
    course: pick(value.course, ["courseId", "release"]),
    topic: pick(value.topic, ["topicId", "release", "commit", "topicHash"]),
    lesson: pick(value.lesson, ["code", "hash"])
  };
}

function preparation(value) {
  return {
    ...pick(value, ["phase", "initialSessionId", "observedAt"]),
    ...(value.failure ? { failure: pick(value.failure, ["stage", "code", "message"]) } : {})
  };
}

function learning(value = {}) {
  const resume = value.resume;
  return {
    submissions: (value.submissions || []).map(result => ({
      ...pick(result, ["submissionId", "assessmentId", "kind", "outcome", "explanation", "assistance", "rubricRevision", "recordedAt"]),
      evidence: pick(result.evidence, ["kind", "attemptId", "text", "messageId", "questionId", "observationId", "observedAt",
        "projectSlug", "sessionId", "producer", "operation", "origin", "check"])
    })),
    resume: resume ? {
      ...pick(resume, ["requestId", "revision", "stage", "summary"]),
      pendingQuestion: resume.pendingQuestion ? pick(resume.pendingQuestion, ["id", "assessmentId", "text"]) : null,
      visuals: resume.visuals.map(value => ({ visualId: value.visualId,
        snapshot: pick(value.snapshot, ["state", "paused", "labels"]) }))
    } : null
  };
}

function active(value) {
  if (!value) return null;
  return {
    attemptId: value.attemptId, pin: pin(value.pin), projectSlug: value.projectSlug,
    preparation: preparation(value.preparation), learning: learning(value.learning),
    ...(value.ended ? { ended: pick(value.ended, ["requestId", "revision", "reason"]) } : {})
  };
}

function completion(value) {
  return value ? pick(value, ["lessonCode", "lessonHash", "required", "passed", "completed"]) : null;
}

function brief(value) {
  return {
    attemptId: value.attemptId, revision: value.revision, activeSummaryCurrent: value.activeSummaryCurrent,
    pin: pin(value.pin), projectSlug: value.projectSlug, preparation: preparation(value.preparation),
    lesson: {
      ...pick(value.lesson, ["code", "hash", "title", "estimatedMinutes", "teachingText", "exerciseRequired"]),
      assessments: value.lesson.assessments.map(assessment => ({
        ...pick(assessment, ["id", "kind", "required"]),
        rubric: { text: assessment.rubric.text },
        ...(assessment.evidence ? { evidence: pick(assessment.evidence, ["producer", "operation", "check", "explanationRequired"]) } : {})
      })),
      visuals: value.lesson.visuals.map(visual => ({
        ...pick(visual, ["id", "title", "description", "initialState", "states"]),
        commands: visual.commands.map(command => ({
          ...pick(command, ["name", "completionState", "description"]),
          parameters: command.parameters.map(parameter => pick(parameter, ["name", "required", "maxLength"]))
        }))
      }))
    },
    learning: { ...learning(value.learning), completion: completion(value.learning.completion),
      ...pick(value.learning, ["passedAssessmentIds", "remainingAssessmentIds"]),
      retainedPasses: (value.learning.retainedPasses || []).map(value => ({ attemptId: value.attemptId,
        pin: pin(value.pin), submission: learning({ submissions: [value.submission] }).submissions[0] })) },
    pacing: value.pacing
  };
}

function boundedResult(result) {
  if (Buffer.byteLength(JSON.stringify(result)) > MAX_RESULT_BYTES) {
    throw Object.assign(new Error("The training result exceeds 128 KiB. Ask the owner to inspect the content; no teaching text or progress was silently omitted."), {
      code: "VIBE64_TRAINING_ACTION_RESULT_TOO_LARGE"
    });
  }
  return structuredClone(result);
}

function operationError(cause) {
  const unconfirmed = String(cause.code || "").includes("SAVE_UNCONFIRMED");
  return Object.assign(new Error(unconfirmed
    ? "The learning save was not confirmed. Read or retry the same request/attempt before creating another exercise or claiming progress."
    : "The training operation could not complete. Keep the saved attempt and ask the owner to inspect its exact content, state or preparation; no automatic repair was performed."), {
    code: cause.code || "VIBE64_TRAINING_OPERATION_FAILED",
    ...(cause.statusCode ? { statusCode: cause.statusCode } : {}), cause
  });
}

const endedResult = result => ({ ok: true, available: true, revision: result.revision,
  attempt: active(result.attempt), active: active(result.active), replayed: result.replayed === true,
  previewReady: false });
const prepared = result => {
  if (result?.ok === false || !result?.attempt) {
    throw Object.assign(new Error("Exercise preparation did not return a saved attempt."), { code: "VIBE64_TRAINING_PREPARATION_FAILED" });
  }
  if (result.attempt.ended) return { ...endedResult(result), completion: null };
  return { ok: true, available: true, revision: result.revision,
    active: active(result.attempt), completion: completion(result.completion), previewReady: false,
    ...(result.setup?.status ? { setupStatus: result.setup.status } : {}) };
};

// Composition supplies the original readers and one exercise preparation owner.
// This factory registers neither a teacher loop nor a standalone provisioner.
function createTrainingActions({ catalogue, learners, teachingBrief, exercises = null, learningSessions = null } = {}) {
  if (typeof catalogue?.readCatalogue !== "function" || typeof learners?.readState !== "function" || typeof teachingBrief?.readBrief !== "function") {
    throw new TypeError("Training actions require the installed catalogue, learner state and teaching brief owners.");
  }
  const definition = (name, fields, description, execute) => withVibe64ActionContext({
    id: `vibe64.training.${name}`, version: 1,
    kind: name.endsWith("read") || name.endsWith("list") ? "query" : "command",
    input: { mode: "create", schema: createSchema(fields) }, output: null,
    idempotency: ["lesson.start", "lesson.resume", "lesson.end", "lesson.continue"].includes(name) ? "domain_native" : "none",
    extensions: { assistant: { alwaysAvailable: true, description, output: resultOutput,
      ...(name === "learning.read" ? { transformResult(result) {
        // Own identity binds browser state, never the model's tool result.
        const visible = { ...result };
        delete visible.learnerId;
        return visible;
      } } : {})
    } },
    async execute(input, context) {
      const actor = authenticatedVibe64User(context);
      if (!actor) throw Object.assign(new Error("Log in to Vibe64 before using learning actions."), { code: "vibe64_auth_required", statusCode: 401 });
      try {
        if (context.trainingMain) await context.trainingMain.requireAttempt(input.attemptId);
        const result = boundedResult(await execute(input, actor));
        if (context.trainingMain) await context.trainingMain.requireAttempt(input.attemptId);
        return result;
      } catch (cause) {
        if (cause.code === "VIBE64_TRAINING_ACTION_RESULT_TOO_LARGE") throw cause;
        throw operationError(cause);
      }
    }
  }, { projectScoped: false, ...(["learning.read", "teaching-brief.read"].includes(name) ? { learningAccess: "observe" } : {}) });

  const unavailable = (operation = "preparation") => ({ ok: false, available: false,
    error: operation === "end" ? "Lesson retirement is unavailable in this installation. Reading learning state does not end an attempt or dispose of its exercise."
      : operation === "continue" ? "Retained lesson continuation is unavailable in this installation. Keep the original progress and ask the owner to restore the exercise."
      : "Lesson exercise preparation is unavailable in this installation. Reading learning state and teaching content does not prepare an exercise." });

  return Object.freeze([
    definition("courses.list", {}, "Read installed course releases and their exact lesson choices. Read this again in the current teaching turn before a new start; earlier conversation results may name a now-disabled release. This is read-only; it does not enable a course, start a lesson or prepare an exercise. Drafts and disabled releases are not available for new teaching admissions. Topic IDs identify pinned content, not usage-guide topics.", async () => {
      const result = await catalogue.readCatalogue({ includeLessonTitles: true });
      return { ok: true, available: true, revision: result.revision, courses: result.courses.map(entry => ({
        ...pick(entry.course, ["courseId", "release", "title", "status"]), enabled: entry.enabled,
        lessons: entry.lock.topics.flatMap(topic => topic.lessons.map(lesson => {
          const matches = (entry.lessonTitles || []).filter(value => value.topicId === topic.topicId &&
            value.topicRelease === topic.release && value.code === lesson.code && value.hash === lesson.hash);
          const title = matches[0]?.title;
          if (matches.length !== 1 || typeof title !== "string" || title.length < text.minLength || title.length > text.maxLength) {
            throw new Error("The installed catalogue did not return one bounded title for this exact lesson pin.");
          }
          return { ...pick(lesson, ["code", "hash", "status", "required"]),
            title, topicId: topic.topicId, topicRelease: topic.release };
        }))
      })) };
    }),
    definition("learning.read", {}, "Read this signed-in learner's current saved lesson and verified progress. When this installation supplies learning sessions, this also lists only existing owned learning conversations; opening or listing them does not send a message. A missing conversation is absent, but invalid saved identity is an error. No reservation, exercise or summary repair is performed. The saved resume question is a checkpoint, not proof that it is unanswered or the next task. Read teaching-brief.read for exact passed and remaining assessments before continuing. Saved preparation and visual snapshots are earlier facts, not current Preview or animation readiness. preparation.phase is a saved checkpoint: reserved/preparing does not prove Workspace setup is still running. Repeated reads cannot complete it. Read the fresh teaching brief: when lesson.exerciseRequired is false, a reserved attempt needs no project or setup and can prepare its declared quiz answers. For an already-requested exercise lesson, use lesson.resume with this same attemptId to recheck actual setup and retain proven readiness.", async (_input, actor) => {
      const result = await learners.readState({ actor, includeCompletion: true });
      return { ok: true, available: true, revision: result.revision, activeSummaryCurrent: result.activeSummaryCurrent,
        ...(learningSessions ? { learnerId: result.progress.learnerId, sessions: await learningSessions.readSessions({ actor }) } : {}),
        active: active(result.active), completion: completion(result.completion),
        history: result.progress.attempts.filter(value => value.ended).map(active) };
    }),
    definition("teaching-brief.read", { attemptId }, "Read the exact saved attempt's pinned teaching text, rubric, evidence contracts and current progress before teaching. Ask one short question at a time. This read neither grades nor saves a pass, starts an exercise or grants source, shell, screenshot or operation authority.", async (input, actor) => ({
      ok: true, available: true, brief: brief(await teachingBrief.readBrief({ actor, attemptId: input.attemptId }))
    })),
    definition("lesson.start", {
      courseId: { ...id, pattern: "^[a-z][a-z0-9-]{0,63}$" },
      release: { ...text, pattern: "^[0-9]+\\.[0-9]+\\.[0-9]+$" },
      lessonCode: id, requestId, expectedRevision: revision
    }, "Start teaching only after the person's direct request or accepted offer. In this same teaching turn, read courses.list for an enabled exact release/lesson and learning.read for the current revision; do not use a course result from an earlier turn. Retain the same request ID on an uncertain retry, without changing its selected release. After success, read teaching-brief.read for the returned attempt, not usage.guide.read with its topic ID. If its saved preparation is preparing, use same-attempt lesson.resume before asking a question; asynchronous setup may already have finished. The host reserves the exact actor-owned attempt through normal permissions. It prepares a project only when the installed lesson declares an exercise; otherwise the reserved no-exercise attempt can teach declared quiz answers without project or setup effects. Read lesson.exerciseRequired in the brief; preparation does not mean Preview is running or an assessment passed. An ended request replay returns its original retained attempt without preparing or reactivating it. An unavailable host is not a successful start.", async (input, actor) => {
      if (typeof exercises?.startLesson !== "function") return unavailable();
      return prepared(await exercises.startLesson({ actor, ...pick(input, ["courseId", "release", "lessonCode", "requestId", "expectedRevision"]) }));
    }),
    definition("lesson.resume", { attemptId }, "Resume/prep only after the person's direct teaching request or accepted offer. Use this learner's exact saved attempt ID; the original preparation lock and fixed project/session identities preserve it. Use this also when Workspace setup has since finished but the saved checkpoint remains preparing. For an exercise lesson the host freshly reloads this exact reserved session, verifies its setup, and records ready only when proven. A no-exercise lesson keeps its reserved attempt and needs no project/session or ready phase; read the fresh brief and continue its declared quiz answers instead of polling setup. For actual reported setup status use sessions.inspect for the saved project/session and its workspaceSetupStatus, not repeated learning.read. A pending or failed setup must be reported as observed; do not infer still running or nothing broken from the checkpoint. Do not create another exercise after failure. After success, read teaching-brief.read for this same attempt, recap its passed assessments and normally continue a remaining one. Do not grade the resume request or treat an old checkpoint question as the next task. Preparation is not current Preview readiness or evidence of a pass.", async (input, actor) => {
      if (typeof exercises?.prepareLesson !== "function") return unavailable();
      return prepared(await exercises.prepareLesson({ actor, attemptId: input.attemptId }));
    }),
    definition("lesson.continue", { attemptId, requestId: { ...requestId, maxLength: 18 }, expectedRevision: revision
    }, "Continue only after the person's direct request or accepted offer for a fresh exercise of an ended saved lesson. Read learning.read and use this learner's exact ended attempt ID and current revision. The host derives its original installed pin; a disabled old release may continue, but arbitrary new admission remains disabled. If the lesson is still active, explain and use lesson.end only when the person requested that retirement. Use a stable continuation request ID of at most 18 characters and keep it on retries. This creates a fresh attempt and exercise only when declared, retaining genuine passes for unchanged lesson content and their original evidence. It does not Stop, close, archive, delete or overwrite the old project. Another active attempt is not adopted or ended. An ended replay returns its retained target and actual current active state without preparing a successor. After success, read teaching-brief.read for the returned attempt and continue remaining assessments; setup is not running Preview or a new practical pass. An unavailable host or uncertain save is not successful recovery.", async (input, actor) => {
      if (typeof exercises?.continueLesson !== "function") return unavailable("continue");
      return prepared(await exercises.continueLesson({ actor, ...pick(input, ["attemptId", "requestId", "expectedRevision"]) }));
    }),
    definition("lesson.end", { attemptId, requestId, expectedRevision: revision,
      reason: { ...text, enum: ["restart", "discard"] }
    }, "End only after the person's direct request or accepted offer to retire this exact learning attempt. Use its saved attempt ID, current learning revision and a stable end request ID. This retires learning while retaining the exercise and all historical evidence. It does not Stop, close, archive or delete anything; use those original authorised operations separately if requested. Retry the same end identity after an uncertain save. Replaying an old end cannot end a newer attempt; a fresh exercise requires a separately requested lesson.continue of the ended pin, or a new enabled lesson.start.", async (input, actor) => {
      if (typeof exercises?.endLesson !== "function") return unavailable("end");
      const result = await exercises.endLesson({ actor, ...pick(input, ["attemptId", "requestId", "expectedRevision", "reason"]) });
      if (result?.ok === false || !result?.attempt?.ended) {
        throw Object.assign(new Error("Lesson retirement did not return an ended saved attempt."), { code: "VIBE64_TRAINING_ATTEMPT_END_FAILED" });
      }
      return endedResult(result);
    })
  ]);
}

// Hosts acquire source through their existing session owner. The shared action
// layer retains the original bounded learning projections and actor authority.
function createTrainingAuthorPreviewActions({ preview } = {}) {
  if (typeof preview?.readState !== "function" || typeof preview?.startLesson !== "function") {
    throw new TypeError("Author preview actions require an admitted source/preview owner.");
  }
  const output = { ...resultOutput, schema: createSchema({ ...resultOutput.schema.getFieldDefinitions(),
    authorPreview: { type: "boolean", required: true } }) };
  const definition = (name, fields, description, execute, projectScoped) => withVibe64ActionContext({
    id: `vibe64.training.author-preview.${name}`, version: 1, kind: name === "read" ? "query" : "command",
    idempotency: name === "start" ? "domain_native" : "none",
    input: { mode: "create", schema: createSchema(fields) }, output: null,
    extensions: { assistant: { alwaysAvailable: true, description, output } },
    async execute(input, context) {
      const actor = authenticatedVibe64User(context);
      try { return boundedResult({ ...await execute(input, actor), authorPreview: true }); }
      catch (cause) {
        if (cause.code === "VIBE64_TRAINING_ACTION_RESULT_TOO_LARGE") throw cause;
        throw operationError(cause);
      }
    }
  }, { projectScoped, ownerRequired: true });
  return Object.freeze([
    definition("read", {}, "Read this signed-in owner's isolated author-preview state and revision. It does not read source, install a topic, refresh a preview or affect normal learner progress. Snapshot admission is not lesson delivery. In a supported hosted Learning view, Resume author trial opens this exact saved preview through the same Main teacher. Do not deliver the lesson through the supervisor's Colleague conversation.", async (_input, actor) => {
      const result = await preview.readState({ actor });
      return { ok: true, available: true, revision: result.revision, activeSummaryCurrent: result.activeSummaryCurrent,
        active: active(result.active), completion: completion(result.completion),
        history: result.progress.attempts.filter(value => value.ended).map(active) };
    }, false),
    definition("start", {
      projectSlug: { ...text, maxLength: 128 }, sessionId: { ...text, maxLength: 128 },
      lessonCode: id, expectedCommit: { ...text, maxLength: 40, pattern: "^[a-f0-9]{40}$" },
      requestId: { ...requestId, maxLength: 18 }, expectedRevision: revision
    }, "Admit a lesson snapshot only after the owner's direct request or accepted offer. Use the exact authorized authoring project/session, clean committed topic root, lesson code, observed 40-character commit and author-preview.read revision. The host reads that exact session under original idle/lifecycle/source guards and installs its immutable snapshot. A local commit is not remote publication or an enabled learner course. Use the same at-most18-character request and unchanged source arguments on uncertain retry; retained reservations reuse their saved pin without reading edited source. A fresh request refuses an active author preview. To explicitly refresh, read author-preview.read, end its exact attempt through lesson.end only when requested, then use a new author-preview.start request for the new committed snapshot and returned revision. Report end confirmed/start pending separately if start fails. Never silently end, replace, retarget or merge ordinary learner progress. Return the exact preview attempt. In the supported hosted Learning view, use Resume author trial to open that saved attempt through Main; snapshot admission itself sends no teacher message. Do not teach through this supervisor conversation or claim a completed trial. Preparation is not running Preview or a pass. Colleague has no source paths or shell access.", async (input, actor) =>
      prepared(await preview.startLesson({ actor, ...pick(input, ["projectSlug", "sessionId", "lessonCode", "expectedCommit", "requestId", "expectedRevision"]) })), true)
  ]);
}

export { createTrainingActions, createTrainingAuthorPreviewActions, operationError };
