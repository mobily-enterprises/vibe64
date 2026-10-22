import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { topicSchema, visualSchema, validateContent, validateLesson } from "./contentSchemas.js";
import { trainingGuideRequest } from "../shared/guideTargets.js";

const excludedExerciseEntries = new Set([".git", "node_modules", ".genesis"]);
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const validId = value => /^[a-zA-Z][a-zA-Z0-9-]{0,63}$/u.test(value);

function uniqueIds(items, key, label) {
  const seen = new Set();
  for (const item of items) {
    const value = key ? item[key] : item;
    if (!validId(value) || seen.has(value)) throw new Error(`${label}: invalid or duplicate ID ${value}.`);
    seen.add(value);
  }
  return seen;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function recordBundleFile(files, file) {
  const previous = files.get(file.path);
  if (previous && (previous.sha256 !== file.sha256 || previous.bytes !== file.bytes)) throw new Error(`Source changed between lesson snapshots: ${file.path}. Validate and retry.`);
  files.set(file.path, file);
}

function bundleFiles(manifests) {
  const files = new Map();
  for (const manifest of manifests) {
    for (const file of manifest.files) recordBundleFile(files, file);
  }
  return [...files.values()];
}

async function createTopicReader(directory) {
  const root = await realpath(directory);
  async function resolve(reference, base = root) {
    if (typeof reference !== "string" || !reference || reference.includes("\\") || path.isAbsolute(reference)) {
      throw new Error(`Invalid topic-relative path: ${reference}.`);
    }
    const filename = path.resolve(base, reference);
    const relative = path.relative(root, filename);
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error(`Path escapes topic: ${reference}.`);
    const resolved = await realpath(filename);
    if (resolved !== filename) throw new Error(`Symlink content is not supported: ${reference}.`);
    return { filename, relative: relative.split(path.sep).join("/") };
  }
  async function read(reference, base = root) {
    const file = await resolve(reference, base);
    const stat = await lstat(file.filename);
    if (!stat.isFile() || stat.size > 1024 * 1024) throw new Error(`Expected a regular file of at most 1 MiB: ${file.relative}.`);
    return { ...file, bytes: await readFile(file.filename) };
  }
  async function json(reference, base = root) {
    const file = await read(reference, base);
    return { ...file, value: JSON.parse(file.bytes.toString("utf8")) };
  }
  return { root, resolve, read, json };
}

function checkPrerequisiteCycles(lessons) {
  const byId = new Map(lessons.map(lesson => [lesson.code, lesson]));
  const complete = new Set();
  const visiting = new Set();
  function visit(code) {
    if (visiting.has(code)) throw new Error(`Prerequisite cycle at ${code}.`);
    if (complete.has(code)) return;
    const entry = byId.get(code);
    if (!entry) throw new Error(`Unknown prerequisite ${code}.`);
    visiting.add(code);
    for (const prerequisite of entry.prerequisites) visit(prerequisite.code);
    visiting.delete(code);
    complete.add(code);
  }
  for (const lesson of lessons) visit(lesson.code);
}

// Lesson format v1 (retired; only installed snapshots still verify it): rubric
// anchors in the teaching document and assessment producers.
function bundleAssessments(lesson, document, include, checks) {
  include(document);
  const documentText = document.bytes.toString("utf8");
  uniqueIds(lesson.assessments, "id", "Assessments");
  for (const assessment of lesson.assessments) {
    const [reference, anchor, extra] = assessment.rubric.split("#");
    if (reference !== lesson.document || !anchor || extra || !new RegExp(`^<a id="${assessment.id}"></a>$`, "mu").test(documentText) || anchor !== assessment.id) {
      throw new Error(`Missing explicit rubric anchor for ${assessment.id}.`);
    }
    if (assessment.kind === "practical" && !assessment.evidence) throw new Error(`Practical assessment ${assessment.id} needs an evidence producer.`);
    if (assessment.kind === "answer" && assessment.evidence) throw new Error(`Answer assessment ${assessment.id} uses its admitted answer, not a practical producer.`);
    if (assessment.evidence?.check && !checks.has(assessment.evidence.check)) throw new Error(`Unknown check for ${assessment.id}.`);
    if (assessment.evidence?.producer === "exercise" && (!lesson.exercise || !assessment.evidence.check)) throw new Error(`Exercise assessment ${assessment.id} needs its declared exercise and check.`);
    if (assessment.evidence?.check && !["exercise", "code"].includes(assessment.evidence.producer)) throw new Error(`Only exercise or code evidence runs a declared check: ${assessment.id}.`);
    const checkKind = (lesson.checks || []).find(check => check.id === assessment.evidence?.check)?.kind || "response";
    if (assessment.evidence?.producer === "code") {
      if (!lesson.exercise || !assessment.evidence.check || checkKind !== "code" || !assessment.evidence.files?.length) {
        throw new Error(`Code assessment ${assessment.id} needs its declared exercise, files and a code check.`);
      }
    } else if (assessment.evidence?.files || assessment.evidence?.check && checkKind === "code") {
      throw new Error(`Only code evidence names edited files or runs a code check: ${assessment.id}.`);
    }
  }
}

// Lesson format v2 step rules. Checks decide alone: auto runs a declared check,
// choice compares with the authored answer, review asks the learner's own AI
// to judge their practice work against the rubric, self is the learner's own
// tick and none records nothing, so it can never be required.
function validateSteps(lesson, visuals, checks, code) {
  const fail = message => { throw new Error(`Lesson ${code}: ${message}`); };
  if (!lesson.steps.length) fail("needs at least one step.");
  uniqueIds(lesson.steps, "id", "Steps");
  if (!lesson.steps.some(step => step.required)) fail("needs a required step.");
  for (const step of lesson.steps) {
    const label = `step ${step.id}`;
    if (step.visual) {
      const visual = visuals.get(step.visual.id);
      if (!visual) fail(`${label} shows undeclared visual ${step.visual.id}.`);
      for (const entry of step.visual.play || []) {
        const command = visual.commands.find(item => item.name === entry.name);
        if (!command) fail(`${label} plays undeclared command ${entry.name}.`);
        const parameters = entry.parameters;
        if (!parameters || typeof parameters !== "object" || Array.isArray(parameters)) fail(`${label} command ${entry.name} needs a parameters object.`);
        for (const [name, value] of Object.entries(parameters)) {
          const declared = command.parameters.find(item => item.name === name);
          if (!declared) fail(`${label} command ${entry.name} has undeclared parameter ${name}.`);
          if (typeof value !== "string" || value.length > declared.maxLength) {
            fail(`${label} command ${entry.name} parameter ${name} must be a string of at most ${declared.maxLength} characters.`);
          }
        }
        for (const declared of command.parameters) {
          if (declared.required && !Object.hasOwn(parameters, declared.name)) fail(`${label} command ${entry.name} needs parameter ${declared.name}.`);
        }
      }
    }
    if (step.guide) {
      const { caption, ...request } = step.guide;
      try { trainingGuideRequest(request); } catch (error) { fail(`${label} guide: ${error.message}`); }
    }
    const check = step.check;
    const allowed = { auto: ["check", "files"], choice: ["question", "options", "answer"], review: ["rubric", "evidence"],
      self: [], none: [] }[check.kind];
    const extra = Object.keys(check).filter(key => key !== "kind" && !allowed.includes(key));
    if (extra.length) fail(`${label} ${check.kind} check cannot declare ${extra.join(", ")}.`);
    if (check.kind === "none" && step.required) fail(`${label} has no check and cannot be required.`);
    if (check.kind === "auto") {
      if (!check.check || !checks.has(check.check)) fail(`${label} names an unknown check.`);
      if (!lesson.exercise) fail(`${label} runs a declared check and needs the lesson's exercise.`);
      const declared = lesson.checks.find(item => item.id === check.check);
      const files = check.files || [];
      if (declared.kind === "code" ? files.length < 1 || files.length > 8 : files.length) {
        fail(`${label} ${declared.kind === "code" ? "code check needs 1-8 exercise files" : "names files, but only a code check edits files"}.`);
      }
    }
    if (check.kind === "review") {
      if (!check.rubric?.trim()) fail(`${label} review needs its rubric.`);
      if (!lesson.exercise) fail(`${label} reviews practice work and needs the lesson's exercise.`);
      const evidence = check.evidence || ["changes"];
      if (evidence[0] !== "changes" || evidence.length > 2 || evidence.length === 2 && evidence[1] !== "conversation") {
        fail(`${label} review evidence is ["changes"] or ["changes", "conversation"].`);
      }
    }
    if (check.kind === "choice") {
      const { question, options, answer } = check;
      if (!question || !options || !answer) fail(`${label} choice needs question, options and answer.`);
      if (options.length < 2 || options.length > 8) fail(`${label} choice needs 2-8 options.`);
      if (!answer.length || new Set(answer).size !== answer.length || answer.some(index => index >= options.length)) {
        fail(`${label} choice answer must list unique option indexes within its options.`);
      }
    }
  }
}

async function bundleLesson(reader, entry, { authoring }) {
  const descriptor = await reader.json(entry.descriptor);
  const lesson = validateLesson(descriptor.value, entry.code);
  if (lesson.code !== entry.code) throw new Error(`Lesson code mismatch: ${entry.code}.`);
  if (authoring && lesson.schemaVersion === 1) {
    throw new Error(`Lesson ${entry.code} uses retired lesson format 1. Author it in format 2 with steps.`);
  }
  const base = path.dirname(descriptor.filename);
  const files = new Map();
  function include(file) {
    recordBundleFile(files, { path: file.relative, sha256: hash(file.bytes), bytes: file.bytes.length });
    if (files.size > 512 || [...files.values()].reduce((total, item) => total + item.bytes, 0) > 32 * 1024 * 1024) throw new Error(`Lesson ${entry.code} exceeds bundle limits.`);
  }
  include(descriptor);
  // Files a learner can read (step bodies, notes, visual resources, exercise
  // files). validateTopic refuses any that is a lesson descriptor, so a v2
  // choice answer never reaches a browser projection.
  const served = new Set();
  uniqueIds(lesson.prerequisites, "code", "Lesson prerequisites");
  const checks = uniqueIds(lesson.checks || [], "id", "Checks");
  for (const check of lesson.checks || []) {
    include(await reader.read(check.file, base));
    for (const asset of check.assets || []) include(await reader.read(asset, base));
  }
  if (lesson.schemaVersion === 1) bundleAssessments(lesson, await reader.read(lesson.document, base), include, checks);
  if (lesson.schemaVersion === 2) {
    for (const reference of [lesson.notes, ...new Set(lesson.steps.map(step => step.body))]) {
      if (reference === undefined) continue;
      const file = await reader.read(reference, base);
      include(file);
      served.add(file.relative);
    }
  }
  if (lesson.appRoutes && !lesson.exercise) throw new Error(`Lesson ${entry.code} can declare app routes only with its exercise.`);
  const appRoutes = new Set();
  for (const route of lesson.appRoutes || []) {
    // Paths are literal segments or :id, matching the Preview's reduced request path.
    if (route.path !== "/" && !route.path.slice(1).split("/").every(segment => segment === ":id" || /^[A-Za-z0-9._~-]+$/u.test(segment))) {
      throw new Error(`Invalid app route path for ${entry.code}: ${route.path}.`);
    }
    const key = `${route.method} ${route.path}`;
    if (appRoutes.has(key)) throw new Error(`Lesson ${entry.code} has a duplicate app route: ${key}.`);
    appRoutes.add(key);
  }
  for (const check of lesson.checks || []) {
    if (check.timeoutSeconds !== undefined && check.kind !== "code") throw new Error(`Only a code check declares a timeout: ${check.id}.`);
  }
  if (lesson.schemaVersion === 1 && !lesson.assessments.some(assessment => assessment.required)) throw new Error(`Lesson ${entry.code} needs a required assessment.`);
  uniqueIds(lesson.visuals, "id", "Visuals");
  const visuals = new Map();
  for (const resource of lesson.visuals) {
    const visualFile = await reader.json(resource.descriptor, base);
    const visual = validateContent(visualSchema, visualFile.value, resource.id);
    if (visual.id !== resource.id) throw new Error(`Visual ID mismatch: ${resource.id}.`);
    const states = uniqueIds(visual.states, null, "Visual states");
    if (!states.has(visual.initialState)) throw new Error(`Unknown initial visual state: ${visual.initialState}.`);
    uniqueIds(visual.commands, "name", "Visual commands");
    for (const command of visual.commands) {
      uniqueIds(command.parameters, "name", "Command parameters");
      if (command.completionState !== "unchanged" && !states.has(command.completionState)) throw new Error(`Unknown completion state: ${command.name}.`);
    }
    include(visualFile);
    visuals.set(visual.id, visual);
    const visualBase = path.dirname(visualFile.filename);
    for (const reference of [visual.svg, visual.controller, ...visual.assets || []]) {
      const file = await reader.read(reference, visualBase);
      include(file);
      served.add(file.relative);
    }
  }
  if (lesson.exercise) {
    const exercise = lesson.exercise;
    if (exercise.reuse === "sequence") {
      if (!exercise.sequenceId || !exercise.sequenceMode) throw new Error(`Invalid exercise sequence for ${entry.code}.`);
    } else if (exercise.sequenceId || exercise.sequenceMode) {
      throw new Error(`Invalid exercise sequence for ${entry.code}.`);
    }
    if (exercise.sequenceId && !validId(exercise.sequenceId)) throw new Error(`Invalid exercise sequence ID.`);
    const source = await reader.resolve(exercise.source, base);
    async function includeDirectory(directory) {
      for (const item of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
        if (excludedExerciseEntries.has(item.name)) continue;
        const relative = path.relative(reader.root, path.join(directory, item.name));
        const file = await reader.resolve(relative);
        if (item.isDirectory()) await includeDirectory(file.filename);
        else {
          const read = await reader.read(relative);
          include(read);
          served.add(read.relative);
        }
      }
    }
    await includeDirectory(source.filename);
    // Declared code files must be ordinary bundled exercise files; their pinned
    // bytes are the check's base and only these paths take the learner's bytes.
    const declaredFiles = lesson.schemaVersion === 1
      ? lesson.assessments.map(assessment => [`Code assessment ${assessment.id}`, assessment.evidence?.files || []])
      : lesson.steps.map(step => [`Code step ${step.id}`, step.check.files || []]);
    for (const [label, declared] of declaredFiles) {
      for (const file of declared) {
        const parts = file.split("/");
        if (file.includes("\\") || path.posix.isAbsolute(file) ||
            parts.some(part => !part || part === "." || part === ".." || excludedExerciseEntries.has(part)) ||
            !files.has(source.relative ? `${source.relative}/${file}` : file)) {
          throw new Error(`${label} names a file outside its bundled exercise: ${file}.`);
        }
      }
      if (new Set(declared).size !== declared.length) {
        throw new Error(`${label} repeats a declared file.`);
      }
    }
  }
  if (lesson.schemaVersion === 2) validateSteps(lesson, visuals, checks, entry.code);
  const manifest = { schemaVersion: 1, code: lesson.code, files: [...files.values()].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0) };
  return { lesson, manifest, hash: hash(canonicalJson(manifest)), descriptorPath: descriptor.relative, served };
}

// authoring refuses retired v1 lessons: author commands never produce them,
// while installed v1 snapshots still verify for the published upgrades.
async function validateTopic(directory, { authoring = false } = {}) {
  const reader = await createTopicReader(directory);
  const packageFile = await reader.json("package.json");
  if (!/^learn-[a-z0-9-]+$/u.test(packageFile.value.name || "") || !/^\d+\.\d+\.\d+$/u.test(packageFile.value.version || "")) throw new Error("Topic package needs a learn- name and an exact release version.");
  const topic = validateContent(topicSchema, packageFile.value.vibe64Training, "Topic");
  if (!validId(topic.topicId) || !validId(topic.domainId)) throw new Error("Invalid topic or domain ID.");
  const outline = await reader.read(topic.outline);
  uniqueIds(topic.lessons, "code", "Lessons");
  uniqueIds(topic.prerequisites, "topicId", "Topic prerequisites");
  if (!topic.lessons.length) throw new Error("A topic needs lessons.");
  if (topic.status === "released" && topic.lessons.some(entry => entry.required && entry.status !== "published")) throw new Error("A released topic contains required draft lessons.");
  const bundles = [];
  const served = new Set();
  for (const entry of topic.lessons) {
    // Draft descriptors are validated too; draft status never grants permission to teach them.
    const { served: lessonServed, ...bundle } = await bundleLesson(reader, entry, { authoring });
    for (const file of lessonServed) served.add(file);
    bundles.push({ ...bundle, status: entry.status, required: entry.required });
  }
  // A v2 lesson descriptor holds choice answers; no learner-readable file may be one.
  for (const { descriptorPath, lesson } of bundles) {
    if (lesson.schemaVersion === 2 && served.has(descriptorPath)) {
      throw new Error(`Lesson ${lesson.code} descriptor cannot also be a step body, notes, visual or exercise file.`);
    }
  }
  checkPrerequisiteCycles(bundles.map(bundle => bundle.lesson));
  for (const [index, bundle] of bundles.entries()) {
    for (const { code } of bundle.lesson.prerequisites) {
      const prerequisiteIndex = bundles.findIndex(other => other.lesson.code === code);
      if (prerequisiteIndex >= index) throw new Error(`Prerequisite ${code} must precede ${bundle.lesson.code}.`);
      if (bundle.status === "published" && bundles[prerequisiteIndex].status !== "published") throw new Error(`Published lesson ${bundle.lesson.code} requires draft ${code}.`);
    }
  }
  const sequences = new Map();
  for (const { lesson, descriptorPath, status } of bundles) {
    if (lesson.exercise?.reuse !== "sequence") continue;
    const source = (await reader.resolve(lesson.exercise.source, path.dirname(path.join(reader.root, descriptorPath)))).relative;
    const previous = sequences.get(lesson.exercise.sequenceId);
    if (lesson.exercise.sequenceMode === "create") {
      if (previous) throw new Error(`Invalid create/continue sequence: ${lesson.code}.`);
      sequences.set(lesson.exercise.sequenceId, { source, status });
    } else if (!previous || previous.source !== source || (status === "published" && previous.status !== "published")) {
      throw new Error(`Invalid create/continue sequence: ${lesson.code}.`);
    }
  }
  const topicFiles = [packageFile, outline].map(file => ({ path: file.relative, sha256: hash(file.bytes), bytes: file.bytes.length }));
  const topicManifest = { schemaVersion: 1, topic, release: packageFile.value.version, files: topicFiles,
    lessons: bundles.map(({ lesson, hash, status, required }) => ({ code: lesson.code, hash, status, required })) };
  bundleFiles([topicManifest, ...bundles.map(bundle => bundle.manifest)]);
  return { topic, release: packageFile.value.version, bundles, topicManifest, topicHash: hash(canonicalJson(topicManifest)) };
}

export { bundleFiles, canonicalJson, validateTopic };
