import { createSchema } from "@jskit-ai/kernel/shared/validators";
import { authenticatedVibe64User, withVibe64ActionContext } from "@local/vibe64-core/server/actionContext";
import { lessonAvailableTo } from "./lessonAvailability.js";

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
    learningMode: { ...opaque, required: false },
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

function active(value) {
  if (!value) return null;
  return {
    attemptId: value.attemptId, pin: pin(value.pin),
    ...(value.preparation ? { projectSlug: value.projectSlug, preparation: preparation(value.preparation) } : {}),
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
// The learning space says whether it still exists; a deleted or archived one
// is left out (learning.read lists attempts with their slug). A presence check
// that fails keeps the project listed instead of failing the whole read: one
// bad record must not hide the learner's progress.
async function practiceSlug({ attempt, actor, learningSpace }) {
  const slug = attempt.projectSlug;
  if (!attempt.preparation || attempt.preparation.phase === "reserved") return "";
  if (typeof learningSpace?.exists !== "function") return slug;
  try {
    return await learningSpace.exists({ actor, attemptId: attempt.attemptId }) ? slug : "";
  } catch {
    return slug;
  }
}

function attemptSummary(attempt, slug = "") {
  const failure = attempt.preparation?.failure;
  return {
    attemptId: attempt.attemptId,
    pin: pin(attempt.pin),
    ...(attempt.preparation ? { preparation: { ...pick(attempt.preparation, ["phase", "observedAt"]),
      ...(failure ? { failure: pick(failure, ["code", "message"]) } : {}) } } : {}),
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
function createTrainingActions({ catalogue, learners, content = null, exercises = null, courseInstaller = null, learningSpace = null,
  publishLearnerChanged = null } = {}) {
  if (typeof catalogue?.readCatalogue !== "function" || typeof learners?.readState !== "function") {
    throw new TypeError("Training actions require the installed catalogue and learner state owners.");
  }
  // A pinned lesson's steps never change, so each is read once; who may take
  // them is decided per read (lessonAvailability.js). Without the installed
  // reader (actions composed for catalogue reads only) every lesson is listed.
  const pinnedSteps = new Map();
  async function lessonListedFor(actor, topic, lesson) {
    if (typeof content?.readLesson !== "function") return true;
    const key = JSON.stringify([topic.topicId, topic.commit, topic.manifestHash, lesson.code, lesson.hash]);
    if (!pinnedSteps.has(key)) {
      pinnedSteps.set(key, content.readLesson({ topicId: topic.topicId, commit: topic.commit, topicHash: topic.manifestHash,
        lessonCode: lesson.code, lessonHash: lesson.hash }).then(read => read.steps || [],
        error => error?.code === "VIBE64_TRAINING_LESSON_UNUSABLE" ? "unusable" : null));
    }
    const steps = await pinnedSteps.get(key);
    // One this Vibe64 cannot teach is left out and named on its course.
    if (steps === "unusable") return "unusable";
    // A lesson that cannot be read here (a draft, a retired format) stays listed; starting it explains.
    return steps === null || lessonAvailableTo({ steps }, actor);
  }
  const definition = (name, fields, description, execute) => withVibe64ActionContext({
    id: `vibe64.training.${name}`, version: 1,
    kind: name.endsWith("read") || name.endsWith("list") ? "query" : "command",
    input: { mode: "create", schema: createSchema(fields) }, output: null,
    idempotency: ["lesson.start", "lesson.resume", "lesson.restart", "lesson.finish", "learning-mode.set", "course.install"].includes(name) ? "domain_native" : "none",
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
        // Lesson refusals (a preview course, another lesson in progress with
        // its details, an incomplete lesson, the archive limit or a pinned
        // session) report their own message; nothing was changed.
        if (/^lesson\./u.test(name) && cause.statusCode < 500 &&
            /^(VIBE64_TRAINING_(COURSE_PREVIEW|LESSON_|PRACTICE_|ATTEMPT_MISSING|STATE_REVISION)|vibe64_project_pinned)/u.test(cause.code || "")) throw cause;
        // Catalogue reads and installs report their owner's corrective message.
        if (["available.list", "course.install"].includes(name)) throw installError(cause);
        throw operationError(cause);
      }
    }
  }, { projectScoped: false, ...(name === "courses.create" ? { ownerRequired: true } : {}) });

  const unavailable = (operation = "preparation") => ({ ok: false, available: false,
    error: operation === "close" ? "Finishing or restarting lessons is unavailable in this installation. Nothing was changed."
      : "Lesson exercise preparation is unavailable in this installation. Reading learning state and teaching content does not prepare an exercise." });

  // Learn mode (Rev 4 H1): a saved per-learner flag, separate from any
  // lesson; the current lesson is the one in progress. The shell and
  // Colleague read it; every tab of this learner rereads it on
  // vibe64.training.learner.changed.
  const modeAvailable = typeof learners.readLearningMode === "function";
  const learningModeView = mode => mode ? pick(mode, ["on", "currentAttemptId", "lessonCode", "lessonTitle", "lessonStage", "practiceSlug"]) : { on: false };
  const notifyLearner = async (actor, attemptId, reason = "lesson") => {
    if (typeof publishLearnerChanged === "function") await publishLearnerChanged({ actor, attemptId, reason });
  };
  // Starting, restarting, resuming or finishing a lesson changes the current
  // lesson. A failure may already have changed it (the mode set, the old
  // attempt archived), so every tab rereads either way.
  const announced = async (actor, operation, attemptId = "") => {
    let result;
    try { result = await operation(); }
    catch (error) {
      await notifyLearner(actor, attemptId).catch(() => {});
      throw error;
    }
    await notifyLearner(actor, result?.active?.attemptId || result?.attempt?.attemptId || attemptId);
    return result;
  };

  return Object.freeze([
    definition("courses.list", {}, "Read installed course releases, their ordered topics and exact lesson choices. Read this again before a new start; earlier conversation results may name a now-disabled release. This is read-only; it does not enable a course, start a lesson or prepare a practice project. Drafts and disabled releases cannot be started. A course with status preview can be started only by the workspace owner; canTryPreviews reports whether this person may start lessons of enabled preview courses. Topic IDs identify pinned content, not usage-guide topics. canCreateCourses reports whether this person may create a custom course. orientation, when set, is the course's studio lesson that Take the tour starts. Lessons this person cannot take here (they need screens this installation does not have, or not for them) are left out, as is a topic left without lessons. unusableLessons names installed lessons this version of Vibe64 cannot teach (a newer course release or Vibe64 fixes them); they cannot be started.", async (_input, actor) => {
      const result = await catalogue.readCatalogue({ includeLessonTitles: true });
      const courses = [];
      for (const entry of result.courses) {
        // A lesson this person cannot take here (its places are not this
        // installation's, or not open to them) is left out, as is a topic left empty.
        const lessons = [];
        const unusable = [];
        for (const topic of entry.lock.topics) {
          for (const lesson of topic.lessons) {
            const listed = await lessonListedFor(actor, topic, lesson);
            if (listed === "unusable") unusable.push({ topic, lesson });
            else if (listed) lessons.push({ topic, lesson });
          }
        }
        const topics = entry.lock.topics.filter(topic => lessons.some(item => item.topic === topic));
        courses.push({ entry, topics, lessons, unusable });
      }
      return { ok: true, available: true, revision: result.revision,
        canCreateCourses: actor?.role === "owner" && typeof catalogue.createCourse === "function",
        canTryPreviews: actor?.role === "owner",
        courses: courses.map(({ entry, topics, lessons, unusable }) => ({
        ...pick(entry.course, ["courseId", "release", "title", "status", "orientation"]), enabled: entry.enabled,
        topics: topics.map(topic => ({ topicId: topic.topicId, release: topic.release,
          title: (entry.topicTitles || []).find(value => value.topicId === topic.topicId && value.release === topic.release)?.title || topic.topicId })),
        lessons: lessons.map(({ topic, lesson }) => {
          const matches = (entry.lessonTitles || []).filter(value => value.topicId === topic.topicId &&
            value.topicRelease === topic.release && value.code === lesson.code && value.hash === lesson.hash);
          const title = matches[0]?.title;
          if (matches.length !== 1 || typeof title !== "string" || title.length < text.minLength || title.length > text.maxLength) {
            throw new Error("The installed catalogue did not return one bounded title for this exact lesson pin.");
          }
          return { ...pick(lesson, ["code", "hash", "status", "required"]),
            title, topicId: topic.topicId, topicRelease: topic.release };
        }),
        // Installed lessons this version of Vibe64 cannot teach, by title.
        unusableLessons: unusable.map(({ topic, lesson }) => ({ code: lesson.code,
          title: (entry.lessonTitles || []).find(value => value.topicId === topic.topicId && value.topicRelease === topic.release &&
            value.code === lesson.code && value.hash === lesson.hash)?.title || lesson.code }))
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
        attempts.push(attemptSummary(attempt, await practiceSlug({ attempt, actor, learningSpace })));
      }
      return { ok: true, available: true, learnerId: result.progress.learnerId, revision: result.revision,
        activeSummaryCurrent: result.activeSummaryCurrent, active: active(result.active), completion: completion(result.completion),
        lessonProgress: (result.lessonCompletions || []).map(value => pick(value, ["lessonCode", "lessonHash", "required", "passed", "completed", "open"])),
        history: result.progress.attempts.filter(value => value.ended).map(active), attempts,
        // An unreadable mode record must not hide the learner's progress.
        ...(modeAvailable ? await learners.readLearningMode({ actor, includeTitle: true })
          .then(mode => ({ learningMode: learningModeView(mode) }), () => ({})) : {}) };
    }),
    definition("learning-mode.read", {}, "Read whether this signed-in person is in Learn mode or Develop mode. Vibe64 has two modes with the same screens: Develop works on the person's real projects; Learn works only on their practice projects, with Colleague as the teacher. on is true in Learn mode; currentAttemptId, lessonCode and lessonTitle name the lesson in progress (empty when there is none, which is normal in Learn mode), lessonStage where it runs (studio: the screens outside any project; project: its practice project) and practiceSlug its practice project (empty while it is being prepared or when the lesson has none). Switching mode never ends or changes a lesson. This is read-only.", async (_input, actor) => {
      if (!modeAvailable) return { ok: false, available: false, error: "Learn mode is unavailable in this installation." };
      return { ok: true, available: true, learningMode: learningModeView(await learners.readLearningMode({ actor, includeTitle: true })) };
    }),
    definition("learning-mode.set", { on: { type: "boolean", required: true } }, "Switch this signed-in person between Learn mode (on: true) and Develop mode (on: false), only after the person's direct request or accepted offer; pressing L does the same. Nothing is ended or archived: the lesson in progress stays paused with its practice project and its teacher conversation, and comes back when they return to Learn. Setting the mode it already has changes nothing.", async (input, actor) => {
      if (typeof learners.setLearningMode !== "function") return { ok: false, available: false, error: "Learn mode is unavailable in this installation." };
      const changed = (await learners.readLearningMode({ actor })).on !== input.on;
      if (changed) {
        await learners.setLearningMode({ actor, on: input.on });
        await notifyLearner(actor, "", "learning-mode");
      }
      return { ok: true, available: true, changed, learningMode: learningModeView(await learners.readLearningMode({ actor, includeTitle: true })) };
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
      lessonCode: id, requestId, expectedRevision: revision,
      archiveCurrent: { type: "boolean", required: false }
    }, "Start a lesson only after the person's direct request or accepted offer. First read courses.list for an enabled exact release/lesson and learning.read for the current revision; do not use a course result from an earlier turn. Keep the same request ID on an uncertain retry, without changing its selected release. Only one lesson can be in progress: when another lesson is in progress the start is refused with VIBE64_TRAINING_LESSON_IN_PROGRESS and that lesson's title; tell the person, and only after they confirm archiving it repeat with archiveCurrent: true (its project and conversation are archived, its results kept). Starting the lesson already in progress returns it. A start switches the person to Learn mode. The host reserves the exact actor-owned attempt and prepares a practice project only when the lesson declares an exercise; preparation does not mean Preview is running or that any step passed. If the saved preparation is preparing, the host records ready by itself when that Workspace setup run succeeds; use same-attempt lesson.resume to recheck it. After success, read lesson.read for the returned attempt. An ended request replay returns its original retained attempt without preparing or reactivating it. An unavailable host is not a successful start.", async (input, actor) => {
      if (typeof exercises?.startLesson !== "function") return unavailable();
      return announced(actor, async () => prepared(await exercises.startLesson({ actor,
        ...pick(input, ["courseId", "release", "lessonCode", "requestId", "expectedRevision", "archiveCurrent"]) })));
    }),
    definition("lesson.resume", { attemptId }, "Resume an attempt's practice preparation only after the person's direct request or accepted offer. Use this learner's exact saved attempt ID; the original preparation lock and fixed project/session identities preserve it. Use this also when Workspace setup has since finished but the saved checkpoint remains preparing. For an exercise lesson the host freshly reloads this exact reserved session, verifies its setup, and records ready only when proven. A lesson without an exercise has no practice project, session or preparation phase. For actual reported setup status use sessions.inspect for the saved project/session and its workspaceSetupStatus, not repeated learning.read. A pending or failed setup must be reported as observed; do not infer still running or nothing broken from the checkpoint. Do not create another exercise after failure. After success, read lesson.read for this same attempt and continue from its first step that has not passed. Preparation is not current Preview readiness or evidence of a pass.", async (input, actor) => {
      if (typeof exercises?.prepareLesson !== "function") return unavailable();
      return announced(actor, async () => prepared(await exercises.prepareLesson({ actor, attemptId: input.attemptId })), input.attemptId);
    }),
    definition("lesson.restart", { attemptId, requestId, expectedRevision: revision }, "Restart the lesson in progress only after the person asked for it and confirmed it. Use its exact attemptId and the current revision from learning.read. The attempt is archived (its practice project, step results and teacher conversation are kept in Courses, Archived) and a new attempt of the same lesson starts with a fresh practice project, a fresh teacher conversation and no results. Keep the same request ID on an uncertain retry; it finishes a restart that stopped part-way. A pinned session or a full archive (20 lessons) refuses the restart and changes nothing.", async (input, actor) => {
      if (typeof exercises?.restartLesson !== "function") return unavailable("close");
      return announced(actor, async () => prepared(await exercises.restartLesson({ actor,
        ...pick(input, ["attemptId", "requestId", "expectedRevision"]) })), input.attemptId);
    }),
    definition("lesson.finish", { attemptId, expectedRevision: revision }, "Finish the lesson in progress only after the person asked for it, and only once every required step has passed (lesson.read completion); otherwise it is refused and nothing changes. Use its exact attemptId and the current revision from learning.read; a retry of the same attempt resumes it. The lesson counts as completed for good, and the attempt is archived as one bundle: its record, its practice project (if the lesson has one) and its teacher conversation. A pinned session or a full archive (20 lessons) refuses and changes nothing.", async (input, actor) => {
      if (typeof exercises?.finishLesson !== "function") return unavailable("close");
      const result = await announced(actor, () => exercises.finishLesson({ actor, ...pick(input, ["attemptId", "expectedRevision"]) }),
        input.attemptId);
      return { ok: true, available: true, changed: result.closed === true };
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
    }, "Admit a lesson snapshot only after the owner's direct request or accepted offer. Use the exact authorized authoring project/session, clean committed topic root, lesson code, observed 40-character commit and author-preview.read revision. The host reads that exact session under original idle/lifecycle/source guards and installs its immutable snapshot. A local commit is not remote publication or an enabled learner course. Use the same at-most18-character request and unchanged source arguments on uncertain retry; retained reservations reuse their saved pin without reading edited source. A fresh request refuses an active author preview. To explicitly refresh, read author-preview.read, delete its exact attempt through lesson.delete only when requested, then use a new author-preview.start request for the new committed snapshot and returned revision. Report end confirmed/start pending separately if start fails. Never silently end, replace, retarget or merge ordinary learner progress. Return the exact preview attempt. The trial opens in Learning like any lesson: read lesson.read with its attempt ID and teach its steps. Do not claim a completed trial. A preparation error may follow successful snapshot admission and attempt reservation: reread author-preview.read before describing the outcome, and preserve/resume that exact saved attempt rather than claiming nothing changed. Preparation is not running Preview or a pass. Colleague has no source paths or shell access.", async (input, actor) =>
      prepared(await preview.startLesson({ actor, ...pick(input, ["projectSlug", "sessionId", "lessonCode", "expectedCommit", "requestId", "expectedRevision"]) })), true)
  ]);
}

export { attemptId, attemptSummary, createTrainingActions, createTrainingAuthorPreviewActions, id, operationError, pick, practiceSlug, requestId, revision, text };
