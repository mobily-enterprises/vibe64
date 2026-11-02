import { createSchema } from "@jskit-ai/kernel/shared/validators";
import { WORKSPACE_OPERATION, WORKSPACE_OWNER_OPERATION } from "@local/vibe64-core/server/actionContext";
import { VIBE64_COMMAND, VIBE64_QUERY } from "@local/vibe64-core/shared/actionFields";
import { attemptId, courseId, id, release, requestId, resultOutput, revision, text } from "./actionSchemas.js";

/** @typedef {import("./types.js").TrainingOperations} TrainingOperations */

const TRAINING_ACTIONS = Object.freeze({
  CREATE_COURSE: "vibe64.training.courses.create",
  FINISH_LESSON: "vibe64.training.lesson.finish",
  INSTALL_COURSE: "vibe64.training.course.install",
  LIST_AVAILABLE_COURSES: "vibe64.training.available.list",
  LIST_COURSES: "vibe64.training.courses.list",
  READ_LEARNING: "vibe64.training.learning.read",
  READ_LEARNING_MODE: "vibe64.training.learning-mode.read",
  RESTART_LESSON: "vibe64.training.lesson.restart",
  RESUME_LESSON: "vibe64.training.lesson.resume",
  SET_LEARNING_MODE: "vibe64.training.learning-mode.set",
  START_LESSON: "vibe64.training.lesson.start"
});

/**
 * Training's course, learning and lesson actions, each one call on its operation.
 * @param {object} dependencies
 * @param {TrainingOperations} dependencies.operations
 */
function createTrainingActions({ operations }) {
  return Object.freeze([
    Object.freeze({
      ...VIBE64_QUERY,
      id: TRAINING_ACTIONS.LIST_COURSES,
      input: { mode: "create", schema: createSchema({}) },
      extensions: {
        assistant: {
          alwaysAvailable: true,
          output: resultOutput,
          description: "Read installed course releases, their ordered topics and exact lesson choices. Read this again before a new start; earlier conversation results may name a now-disabled release. This is read-only; it does not enable a course, start a lesson or prepare a practice project. Drafts and disabled releases cannot be started. A course with status preview can be started only by the workspace owner; canTryPreviews reports whether this person may start lessons of enabled preview courses. Topic IDs identify pinned content, not usage-guide topics. canCreateCourses reports whether this person may create a custom course. orientation, when set, is the course's studio lesson that Take the tour starts. Lessons this person cannot take here (they need screens this installation does not have, or not for them) are left out, as is a topic left without lessons. unusableLessons names installed lessons this version of Vibe64 cannot teach (a newer course release or Vibe64 fixes them); they cannot be started."
        },
        vibe64: WORKSPACE_OPERATION
      },
      execute: (input, context) => operations.listCourses(input, context)
    }),
    Object.freeze({
      ...VIBE64_QUERY,
      id: TRAINING_ACTIONS.LIST_AVAILABLE_COURSES,
      input: { mode: "create", schema: createSchema({}) },
      extensions: {
        assistant: {
          alwaysAvailable: true,
          output: resultOutput,
          description: "Read the official course catalogue this server can install from: its topics (catalogue domains) and their courses, each with release, status, lesson count and whether it is installed and enabled here. When updateFrom is set, this listed release is a newer release of a course installed here at that release; course.install of it is the Update. This is read-only and installs nothing. A course that is not installed cannot be started until it is installed."
        },
        vibe64: WORKSPACE_OPERATION
      },
      execute: (input, context) => operations.listAvailableCourses(input, context)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: TRAINING_ACTIONS.INSTALL_COURSE,
      input: {
        mode: "create",
        schema: createSchema({
          courseId,
          release
        })
      },
      extensions: {
        assistant: {
          alwaysAvailable: true,
          output: resultOutput,
          description: "Install and enable one exact course release from the official catalogue only after the person's direct request or accepted offer. Read available.list first and use its exact courseId and release. The server downloads each pinned topic at its exact commit, verifies it byte for byte against the catalogue lock and enables the course; it runs no course code and starts no lesson. Repeating it for an installed, enabled course changes nothing. A release disabled on this server (available.list installed: disabled) is refused for everyone, the owner included: installing never enables it again, and only the server's operator can. When available.list shows updateFrom, this same action is the course Update: the newer release is installed and enabled and the older releases of that course, listed in retired, are removed from the installed courses, freeing their places; saved lessons keep their pinned lesson content and can still be resumed, and lesson content and progress are not deleted. The server keeps at most 16 installed course releases; only the server's operator can remove one to free a place. Courses from other sources remain an owner operation outside Vibe64."
        },
        vibe64: WORKSPACE_OPERATION
      },
      execute: (input, context) => operations.installCourse(input, context)
    }),
    Object.freeze({
      ...VIBE64_QUERY,
      id: TRAINING_ACTIONS.READ_LEARNING,
      input: { mode: "create", schema: createSchema({}) },
      extensions: {
        assistant: {
          alwaysAvailable: true,
          output: resultOutput,
          description: "Read this signed-in learner's saved lessons and verified progress: the active attempt, ended attempts in history, every retained attempt in attempts (with practiceSlug when it has a practice project) and per-lesson completion in lessonProgress. This is read-only: no reservation, practice project or repair is performed. A saved preparation phase is an earlier checkpoint, not proof that setup is still running or that Preview is ready; use lesson.resume with the same attemptId to recheck an exercise lesson's setup. Read lesson.read for the active lesson's steps and step results before teaching it.",
          transformResult(result) {
            // Own identity binds the browser's lesson requests (L), never the model's tool result.
            const visible = { ...result };
            delete visible.learnerId;
            return visible;
          }
        },
        vibe64: WORKSPACE_OPERATION
      },
      execute: (input, context) => operations.readLearning(input, context)
    }),
    Object.freeze({
      ...VIBE64_QUERY,
      id: TRAINING_ACTIONS.READ_LEARNING_MODE,
      input: { mode: "create", schema: createSchema({}) },
      extensions: {
        assistant: {
          alwaysAvailable: true,
          output: resultOutput,
          description: "Read whether this signed-in person is in Learn mode or Develop mode. Vibe64 has two modes with the same screens: Develop works on the person's real projects; Learn works only on their practice projects, with Colleague as the teacher. on is true in Learn mode; currentAttemptId, lessonCode and lessonTitle name the lesson in progress (empty when there is none, which is normal in Learn mode), lessonStage where it runs (studio: the screens outside any project; project: its practice project) and practiceSlug its practice project (empty while it is being prepared or when the lesson has none). Switching mode never ends or changes a lesson. This is read-only."
        },
        vibe64: WORKSPACE_OPERATION
      },
      execute: (input, context) => operations.readLearningMode(input, context)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: TRAINING_ACTIONS.SET_LEARNING_MODE,
      input: {
        mode: "create",
        schema: createSchema({ on: { type: "boolean", required: true } })
      },
      extensions: {
        assistant: {
          alwaysAvailable: true,
          output: resultOutput,
          description: "Switch this signed-in person between Learn mode (on: true) and Develop mode (on: false), only after the person's direct request or accepted offer; pressing L does the same. Nothing is ended or archived: the lesson in progress stays paused with its practice project and its teacher conversation, and comes back when they return to Learn. Setting the mode it already has changes nothing."
        },
        vibe64: WORKSPACE_OPERATION
      },
      execute: (input, context) => operations.setLearningMode(input, context)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: TRAINING_ACTIONS.CREATE_COURSE,
      input: {
        mode: "create",
        schema: createSchema({
          title: { ...text, noTrim: false, maxLength: 120 },
          topics: {
            type: "array",
            required: true,
            maxLength: 32,
            items: {
              type: "object",
              required: true,
              schema: createSchema({
                topicId: { ...text, maxLength: 64 },
                release
              })
            }
          },
          expectedRevision: revision
        })
      },
      extensions: {
        assistant: {
          alwaysAvailable: true,
          output: resultOutput,
          description: "Create a custom course only after the workspace owner's direct request or accepted offer. Read courses.list first and use its revision; choose whole topics, in learning order, from enabled released courses. The course is pinned to those exact installed topic releases and enabled through the original catalogue owner. It never changes lesson content, starts a lesson or grades anything; saved lesson progress counts in every course containing the lesson. Only the workspace owner may create one."
        },
        vibe64: WORKSPACE_OWNER_OPERATION
      },
      execute: (input, context) => operations.createCourse(input, context)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: TRAINING_ACTIONS.START_LESSON,
      input: {
        mode: "create",
        schema: createSchema({
          courseId,
          release,
          lessonCode: id,
          requestId,
          expectedRevision: revision,
          archiveCurrent: { type: "boolean", required: false }
        })
      },
      extensions: {
        assistant: {
          alwaysAvailable: true,
          output: resultOutput,
          description: "Start a lesson only after the person's direct request or accepted offer. First read courses.list for an enabled exact release/lesson and learning.read for the current revision; do not use a course result from an earlier turn. Keep the same request ID on an uncertain retry, without changing its selected release. Only one lesson can be in progress: when another lesson is in progress the start is refused with VIBE64_TRAINING_LESSON_IN_PROGRESS and that lesson's title; tell the person, and only after they confirm archiving it repeat with archiveCurrent: true (its project and conversation are archived, its results kept). Starting the lesson already in progress returns it. A start switches the person to Learn mode. The host reserves the exact actor-owned attempt and prepares a practice project only when the lesson declares an exercise; preparation does not mean Preview is running or that any step passed. If the saved preparation is preparing, the host records ready by itself when that Workspace setup run succeeds; use same-attempt lesson.resume to recheck it. After success, read lesson.read for the returned attempt. An ended request replay returns its original retained attempt without preparing or reactivating it. An unavailable host is not a successful start."
        },
        vibe64: WORKSPACE_OPERATION
      },
      execute: (input, context) => operations.startLesson(input, context)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: TRAINING_ACTIONS.RESUME_LESSON,
      input: { mode: "create", schema: createSchema({ attemptId }) },
      extensions: {
        assistant: {
          alwaysAvailable: true,
          output: resultOutput,
          description: "Resume an attempt's practice preparation only after the person's direct request or accepted offer. Use this learner's exact saved attempt ID; the original preparation lock and fixed project/session identities preserve it. Use this also when Workspace setup has since finished but the saved checkpoint remains preparing. For an exercise lesson the host freshly reloads this exact reserved session, verifies its setup, and records ready only when proven. A lesson without an exercise has no practice project, session or preparation phase. For actual reported setup status use sessions.inspect for the saved project/session and its workspaceSetupStatus, not repeated learning.read. A pending or failed setup must be reported as observed; do not infer still running or nothing broken from the checkpoint. Do not create another exercise after failure. After success, read lesson.read for this same attempt and continue from its first step that has not passed. Preparation is not current Preview readiness or evidence of a pass."
        },
        vibe64: WORKSPACE_OPERATION
      },
      execute: (input, context) => operations.resumeLesson(input, context)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: TRAINING_ACTIONS.RESTART_LESSON,
      input: {
        mode: "create",
        schema: createSchema({
          attemptId,
          requestId,
          expectedRevision: revision,
          confirmed: { type: "boolean", required: false }
        })
      },
      extensions: {
        assistant: {
          alwaysAvailable: true,
          output: resultOutput,
          description: "Restart the lesson in progress only after the person asked for it and then confirmed restarting this exact lesson in the conversation; pass confirmed: true only then, or the restart is refused with VIBE64_TRAINING_LESSON_UNCONFIRMED and nothing changes. Name the lesson and say what is kept. Use its exact attemptId and the current revision from learning.read. The attempt is archived (its practice project, step results and teacher conversation are kept in Courses, Archived) and a new attempt of the same lesson starts with a fresh practice project, a fresh teacher conversation and no results. Keep the same request ID on an uncertain retry; it finishes a restart that stopped part-way. A pinned session or a full archive (20 lessons) refuses the restart and changes nothing."
        },
        vibe64: WORKSPACE_OPERATION
      },
      execute: (input, context) => operations.restartLesson(input, context)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: TRAINING_ACTIONS.FINISH_LESSON,
      input: {
        mode: "create",
        schema: createSchema({ attemptId, expectedRevision: revision })
      },
      extensions: {
        assistant: {
          alwaysAvailable: true,
          output: resultOutput,
          description: "Finish the lesson in progress only after the person asked for it, and only once every required step has passed (lesson.read completion); otherwise it is refused and nothing changes. Use its exact attemptId and the current revision from learning.read; a retry of the same attempt resumes it. The lesson counts as completed for good, and the attempt is archived as one bundle: its record, its practice project (if the lesson has one) and its teacher conversation. A pinned session or a full archive (20 lessons) refuses and changes nothing."
        },
        vibe64: WORKSPACE_OPERATION
      },
      execute: (input, context) => operations.finishLesson(input, context)
    })
  ]);
}

export { createTrainingActions, TRAINING_ACTIONS };
