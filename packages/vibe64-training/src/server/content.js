import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { lessonSchema, topicSchema, visualSchema, validateContent } from "./contentSchemas.js";

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

async function bundleLesson(reader, entry) {
  const descriptor = await reader.json(entry.descriptor);
  const lesson = validateContent(lessonSchema, descriptor.value, entry.code);
  if (lesson.code !== entry.code) throw new Error(`Lesson code mismatch: ${entry.code}.`);
  const base = path.dirname(descriptor.filename);
  const files = new Map();
  function include(file) {
    recordBundleFile(files, { path: file.relative, sha256: hash(file.bytes), bytes: file.bytes.length });
    if (files.size > 512 || [...files.values()].reduce((total, item) => total + item.bytes, 0) > 32 * 1024 * 1024) throw new Error(`Lesson ${entry.code} exceeds bundle limits.`);
  }
  include(descriptor);
  const document = await reader.read(lesson.document, base);
  include(document);
  const documentText = document.bytes.toString("utf8");
  uniqueIds(lesson.assessments, "id", "Assessments");
  uniqueIds(lesson.prerequisites, "code", "Lesson prerequisites");
  const checks = uniqueIds(lesson.checks || [], "id", "Checks");
  for (const check of lesson.checks || []) {
    include(await reader.read(check.file, base));
    for (const asset of check.assets || []) include(await reader.read(asset, base));
  }
  for (const assessment of lesson.assessments) {
    const [reference, anchor, extra] = assessment.rubric.split("#");
    if (reference !== lesson.document || !anchor || extra || !new RegExp(`^<a id="${assessment.id}"></a>$`, "mu").test(documentText) || anchor !== assessment.id) {
      throw new Error(`Missing explicit rubric anchor for ${assessment.id}.`);
    }
    if (assessment.kind === "practical" && !assessment.evidence) throw new Error(`Practical assessment ${assessment.id} needs an evidence producer.`);
    if (assessment.kind === "answer" && assessment.evidence) throw new Error(`Answer assessment ${assessment.id} uses its admitted answer, not a practical producer.`);
    if (assessment.evidence?.check && !checks.has(assessment.evidence.check)) throw new Error(`Unknown check for ${assessment.id}.`);
    if (assessment.evidence?.producer === "exercise" && (!lesson.exercise || !assessment.evidence.check)) throw new Error(`Exercise assessment ${assessment.id} needs its declared exercise and check.`);
    if (assessment.evidence?.check && assessment.evidence.producer !== "exercise") throw new Error(`Only exercise evidence runs a declared check: ${assessment.id}.`);
  }
  if (!lesson.assessments.some(assessment => assessment.required)) throw new Error(`Lesson ${entry.code} needs a required assessment.`);
  uniqueIds(lesson.visuals, "id", "Visuals");
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
    const visualBase = path.dirname(visualFile.filename);
    include(await reader.read(visual.svg, visualBase));
    include(await reader.read(visual.controller, visualBase));
    for (const asset of visual.assets || []) include(await reader.read(asset, visualBase));
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
        else include(await reader.read(relative));
      }
    }
    await includeDirectory(source.filename);
  }
  const manifest = { schemaVersion: 1, code: lesson.code, files: [...files.values()].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0) };
  return { lesson, manifest, hash: hash(canonicalJson(manifest)), descriptorPath: descriptor.relative };
}

async function validateTopic(directory) {
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
  for (const entry of topic.lessons) {
    // Draft descriptors are validated too; draft status never grants permission to teach them.
    bundles.push({ ...await bundleLesson(reader, entry), status: entry.status, required: entry.required });
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
