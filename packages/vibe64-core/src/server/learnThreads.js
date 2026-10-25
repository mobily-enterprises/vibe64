import path from "node:path";
import { practiceLearnerKey } from "./learningSpace.js";
import { currentOsUser } from "./osUserIdentity.js";

// Learn-mode assistant conversations. Each lesson attempt has its own teacher
// thread, and Learn mode without a lesson has one learner-level lobby thread.
// Colleague owns the thread files; Training closes an attempt by asking
// Colleague to release its thread (stop using it and drop its live runtime)
// and then moves or removes the file. Training never imports Colleague.

const ATTEMPT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const LEARNER_KEY_PATTERN = /^[\w-]{1,512}$/u;

let learnThreadReleaser = null;

function learnThreadName(attemptId = "") {
  if (!attemptId) return "lobby";
  if (!ATTEMPT_ID_PATTERN.test(attemptId)) throw new TypeError("A Learn thread needs an exact lesson attempt ID.");
  return attemptId;
}

function assertLearnerKey(learnerKey) {
  if (!LEARNER_KEY_PATTERN.test(String(learnerKey || ""))) throw new TypeError("A Learn thread needs its learner key.");
}

// <sys>/colleague/<learnerKey>/learn/<attemptId>.json, or learn/lobby.json.
function learnThreadFile({ systemRoot, learnerKey, attemptId = "" } = {}) {
  if (!path.isAbsolute(systemRoot || "")) throw new TypeError("A Learn thread needs the application system root.");
  assertLearnerKey(learnerKey);
  return path.join(systemRoot, "colleague", learnerKey, "learn", `${learnThreadName(attemptId)}.json`);
}

// The learner key Training uses for the person: their actor, or on the local
// editor (no signed-in person) this computer's user.
function learnThreadLearnerKey(actor = null) {
  return practiceLearnerKey(actor || currentOsUser());
}

// One releaser per process; the returned function unregisters it.
function registerLearnThreadReleaser(releaser) {
  if (typeof releaser !== "function") throw new TypeError("A Learn thread releaser must be a function.");
  learnThreadReleaser = releaser;
  return () => { if (learnThreadReleaser === releaser) learnThreadReleaser = null; };
}

// No-op when no assistant registered a releaser.
async function releaseLearnThread({ learnerKey, attemptId } = {}) {
  assertLearnerKey(learnerKey);
  learnThreadName(attemptId);
  if (learnThreadReleaser) await learnThreadReleaser({ learnerKey, attemptId });
}

export { learnThreadFile, learnThreadLearnerKey, registerLearnThreadReleaser, releaseLearnThread };
