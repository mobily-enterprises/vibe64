import { TRAINING_GUIDE_FILE_PATH, learningVocabulary, trainingPlaceShown } from "./learningVocabulary.js";

// Beats: the short lines the lesson step bar plays for one step. An author
// writes them as a fenced `beats` block that ends the step's Markdown, one
// beat per line: `<show|do|check> <target>[ <arg>]: <text>`.
//   show <place>                  point at a place (auto-advances)
//   do <place|action>[ <path>]    wait until the learner is there or did it
//   check <auto|done|fact>: <text> the step's own check, last
//   check review                  the same, with no text: the bar shows the
//                                 step's check.rubric (lesson.json)
// Places and activities come from a learning vocabulary (learningVocabulary.js):
// the bundler passes the topic's (built-ins plus its declared names), the
// installed reader the built-ins plus this host's.
// The bundler validates them and the installed reader serves them parsed;
// the browser never parses Markdown beats.
const BEATS_MAX = 8;
const TEXT_MAX = 160;
const PROMPT_MAX = 500;
const SEND_TEXT_MAX = 600;
// A check beat names the step's check kind.
const TRAINING_BEAT_CHECKS = Object.freeze({ auto: "auto", review: "review", done: "self", fact: "fact" });
const fence = /^```beats[ \t]*$/mu;
const line = /^(show|do|check)[ \t]+([a-z][a-z-]*)(?:[ \t]+([^:]+?))?[ \t]*(?::[ \t]*(.*))?$/u;
const quoted = /["“]([^"“”]+)["”]/gu;

function beatFailure(message) {
  return Object.assign(new Error(message), { code: "VIBE64_TRAINING_BEATS_INVALID" });
}

// A place that can complete a `do` beat: one the learner can be at, or one
// whose page activity completes it. A topic's declared names are trusted by
// name; the host that registers them owns their meaning.
const doable = (target, vocabulary) => Boolean(vocabulary.activity(target) || vocabulary.place(target)?.event ||
  trainingPlaceShown(target, {}, vocabulary) !== null || vocabulary.declared?.(target));
const knownPlace = (target, vocabulary) => Boolean(vocabulary.place(target) || vocabulary.declaredPlace?.(target));

function parseBeat(source, number, vocabulary) {
  const match = line.exec(source);
  if (!match) throw beatFailure(`beat ${number} must read "<show|do|check> <target>: <text>".`);
  const [, kind, target, arg, text = ""] = match;
  const label = `beat ${number} (${kind} ${target})`;
  if (kind === "check" && target === "review") {
    if (text.trim() || arg !== undefined) throw beatFailure(`${label} takes no text: the bar shows the step's check.rubric.`);
    return { kind, target, text: "" };
  }
  if (!text.trim()) throw beatFailure(`${label} needs its text after the colon.`);
  const beat = { kind, target, text: text.trim() };
  if (arg !== undefined && !(kind === "do" && target === "file-opened")) throw beatFailure(`${label} takes no argument; only do file-opened names a path.`);
  if (kind === "show" && !knownPlace(target, vocabulary)) throw beatFailure(`${label} names an unknown place.`);
  if (kind === "do" && !doable(target, vocabulary)) throw beatFailure(`${label} names nothing the learner can do or be at.`);
  if (kind === "check" && !TRAINING_BEAT_CHECKS[target]) throw beatFailure(`${label} must be check auto, review, done or fact.`);
  if (arg !== undefined) {
    if (!TRAINING_GUIDE_FILE_PATH.test(arg)) throw beatFailure(`${label} needs a relative practice project file path without '..'.`);
    beat.path = arg;
  }
  const limit = target === "send-message" ? SEND_TEXT_MAX : TEXT_MAX;
  if (beat.text.length > limit) throw beatFailure(`${label} text is longer than ${limit} characters.`);
  if (target === "send-message") {
    const prompts = [...beat.text.matchAll(quoted)].map(value => value[1].trim());
    if (prompts.length !== 1 || !prompts[0] || prompts[0].length > PROMPT_MAX) {
      throw beatFailure(`${label} needs exactly one quoted prompt of at most ${PROMPT_MAX} characters.`);
    }
    beat.prompt = prompts[0];
  }
  return beat;
}

// Splits a step's Markdown into its readable body and its beats (null when it
// has no beats block). Throws VIBE64_TRAINING_BEATS_INVALID with the reason.
function splitStepBeats(markdown, vocabulary = learningVocabulary) {
  const source = String(markdown ?? "");
  const start = fence.exec(source);
  if (!start) return { body: source, beats: null };
  const rest = source.slice(start.index + start[0].length);
  const close = /^```[ \t]*$/mu.exec(rest);
  if (!close) throw beatFailure("the beats block is not closed with ```.");
  if (rest.slice(close.index + close[0].length).trim()) throw beatFailure("the beats block must end the step text.");
  const lines = rest.slice(0, close.index).split("\n").map(value => value.trim()).filter(Boolean);
  if (!lines.length || lines.length > BEATS_MAX) throw beatFailure(`a beats block holds 1 to ${BEATS_MAX} beats.`);
  const beats = lines.map((value, index) => parseBeat(value, index + 1, vocabulary));
  const checks = beats.filter(beat => beat.kind === "check");
  if (checks.length > 1 || (checks.length && beats.at(-1).kind !== "check")) throw beatFailure("a step has at most one check beat, and it is the last.");
  return { body: source.slice(0, start.index).replace(/\s+$/u, "\n"), beats };
}

// The place a beat points at (an activity's place), or "" (a check, or an
// activity with no place).
function beatPlace(beat, vocabulary = learningVocabulary) {
  if (!beat || beat.kind === "check") return "";
  const activity = vocabulary.activity(beat.target);
  return activity ? activity.place || "" : beat.target;
}

// A beat that only exists in a practice project: one at a project place, or
// an auto or review check (both read the practice project). Declared names
// are the registering host's; their scope is not known to the bundler.
function beatNeedsPracticeProject(beat, vocabulary = learningVocabulary) {
  if (beat.kind === "check") return beat.target === "auto" || beat.target === "review";
  const place = vocabulary.place(beatPlace(beat, vocabulary));
  if (place) return place.scope === "project";
  // An activity without a place (agent-finished) happens in a practice project.
  return !vocabulary.declared?.(beat.target);
}

export { TRAINING_BEAT_CHECKS, beatNeedsPracticeProject, beatPlace, splitStepBeats };
