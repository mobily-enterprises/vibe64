import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { createSchema } from "@jskit-ai/kernel/shared/validators";
import { bundleFiles, canonicalJson, validateTopic } from "./content.js";
import { validateContent, validateLesson } from "./contentSchemas.js";
import { splitStepBeats } from "../shared/beats.js";

const idPattern = /^[a-zA-Z][a-zA-Z0-9-]{0,63}$/u;
const commitPattern = /^[a-f0-9]{40}$/u;
const hashPattern = /^[a-f0-9]{64}$/u;
const repositoryPattern = /^[a-zA-Z0-9_.-]+\/learn-[a-zA-Z0-9_.-]+$/u;
const text = { type: "string", required: true, noTrim: true, minLength: 1, maxLength: 256 };
const pinSchema = createSchema({
  schemaVersion: { type: "integer", required: true, enum: [1] },
  topicId: { ...text, maxLength: 64 },
  release: text,
  repository: text,
  commit: { ...text, maxLength: 40 },
  topicHash: { ...text, maxLength: 64 }
});
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");

// A v2 choice answer is read only by the server comparator. Every other
// projection of a lesson descriptor goes through this.
function withoutAnswers(lesson) {
  if (lesson?.schemaVersion !== 2) return lesson;
  return { ...lesson, steps: lesson.steps.map(step => {
    if (step.check.kind !== "choice") return step;
    const { answer, ...check } = step.check;
    return { ...step, check };
  }) };
}

// The choice comparator: the selection passes only when it names exactly the
// authored answer indexes. Order is irrelevant; duplicates or non-integers fail.
function compareChoiceAnswer(answer, selected) {
  if (!Array.isArray(answer) || !Array.isArray(selected) || !selected.every(Number.isSafeInteger) ||
      new Set(selected).size !== selected.length) return false;
  return selected.length === answer.length && selected.every(index => answer.includes(index));
}

function validateInstalledTopicPin(value, expected = {}) {
  const pin = validateContent(pinSchema, value, "Installed topic pin");
  if (!idPattern.test(pin.topicId) || !commitPattern.test(pin.commit) ||
      pin.topicId !== (expected.topicId ?? pin.topicId) || pin.commit !== (expected.commit ?? pin.commit) ||
      !/^\d+\.\d+\.\d+$/u.test(pin.release) || !repositoryPattern.test(pin.repository) || !hashPattern.test(pin.topicHash)) {
    throw new Error("Installed pin does not match the requested topic, commit or canonical source identity.");
  }
  if (pin.topicHash !== (expected.topicHash ?? pin.topicHash)) {
    throw new Error("Installed topic differs from the trusted course or attempt pin.");
  }
  return pin;
}

async function requirePath(filename, directory) {
  const stat = await lstat(filename);
  if (stat.isSymbolicLink() || await realpath(filename) !== filename) {
    throw new Error("Installed content cannot use symlink or directory aliases.");
  }
  if (directory ? !stat.isDirectory() : !stat.isFile()) {
    throw new Error(`Installed content needs a regular ${directory ? "directory" : "file"}.`);
  }
  return stat;
}

async function boundedFile(filename, maxBytes) {
  const stat = await requirePath(filename, false);
  if (stat.size > maxBytes) throw new Error(`Installed file exceeds its ${maxBytes}-byte limit.`);
  const bytes = await readFile(filename);
  if (bytes.length > maxBytes) throw new Error(`Installed file exceeds its ${maxBytes}-byte limit.`);
  return bytes;
}

async function inventory(directory) {
  const files = [];
  let entries = 0;
  async function visit(current) {
    await requirePath(current, true);
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if (++entries > 65536) throw new Error("Installed snapshot exceeds 65536 directory entries.");
      const filename = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(filename);
      else {
        await requirePath(filename, false);
        files.push(path.relative(directory, filename).split(path.sep).join("/"));
      }
    }
  }
  await visit(directory);
  return files.sort();
}

// Only the composing server may admit drafts for an isolated author preview.
// Read inputs cannot change this choice; ordinary learner readers refuse drafts.
function createInstalledTrainingContent({ systemRoot, allowDraftLessons = false } = {}) {
  if (typeof systemRoot !== "string" || !systemRoot || !path.isAbsolute(systemRoot)) {
    throw new Error("Installed teaching content needs an absolute server-owned system root.");
  }
  const root = path.resolve(systemRoot);
  if (typeof allowDraftLessons !== "boolean") {
    throw new TypeError("Draft lesson reads require a trusted server construction choice.");
  }
  const pendingTopics = new Map();

  async function readTopic(input = {}) {
    const topic = await readVerifiedTopic(input);
    return { ...topic, bundles: topic.bundles.map(bundle => ({ ...bundle, lesson: withoutAnswers(bundle.lesson) })) };
  }

  async function readVerifiedTopic({ topicId, commit, topicHash } = {}) {
    if (typeof topicId !== "string" || typeof commit !== "string" || !idPattern.test(topicId) || !commitPattern.test(commit)) {
      throw new Error("Choose a valid topic ID and its exact 40-character lowercase Git commit.");
    }
    if (typeof topicHash !== "string" || !hashPattern.test(topicHash)) {
      throw new Error("Provide the trusted 64-character topic hash from the course or saved attempt.");
    }
    const key = JSON.stringify([topicId, commit, topicHash]);
    let pending = pendingTopics.get(key);
    if (!pending) {
      // Overlapping readers verify the same immutable pin together. Settled
      // results are never retained: subsequent reads must detect changed files.
      pending = verifyTopic({ topicId, commit, topicHash }).finally(() => pendingTopics.delete(key));
      pendingTopics.set(key, pending);
    }
    return structuredClone(await pending);
  }

  async function verifyTopic({ topicId, commit, topicHash }) {
    try {
      const trainingRoot = path.join(root, "training");
      const contentRoot = path.join(trainingRoot, "content");
      const topicRoot = path.join(contentRoot, topicId);
      const snapshotRoot = path.join(topicRoot, commit);
      for (const directory of [root, trainingRoot, contentRoot, topicRoot, snapshotRoot]) {
        await requirePath(directory, true);
      }
      const pin = validateInstalledTopicPin(JSON.parse((await boundedFile(path.join(snapshotRoot, "pin.json"), 4096)).toString("utf8")), { topicId, commit, topicHash });
      const bundle = JSON.parse((await boundedFile(path.join(snapshotRoot, "bundle.json"), 32 * 1024 * 1024)).toString("utf8"));
      const filesRoot = path.join(snapshotRoot, "files");
      const installedPaths = await inventory(filesRoot);
      const result = await validateTopic(filesRoot);
      const expectedBundle = {
        schemaVersion: 1,
        topic: result.topic,
        release: result.release,
        topicHash: result.topicHash,
        topicManifest: result.topicManifest,
        lessons: result.bundles.map(({ lesson, hash, status, required, manifest }) => ({ code: lesson.code, hash, status, required, manifest }))
      };
      if (canonicalJson(bundle) !== canonicalJson(expectedBundle)) {
        throw new Error("Installed bundle is incomplete, reordered, unsupported or changed from its source files.");
      }
      if (result.topic.topicId !== pin.topicId || result.release !== pin.release || result.topicHash !== pin.topicHash) {
        throw new Error("Installed topic identity differs from its pin.");
      }
      const files = bundleFiles([result.topicManifest, ...result.bundles.map(item => item.manifest)]);
      if (canonicalJson(installedPaths) !== canonicalJson(files.map(file => file.path).sort())) {
        throw new Error("Installed snapshot has missing or unrecorded files.");
      }
      const packageBytes = await boundedFile(path.join(filesRoot, "package.json"), 1024 * 1024);
      const packageFile = files.find(file => file.path === "package.json");
      if (packageBytes.length !== packageFile.bytes || sha256(packageBytes) !== packageFile.sha256) {
        throw new Error("Installed source changed during reading.");
      }
      const metadata = JSON.parse(packageBytes.toString("utf8"));
      if (metadata.repository?.url !== `https://github.com/${pin.repository}.git`) {
        throw new Error("Installed package repository URL differs from its canonical pin.");
      }
      return { pin, ...result };
    } catch (cause) {
      const missing = ["ENOENT", "ENOTDIR"].includes(cause.code);
      const error = new Error(missing
        ? `Pinned teaching content ${topicId}@${commit} is missing. Ask the owner to install that exact revision.`
        : `Pinned teaching content ${topicId}@${commit} is invalid: ${cause.message} Ask the owner to reinstall the verified snapshot.`, { cause });
      error.code = missing ? "VIBE64_TRAINING_CONTENT_MISSING" : "VIBE64_TRAINING_CONTENT_INVALID";
      throw error;
    }
  }

  async function lessonFile({ pin, manifest }, base, reference) {
    const filesRoot = path.join(root, "training", "content", pin.topicId, pin.commit, "files");
    const filename = path.resolve(filesRoot, base, reference);
    const relative = path.relative(filesRoot, filename).split(path.sep).join("/");
    const record = manifest.files.find(file => file.path === relative);
    if (!record) throw new Error("Lesson requested an unrecorded installed file.");
    const bytes = await boundedFile(filename, 1024 * 1024);
    if (bytes.length !== record.bytes || sha256(bytes) !== record.sha256) {
      throw new Error("Installed lesson changed while reading. Ask the owner to reinstall the verified snapshot.");
    }
    return { path: relative, bytes };
  }

  // Conversation admission reads identity, not teaching bytes. Re-read the
  // trusted manifest and selected descriptor each time; never cache authority.
  async function readAdmissionIdentity({ topicId, commit, topicHash, lessonCode, lessonHash } = {}) {
    if (typeof topicId !== "string" || !idPattern.test(topicId) || typeof commit !== "string" || !commitPattern.test(commit) ||
        typeof topicHash !== "string" || !hashPattern.test(topicHash) || typeof lessonCode !== "string" || !idPattern.test(lessonCode) ||
        typeof lessonHash !== "string" || !hashPattern.test(lessonHash)) {
      throw new Error("Choose an exact pinned topic and lesson identity.");
    }
    try {
      const trainingRoot = path.join(root, "training");
      const contentRoot = path.join(trainingRoot, "content");
      const topicRoot = path.join(contentRoot, topicId);
      const snapshotRoot = path.join(topicRoot, commit);
      for (const directory of [root, trainingRoot, contentRoot, topicRoot, snapshotRoot]) await requirePath(directory, true);
      const pin = validateInstalledTopicPin(JSON.parse((await boundedFile(path.join(snapshotRoot, "pin.json"), 4096)).toString("utf8")),
        { topicId, commit, topicHash });
      const bundle = JSON.parse((await boundedFile(path.join(snapshotRoot, "bundle.json"), 32 * 1024 * 1024)).toString("utf8"));
      const topicManifest = bundle.topicManifest;
      if (!topicManifest || sha256(canonicalJson(topicManifest)) !== topicHash ||
          topicManifest.topic.topicId !== topicId || topicManifest.release !== pin.release) {
        throw new Error("Installed topic manifest differs from the trusted identity.");
      }
      const entry = topicManifest.lessons.find(item => item.code === lessonCode);
      const descriptor = topicManifest.topic.lessons.find(item => item.code === lessonCode);
      const selected = bundle.lessons.find(item => item.code === lessonCode);
      if (!entry || !descriptor || !selected || entry.hash !== lessonHash ||
          sha256(canonicalJson(selected.manifest)) !== lessonHash) {
        throw new Error("Installed lesson manifest differs from the trusted content hash.");
      }
      if (entry.status !== "published" && !allowDraftLessons) throw new Error(`Lesson ${lessonCode} is draft and cannot be taught. Choose a published lesson.`);
      const identity = { pin, manifest: selected.manifest, hash: lessonHash, descriptorPath: descriptor.descriptor };
      const file = await lessonFile(identity, ".", descriptor.descriptor);
      const lesson = validateLesson(JSON.parse(file.bytes.toString("utf8")), lessonCode);
      if (lesson.code !== lessonCode) throw new Error("Installed lesson descriptor identity changed.");
      return { ...identity, lesson: withoutAnswers(lesson) };
    } catch (cause) {
      const error = new Error(`Pinned teaching identity ${topicId}@${commit} is invalid: ${cause.message} Ask the owner to restore the exact snapshot.`, { cause });
      error.code = ["ENOENT", "ENOTDIR"].includes(cause.code)
        ? "VIBE64_TRAINING_CONTENT_MISSING" : "VIBE64_TRAINING_CONTENT_INVALID";
      throw error;
    }
  }

  async function readLessonIdentity(input = {}) {
    const identity = await readVerifiedLessonIdentity(input);
    return { ...identity, lesson: withoutAnswers(identity.lesson) };
  }

  async function readVerifiedLessonIdentity({ topicId, commit, topicHash, lessonCode, lessonHash } = {}) {
    if (typeof lessonCode !== "string" || typeof lessonHash !== "string" || !idPattern.test(lessonCode) || !hashPattern.test(lessonHash)) {
      throw new Error("Choose a declared lesson code and its exact 64-character lowercase content hash.");
    }
    const topic = await readVerifiedTopic({ topicId, commit, topicHash });
    const bundle = topic.bundles.find(item => item.lesson.code === lessonCode);
    if (!bundle) throw new Error(`Lesson ${lessonCode} is not declared in this pinned topic.`);
    if (bundle.status !== "published" && !allowDraftLessons) throw new Error(`Lesson ${lessonCode} is draft and cannot be taught. Choose a published lesson.`);
    if (bundle.hash !== lessonHash) throw new Error(`Lesson ${lessonCode} content hash changed. Resume its exact pinned revision or explicitly start a new attempt.`);
    return { pin: topic.pin, lesson: bundle.lesson, manifest: bundle.manifest,
      hash: bundle.hash, descriptorPath: bundle.descriptorPath };
  }

  async function readLesson(input = {}) {
    const bundle = await readLessonIdentity(input);
    const base = path.dirname(bundle.descriptorPath);
    async function lessonText(reference) {
      const file = await lessonFile(bundle, base, reference);
      return { path: file.path, text: file.bytes.toString("utf8") };
    }
    const visuals = [];
    for (const resource of bundle.lesson.visuals) {
      const descriptor = await lessonText(resource.descriptor);
      visuals.push({ id: resource.id, descriptorPath: descriptor.path, visual: JSON.parse(descriptor.text) });
    }
    if (bundle.lesson.schemaVersion === 2) {
      // v2 has no teaching document: each step carries its body text, and its
      // beats parsed out of it (the reader never shows the beats block).
      const steps = [];
      for (const step of bundle.lesson.steps) {
        const { body, beats } = splitStepBeats((await lessonText(step.body)).text);
        steps.push({ ...step, bodyText: body, ...(beats ? { beats } : {}) });
      }
      return { ...bundle, steps, ...bundle.lesson.notes === undefined ? {} : { notesText: (await lessonText(bundle.lesson.notes)).text }, visuals };
    }
    if (bundle.lesson.schemaVersion !== 1) throw new Error(`Lesson ${bundle.lesson.code} uses an unsupported format.`);
    // Retired v1: read only for already-installed snapshots and the published
    // Learning upgrades that verify saved attempts of them.
    const document = await lessonText(bundle.lesson.document);
    const anchors = bundle.lesson.assessments.map(assessment => ({
      id: assessment.id,
      reference: assessment.rubric,
      position: new RegExp(`^<a id="${assessment.id}"></a>$`, "mu").exec(document.text).index
    })).sort((a, b) => a.position - b.position);
    const rubrics = anchors.map((anchor, index) => ({
      id: anchor.id,
      reference: anchor.reference,
      text: document.text.slice(anchor.position, anchors[index + 1]?.position ?? document.text.length)
    }));
    return {
      ...bundle,
      document,
      rubrics,
      visuals
    };
  }

  // Server-only comparator input: the authored answer of one v2 choice step.
  // Never return this to a browser or assistant projection.
  async function readChoiceAnswer({ stepId, ...input } = {}) {
    if (typeof stepId !== "string" || !idPattern.test(stepId)) throw new Error("Choose a declared step ID.");
    const { pin, lesson, hash } = await readVerifiedLessonIdentity(input);
    if (lesson.schemaVersion !== 2) throw new Error(`Lesson ${lesson.code} has no steps.`);
    const step = lesson.steps.find(item => item.id === stepId);
    if (!step) throw new Error(`Step ${stepId} is not declared in this pinned lesson.`);
    if (step.check.kind !== "choice") throw new Error(`Step ${stepId} is not a choice step.`);
    return { pin, lessonCode: lesson.code, lessonHash: hash, stepId, answer: [...step.check.answer] };
  }

  async function readVisual({ topicId, commit, topicHash, lessonCode, lessonHash, visualId } = {}) {
    if (typeof visualId !== "string" || !idPattern.test(visualId)) {
      throw new Error("Choose a declared visual ID.");
    }
    const lesson = await readLesson({ topicId, commit, topicHash, lessonCode, lessonHash });
    const resource = lesson.visuals.find(item => item.id === visualId);
    if (!resource) throw new Error(`Visual ${visualId} is not declared in this pinned lesson.`);
    const base = path.dirname(resource.descriptorPath);
    const svg = await lessonFile(lesson, base, resource.visual.svg);
    const controller = await lessonFile(lesson, base, resource.visual.controller);
    const assets = [];
    for (const reference of resource.visual.assets || []) {
      assets.push(await lessonFile(lesson, base, reference));
    }
    return {
      pin: lesson.pin,
      lessonCode: lesson.lesson.code,
      lessonHash: lesson.hash,
      ...resource,
      svg,
      controller,
      assets
    };
  }

  async function readCheck({ topicId, commit, topicHash, lessonCode, lessonHash, checkId } = {}) {
    if (typeof checkId !== "string" || !idPattern.test(checkId)) {
      throw new Error("Choose a declared check ID.");
    }
    const lesson = await readLesson({ topicId, commit, topicHash, lessonCode, lessonHash });
    const check = lesson.lesson.checks?.find(value => value.id === checkId);
    if (!check) throw new Error(`Check ${checkId} is not declared in this pinned lesson.`);
    const base = path.dirname(lesson.descriptorPath);
    const file = await lessonFile(lesson, base, check.file);
    const assets = [];
    for (const reference of check.assets || []) {
      assets.push(await lessonFile(lesson, base, reference));
    }
    return {
      pin: lesson.pin,
      lessonCode: lesson.lesson.code,
      lessonHash: lesson.hash,
      check,
      file,
      assets
    };
  }

  async function readExercise({ topicId, commit, topicHash, lessonCode, lessonHash, metadataOnly = false, admissionOnly = false } = {}) {
    // Scope admission needs the freshly verified identity, not a second copy of
    // every exercise byte. Preparation keeps the complete original result.
    if (admissionOnly === true && metadataOnly !== true) throw new TypeError("Admission reads cannot supply exercise content.");
    const reader = admissionOnly === true ? readAdmissionIdentity : metadataOnly === true ? readLessonIdentity : readLesson;
    const lesson = await reader({ topicId, commit, topicHash, lessonCode, lessonHash });
    const exercise = lesson.lesson.exercise;
    if (!exercise) throw Object.assign(new Error(`Lesson ${lessonCode} has no declared bundled exercise.`), {
      code: "VIBE64_TRAINING_EXERCISE_MISSING"
    });
    const sourcePath = path.posix.join(path.posix.dirname(lesson.descriptorPath), exercise.source);
    const identity = { pin: lesson.pin, lessonCode: lesson.lesson.code,
      lessonHash: lesson.hash, exercise, sourcePath };
    if (metadataOnly === true) return identity;
    const prefix = sourcePath === "." ? "" : `${sourcePath}/`;
    const files = [];
    for (const record of lesson.manifest.files) {
      if (!record.path.startsWith(prefix)) continue;
      const relative = record.path.slice(prefix.length);
      const file = await lessonFile(lesson, sourcePath, relative);
      files.push({ path: relative, bytes: file.bytes });
    }
    return { ...identity, files };
  }

  return { readTopic, readLesson, readAdmissionIdentity, readVisual, readCheck, readExercise, readChoiceAnswer };
}

export { compareChoiceAnswer, createInstalledTrainingContent, validateInstalledTopicPin };
