import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { createSchema } from "@jskit-ai/kernel/shared/validators";
import { bundleFiles, canonicalJson, validateTopic } from "./content.js";
import { validateContent } from "./contentSchemas.js";

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

function createInstalledTrainingContent({ systemRoot } = {}) {
  if (typeof systemRoot !== "string" || !systemRoot || !path.isAbsolute(systemRoot)) {
    throw new Error("Installed teaching content needs an absolute server-owned system root.");
  }
  const root = path.resolve(systemRoot);

  async function readTopic({ topicId, commit, topicHash } = {}) {
    if (typeof topicId !== "string" || typeof commit !== "string" || !idPattern.test(topicId) || !commitPattern.test(commit)) {
      throw new Error("Choose a valid topic ID and its exact 40-character lowercase Git commit.");
    }
    if (typeof topicHash !== "string" || !hashPattern.test(topicHash)) {
      throw new Error("Provide the trusted 64-character topic hash from the course or saved attempt.");
    }
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

  async function readLesson({ topicId, commit, topicHash, lessonCode, lessonHash } = {}) {
    if (typeof lessonCode !== "string" || typeof lessonHash !== "string" || !idPattern.test(lessonCode) || !hashPattern.test(lessonHash)) {
      throw new Error("Choose a declared lesson code and its exact 64-character lowercase content hash.");
    }
    const topic = await readTopic({ topicId, commit, topicHash });
    const bundle = topic.bundles.find(item => item.lesson.code === lessonCode);
    if (!bundle) throw new Error(`Lesson ${lessonCode} is not declared in this pinned topic.`);
    if (bundle.status !== "published") throw new Error(`Lesson ${lessonCode} is draft and cannot be taught. Choose a published lesson.`);
    if (bundle.hash !== lessonHash) throw new Error(`Lesson ${lessonCode} content hash changed. Resume its exact pinned revision or explicitly start a new attempt.`);
    const filesRoot = path.join(root, "training", "content", topicId, commit, "files");
    const descriptorRoot = path.dirname(path.join(filesRoot, bundle.descriptorPath));
    async function lessonFile(reference) {
      const filename = path.resolve(descriptorRoot, reference);
      const relative = path.relative(filesRoot, filename).split(path.sep).join("/");
      const record = bundle.manifest.files.find(file => file.path === relative);
      if (!record) throw new Error("Lesson requested an unrecorded installed file.");
      const bytes = await boundedFile(filename, 1024 * 1024);
      if (bytes.length !== record.bytes || sha256(bytes) !== record.sha256) {
        throw new Error("Installed lesson changed while reading. Ask the owner to reinstall the verified snapshot.");
      }
      return { path: relative, text: bytes.toString("utf8") };
    }
    const document = await lessonFile(bundle.lesson.document);
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
    const visuals = [];
    for (const resource of bundle.lesson.visuals) {
      const descriptor = await lessonFile(resource.descriptor);
      visuals.push({ id: resource.id, descriptorPath: descriptor.path, visual: JSON.parse(descriptor.text) });
    }
    return {
      pin: topic.pin,
      lesson: bundle.lesson,
      manifest: bundle.manifest,
      hash: bundle.hash,
      descriptorPath: bundle.descriptorPath,
      document,
      rubrics,
      visuals
    };
  }

  return { readTopic, readLesson };
}

export { createInstalledTrainingContent, validateInstalledTopicPin };
