import { createSchema } from "@jskit-ai/kernel/shared/validators";
import { authenticatedVibe64User, withVibe64ActionContext } from "@local/vibe64-core/server/actionContext";

const MAX_RESULT_BYTES = 128 * 1024;
const text = { type: "string", required: true, noTrim: true, minLength: 1, maxLength: 256 };
const revision = { type: "integer", required: true, min: 0, max: Number.MAX_SAFE_INTEGER };
const id = { ...text, maxLength: 64, pattern: "^[a-zA-Z][a-zA-Z0-9-]{0,63}$" };
const requestId = { ...text, maxLength: 64, pattern: "^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$" };
const attemptId = { ...text, maxLength: 36, pattern: "^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$" };
const opaque = { type: "object", additionalProperties: true, required: true };
const resultOutput = {
  mode: "replace",
  schema: createSchema({
    ok: { type: "boolean", required: true }, available: { type: "boolean", required: true },
    revision: { ...revision, required: false }, activeSummaryCurrent: { type: "boolean", required: false },
    courses: { type: "array", required: false, items: opaque },
    canCreateCourses: { type: "boolean", required: false }, canTryPreviews: { type: "boolean", required: false }, course: { ...opaque, required: false },
    domains: { type: "array", required: false, items: opaque },
    repository: { ...text, required: false, maxLength: 256 }, catalogueCommit: { ...text, required: false, maxLength: 64 },
    changed: { type: "boolean", required: false },
    retired: { type: "array", required: false, maxLength: 16, items: { ...text, maxLength: 32 } },
    lessonProgress: { type: "array", required: false, items: opaque },
    attempts: { type: "array", required: false, maxLength: 32, items: opaque },
    active: { ...opaque, required: false, nullable: true },
    attempt: { ...opaque, required: false }, history: { type: "array", required: false, items: opaque },
    replayed: { type: "boolean", required: false },
    completion: { ...opaque, required: false, nullable: true },
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

function boundedResult(result) {
  if (Buffer.byteLength(JSON.stringify(result)) > MAX_RESULT_BYTES) {
    throw Object.assign(new Error("The training result exceeds 128 KiB. Ask the owner to inspect the content; no teaching text or progress was silently omitted."), {
      code: "VIBE64_TRAINING_ACTION_RESULT_TOO_LARGE"
    });
  }
  return structuredClone(result);
}

function operationError(cause) {
  if (cause.code === "VIBE64_TRAINING_PREPARATION_BUSY") {
    return Object.assign(new Error("This saved exercise is still busy preparing or finishing a command. Wait for it to finish, then retry the same attempt."), {
      code: cause.code, statusCode: 409, cause
    });
  }
  // Learner notes failures already carry notes-specific recovery text; the
  // generic attempt wording below would send the learner to the wrong place.
  if (/^VIBE64_TRAINING_NOTES_/u.test(cause.code || "")) {
    return Object.assign(new Error(cause.message), {
      code: cause.code, ...(cause.statusCode ? { statusCode: cause.statusCode } : {}), cause
    });
  }
  const unconfirmed = String(cause.code || "").includes("SAVE_UNCONFIRMED");
  return Object.assign(new Error(unconfirmed
    ? "The learning save was not confirmed. Read or retry the same request/attempt before creating another exercise or claiming progress."
    : "The training operation could not complete. Keep the saved attempt and ask the owner to inspect its exact content, state or preparation; no automatic repair was performed."), {
    code: cause.code || "VIBE64_TRAINING_OPERATION_FAILED",
    ...(cause.statusCode ? { statusCode: cause.statusCode } : {}), cause
  });
}

function installError(cause) {
  if (/^VIBE64_TRAINING_(COURSE|CATALOGUE|AVAILABLE|TOPIC|SOURCE)_/u.test(cause.code || "")) return cause;
  return Object.assign(new Error(`The course could not be installed: ${String(cause.message || "unknown failure").slice(0, 300)} No course was enabled. Retry; if it fails again, ask the owner to inspect this server's installed learning content.`), {
    code: cause.code || "VIBE64_TRAINING_COURSE_INSTALL_FAILED", ...(cause.statusCode ? { statusCode: cause.statusCode } : {}), cause
  });
}

// A practice project exists only once preparation began for an exercise lesson.
// A host that can tell whether it still exists says so; deleted projects are
// then left out (contract C3/C5: learning.read lists attempts with their slug).
async function practiceSlug({ attempt, actor, practiceProjects }) {
  const slug = attempt.projectSlug;
  if (!slug || !attempt.preparation || attempt.preparation.phase === "reserved") return "";
  if (typeof practiceProjects?.exists === "function" && !await practiceProjects.exists({ slug, actor })) return "";
  return slug;
}

function attemptSummary(attempt, slug = "") {
  return {
    attemptId: attempt.attemptId,
    pin: pin(attempt.pin),
    preparation: pick(attempt.preparation || {}, ["phase", "observedAt"]),
    ...(slug ? { practiceSlug: slug } : {}),
    ...(attempt.ended ? { ended: pick(attempt.ended, ["revision", "reason"]) } : {})
  };
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
function createTrainingActions({ catalogue, learners, exercises = null, courseInstaller = null, practiceProjects = null } = {}) {
  if (typeof catalogue?.readCatalogue !== "function" || typeof learners?.readState !== "function") {
    throw new TypeError("Training actions require the installed catalogue and learner state owners.");
  }
  const definition = (name, fields, description, execute) => withVibe64ActionContext({
    id: `vibe64.training.${name}`, version: 1,
    kind: name.endsWith("read") || name.endsWith("list") ? "query" : "command",
    input: { mode: "create", schema: createSchema(fields) }, output: null,
    idempotency: ["lesson.start", "lesson.resume", "lesson.end", "lesson.continue", "course.install"].includes(name) ? "domain_native" : "none",
    extensions: { assistant: { alwaysAvailable: true, description, output: resultOutput,
      ...(name === "learning.read" ? { transformResult(result) {
        // Own identity binds the browser's lesson requests (L), never the model's tool result.
        const visible = { ...result };
        delete visible.learnerId;
        return visible;
      } } : {})
    } },
    async execute(input, context) {
      const actor = authenticatedVibe64User(context);
      if (!actor) throw Object.assign(new Error("Log in to Vibe64 before using learning actions."), { code: "vibe64_auth_required", statusCode: 401 });
      try {
        return boundedResult(await execute(input, actor));
      } catch (cause) {
        if (cause.code === "VIBE64_TRAINING_ACTION_RESULT_TOO_LARGE") throw cause;
        // Course creation reports the catalogue owner's own corrective message.
        if (name === "courses.create" && /^VIBE64_TRAINING_(COURSE|CATALOGUE)_/u.test(cause.code || "")) throw cause;
        // A preview refusal reports its owner-only admission message.
        if (name === "lesson.start" && cause.code === "VIBE64_TRAINING_COURSE_PREVIEW") throw cause;
        // Catalogue reads and installs report their owner's corrective message.
        if (["available.list", "course.install"].includes(name)) throw installError(cause);
        throw operationError(cause);
      }
    }
  }, { projectScoped: false, ...(name === "courses.create" ? { ownerRequired: true } : {}) });

  const unavailable = (operation = "preparation") => ({ ok: false, available: false,
    error: operation === "end" ? "Lesson retirement is unavailable in this installation. Reading learning state does not end an attempt or dispose of its exercise."
      : operation === "continue" ? "Retained lesson continuation is unavailable in this installation. Keep the original progress and ask the owner to restore the exercise."
      : "Lesson exercise preparation is unavailable in this installation. Reading learning state and teaching content does not prepare an exercise." });

  return Object.freeze([
    definition("courses.list", {}, "Read installed course releases, their ordered topics and exact lesson choices. Read this again before a new start; earlier conversation results may name a now-disabled release. This is read-only; it does not enable a course, start a lesson or prepare a practice project. Drafts and disabled releases cannot be started. A course with status preview can be started only by the workspace owner; canTryPreviews reports whether this person may start lessons of enabled preview courses. Topic IDs identify pinned content, not usage-guide topics. canCreateCourses reports whether this person may create a custom course.", async (_input, actor) => {
      const result = await catalogue.readCatalogue({ includeLessonTitles: true });
      return { ok: true, available: true, revision: result.revision,
        canCreateCourses: actor?.role === "owner" && typeof catalogue.createCourse === "function",
        canTryPreviews: actor?.role === "owner",
        courses: result.courses.map(entry => ({
        ...pick(entry.course, ["courseId", "release", "title", "status"]), enabled: entry.enabled,
        topics: entry.lock.topics.map(topic => ({ topicId: topic.topicId, release: topic.release,
          title: (entry.topicTitles || []).find(value => value.topicId === topic.topicId && value.release === topic.release)?.title || topic.topicId })),
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
    definition("available.list", {}, "Read the official course catalogue this server can install from: its topics (catalogue domains) and their courses, each with release, status, lesson count and whether it is installed and enabled here. When updateFrom is set, this listed release is a newer release of a course installed here at that release; course.install of it is the Update. This is read-only and installs nothing. A course that is not installed cannot be started until it is installed.", async () => {
      if (typeof courseInstaller?.listAvailable !== "function") {
        return { ok: false, available: false, error: "Installing courses from the catalogue is unavailable in this installation. Installed courses are unchanged." };
      }
      const result = await courseInstaller.listAvailable();
      return { ok: true, available: true, repository: result.repository, catalogueCommit: result.commit,
        domains: result.domains, courses: result.courses };
    }),
    definition("course.install", {
      courseId: { ...id, pattern: "^[a-z][a-z0-9-]{0,63}$" },
      release: { ...text, pattern: "^[0-9]+\\.[0-9]+\\.[0-9]+$" }
    }, "Install and enable one exact course release from the official catalogue only after the person's direct request or accepted offer. Read available.list first and use its exact courseId and release. The server downloads each pinned topic at its exact commit, verifies it byte for byte against the catalogue lock and enables the course; it runs no course code and starts no lesson. Repeating it for an installed, enabled course changes nothing. When available.list shows updateFrom, this same action is the course Update: the newer release is installed and enabled and older releases of that course are disabled for new starts only; saved lessons keep their pinned release and can still be resumed, and nothing is deleted. Courses from other sources remain an owner operation outside Vibe64.", async (input, actor) => {
      if (typeof courseInstaller?.installCourse !== "function") {
        return { ok: false, available: false, error: "Installing courses from the catalogue is unavailable in this installation. No course was installed." };
      }
      const result = await courseInstaller.installCourse({ ...pick(input, ["courseId", "release"]), actor });
      return { ok: true, available: true, changed: result.changed === true, catalogueCommit: result.catalogueCommit,
        retired: Array.isArray(result.retired) ? result.retired : [],
        ...(Number.isSafeInteger(result.revision) ? { revision: result.revision } : {}),
        course: { ...pick(result.course, ["courseId", "release", "title", "status"]), enabled: true } };
    }),
    definition("learning.read", {}, "Read this signed-in learner's saved lessons and verified progress: the active attempt, ended attempts in history, every retained attempt in attempts (with practiceSlug when it has a practice project) and per-lesson completion in lessonProgress. This is read-only: no reservation, practice project or repair is performed. A saved preparation phase is an earlier checkpoint, not proof that setup is still running or that Preview is ready; use lesson.resume with the same attemptId to recheck an exercise lesson's setup. Read lesson.read for the active lesson's steps and step results before teaching it.", async (_input, actor) => {
      const result = await learners.readState({ actor, includeCompletion: true });
      const attempts = [];
      for (const attempt of result.progress.attempts) {
        attempts.push(attemptSummary(attempt, await practiceSlug({ attempt, actor, practiceProjects })));
      }
      return { ok: true, available: true, learnerId: result.progress.learnerId, revision: result.revision,
        activeSummaryCurrent: result.activeSummaryCurrent, active: active(result.active), completion: completion(result.completion),
        lessonProgress: (result.lessonCompletions || []).map(value => pick(value, ["lessonCode", "lessonHash", "required", "passed", "completed", "open"])),
        history: result.progress.attempts.filter(value => value.ended).map(active), attempts };
    }),
    definition("courses.create", {
      title: { ...text, noTrim: false, maxLength: 120 },
      topics: { type: "array", required: true, maxLength: 32, items: { type: "object", required: true, schema: createSchema({
        topicId: { ...text, maxLength: 64 }, release: { ...text, pattern: "^[0-9]+\\.[0-9]+\\.[0-9]+$" }
      }) } },
      expectedRevision: revision
    }, "Create a custom course only after the workspace owner's direct request or accepted offer. Read courses.list first and use its revision; choose whole topics, in learning order, from enabled released courses. The course is pinned to those exact installed topic releases and enabled through the original catalogue owner. It never changes lesson content, starts a lesson or grades anything; saved lesson progress counts in every course containing the lesson. Only the workspace owner may create one.", async input => {
      if (typeof catalogue.createCourse !== "function") {
        return { ok: false, available: false, error: "Custom courses are unavailable in this installation. No course was created." };
      }
      const result = await catalogue.createCourse(pick(input, ["title", "topics", "expectedRevision"]));
      return { ok: true, available: true, revision: result.revision,
        course: { ...pick(result.entry.course, ["courseId", "release", "title", "status"]), enabled: result.entry.enabled } };
    }),
    definition("lesson.start", {
      courseId: { ...id, pattern: "^[a-z][a-z0-9-]{0,63}$" },
      release: { ...text, pattern: "^[0-9]+\\.[0-9]+\\.[0-9]+$" },
      lessonCode: id, requestId, expectedRevision: revision
    }, "Start a lesson only after the person's direct request or accepted offer. First read courses.list for an enabled exact release/lesson and learning.read for the current revision; do not use a course result from an earlier turn. Keep the same request ID on an uncertain retry, without changing its selected release. The host reserves the exact actor-owned attempt through normal permissions and prepares a practice project only when the lesson declares an exercise; preparation does not mean Preview is running or that any step passed. If the saved preparation is preparing, the host records ready by itself when that Workspace setup run succeeds; use same-attempt lesson.resume to recheck it. After success, read lesson.read for the returned attempt and open the lesson for the person in Learning. An ended request replay returns its original retained attempt without preparing or reactivating it. An unavailable host is not a successful start.", async (input, actor) => {
      if (typeof exercises?.startLesson !== "function") return unavailable();
      return prepared(await exercises.startLesson({ actor, ...pick(input, ["courseId", "release", "lessonCode", "requestId", "expectedRevision"]) }));
    }),
    definition("lesson.resume", { attemptId }, "Resume an attempt's practice preparation only after the person's direct request or accepted offer. Use this learner's exact saved attempt ID; the original preparation lock and fixed project/session identities preserve it. Use this also when Workspace setup has since finished but the saved checkpoint remains preparing. For an exercise lesson the host freshly reloads this exact reserved session, verifies its setup, and records ready only when proven. A lesson without an exercise keeps its reserved attempt and needs no project/session or ready phase. For actual reported setup status use sessions.inspect for the saved project/session and its workspaceSetupStatus, not repeated learning.read. A pending or failed setup must be reported as observed; do not infer still running or nothing broken from the checkpoint. Do not create another exercise after failure. After success, read lesson.read for this same attempt and continue from its first step that has not passed. Preparation is not current Preview readiness or evidence of a pass.", async (input, actor) => {
      if (typeof exercises?.prepareLesson !== "function") return unavailable();
      return prepared(await exercises.prepareLesson({ actor, attemptId: input.attemptId }));
    }),
    definition("lesson.continue", { attemptId, requestId: { ...requestId, maxLength: 18 }, expectedRevision: revision
    }, "Continue only after the person's direct request or accepted offer for a fresh practice project of an ended saved lesson. Read learning.read and use this learner's exact ended attempt ID and current revision. The host derives its original installed pin; a disabled old release may continue, but arbitrary new admission remains disabled. If the lesson is still active, explain and use lesson.end only when the person requested that retirement. Use a stable continuation request ID of at most 18 characters and keep it on retries. This creates a fresh attempt, and a fresh practice project only when the lesson declares an exercise. Steps already passed in any attempt of the same lesson content still count toward its completion. It does not Stop, close or delete the old project; practice.delete removes it when the person asks. Another active attempt is not adopted or ended. An ended replay returns its retained target and actual current active state without preparing a successor. After success, read lesson.read for the returned attempt and continue its steps that have not passed; setup is not a running Preview or a new pass. An unavailable host or uncertain save is not successful recovery.", async (input, actor) => {
      if (typeof exercises?.continueLesson !== "function") return unavailable("continue");
      return prepared(await exercises.continueLesson({ actor, ...pick(input, ["attemptId", "requestId", "expectedRevision"]) }));
    }),
    definition("lesson.end", { attemptId, requestId, expectedRevision: revision,
      reason: { ...text, enum: ["restart", "discard"] }
    }, "End only after the person's direct request or accepted offer to retire this exact learning attempt. Use its saved attempt ID, current learning revision and a stable end request ID. This retires learning while retaining the exercise and all historical evidence. After the end is saved, its practice project, the project's ordinary sessions, step results and history remain readable and usable. It does not close, archive or delete anything; use practice.delete separately only when the person asks to delete the practice project. Retry the same end identity after an uncertain save. Replaying an old end cannot end a newer attempt; a fresh exercise requires a separately requested lesson.continue of the ended pin, or a new enabled lesson.start.", async (input, actor) => {
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
    definition("read", {}, "Read this signed-in owner's isolated author-preview state and revision: owner trials of draft lessons, kept apart from normal learner progress. It does not read source, install a topic, refresh a preview or affect normal learner progress. Snapshot admission is not a completed trial. A trial attempt opens in Learning like any lesson; read lesson.read with its attempt ID for its steps.", async (_input, actor) => {
      const result = await preview.readState({ actor });
      return { ok: true, available: true, revision: result.revision, activeSummaryCurrent: result.activeSummaryCurrent,
        active: active(result.active), completion: completion(result.completion),
        history: result.progress.attempts.filter(value => value.ended).map(active) };
    }, false),
    definition("start", {
      projectSlug: { ...text, maxLength: 128 }, sessionId: { ...text, maxLength: 128 },
      lessonCode: id, expectedCommit: { ...text, maxLength: 40, pattern: "^[a-f0-9]{40}$" },
      requestId: { ...requestId, maxLength: 18 }, expectedRevision: revision
    }, "Admit a lesson snapshot only after the owner's direct request or accepted offer. Use the exact authorized authoring project/session, clean committed topic root, lesson code, observed 40-character commit and author-preview.read revision. The host reads that exact session under original idle/lifecycle/source guards and installs its immutable snapshot. A local commit is not remote publication or an enabled learner course. Use the same at-most18-character request and unchanged source arguments on uncertain retry; retained reservations reuse their saved pin without reading edited source. A fresh request refuses an active author preview. To explicitly refresh, read author-preview.read, end its exact attempt through lesson.end only when requested, then use a new author-preview.start request for the new committed snapshot and returned revision. Report end confirmed/start pending separately if start fails. Never silently end, replace, retarget or merge ordinary learner progress. Return the exact preview attempt. The trial opens in Learning like any lesson: read lesson.read with its attempt ID and teach its steps. Do not claim a completed trial. A preparation error may follow successful snapshot admission and attempt reservation: reread author-preview.read before describing the outcome, and preserve/resume that exact saved attempt rather than claiming nothing changed. Preparation is not running Preview or a pass. Colleague has no source paths or shell access.", async (input, actor) =>
      prepared(await preview.startLesson({ actor, ...pick(input, ["projectSlug", "sessionId", "lessonCode", "expectedCommit", "requestId", "expectedRevision"]) })), true)
  ]);
}

export { attemptId, attemptSummary, createTrainingActions, createTrainingAuthorPreviewActions, id, operationError, pick, practiceSlug, requestId, text };
