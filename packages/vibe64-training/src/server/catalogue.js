import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { promisify } from "node:util";
import { bundleFiles, canonicalJson, validateTopic } from "./content.js";
import { courseSchema, topicSchema, validateContent } from "./contentSchemas.js";

const runFile = promisify(execFile);

async function readPinnedTopic(directory) {
  const root = await realpath(directory);
  const git = async (...args) => {
    const { stdout } = await runFile("git", ["-C", root, ...args], { maxBuffer: 1024 * 1024 });
    return stdout.trim();
  };
  if (await realpath(await git("rev-parse", "--show-toplevel")) !== root) {
    throw new Error("Choose the topic repository root.");
  }
  const commit = await git("rev-parse", "HEAD");
  if (await git("status", "--porcelain", "--untracked-files=all")) throw new Error("Commit the topic content before generating a pinned course manifest.");
  const result = await validateTopic(root);
  const metadata = JSON.parse(await git("show", `${commit}:package.json`));
  const repository = String(metadata.repository?.url || "").match(/^https:\/\/github\.com\/([a-zA-Z0-9_.-]+\/learn-[a-zA-Z0-9_.-]+)\.git$/u)?.[1];
  if (!repository) throw new Error("Topic package needs its canonical https://github.com/<owner>/learn-<topic>.git repository URL.");
  // Prove every hashed input is from the pinned commit, including transient worktree edits.
  for (const file of bundleFiles([result.topicManifest, ...result.bundles.map(bundle => bundle.manifest)])) {
    const { stdout } = await runFile("git", ["-C", root, "show", `${commit}:${file.path}`], { encoding: null, maxBuffer: 1024 * 1024 });
    if (createHash("sha256").update(stdout).digest("hex") !== file.sha256 || stdout.length !== file.bytes) throw new Error(`Topic input differs from its pinned commit: ${file.path}.`);
  }
  if (await git("rev-parse", "HEAD") !== commit || await git("status", "--porcelain", "--untracked-files=all")) throw new Error("Topic changed during manifest generation. Commit and retry.");
  return {
    topicId: result.topic.topicId, release: result.release, repository, commit,
    topicManifest: result.topicManifest, topicHash: result.topicHash
  };
}

function createCourseLock(input, resolvedTopics) {
  const course = validateContent(courseSchema, input, "Course");
  if (!/^[a-z][a-z0-9-]{0,63}$/u.test(course.courseId) || !/^\d+\.\d+\.\d+$/u.test(course.release) || !course.topics.length) throw new Error("Course needs an ID, exact release and at least one whole topic.");
  const seen = new Set();
  const topics = course.topics.map(reference => {
    if (seen.has(reference.topicId)) throw new Error(`Duplicate course topic: ${reference.topicId}.`);
    seen.add(reference.topicId);
    const matches = resolvedTopics.filter(topic => topic.topicId === reference.topicId && topic.release === reference.release);
    if (matches.length !== 1) throw new Error(`Resolve exactly one pinned topic release: ${reference.topicId}@${reference.release}.`);
    const resolved = matches[0];
    if (!/^[a-zA-Z0-9_.-]+\/learn-[a-zA-Z0-9_.-]+$/u.test(resolved.repository || "") || !/^[a-f0-9]{40}$/u.test(resolved.commit || "")) throw new Error(`Topic requires a repository and immutable commit: ${reference.topicId}.`);
    const manifest = resolved.topicManifest;
    if (!manifest || manifest.schemaVersion !== 1 || manifest.topic?.topicId !== reference.topicId || manifest.release !== reference.release ||
      createHash("sha256").update(canonicalJson(manifest)).digest("hex") !== resolved.topicHash) {
      throw new Error(`Topic manifest identity mismatch: ${reference.topicId}.`);
    }
    validateContent(topicSchema, manifest.topic, reference.topicId);
    if (course.status === "released" && manifest.topic.status !== "released") throw new Error(`Released course requires a released topic: ${reference.topicId}.`);
    const entries = manifest.topic.lessons;
    if (!Array.isArray(entries) || !entries.length || !Array.isArray(manifest.lessons) || entries.length !== manifest.lessons.length) throw new Error(`Incomplete whole-topic inventory: ${reference.topicId}.`);
    for (const [index, entry] of entries.entries()) {
      const lesson = manifest.lessons[index];
      if (lesson.code !== entry.code || lesson.status !== entry.status || lesson.required !== entry.required || !/^[a-f0-9]{64}$/u.test(lesson.hash || "")) throw new Error(`Changed whole-topic order or lesson identity: ${reference.topicId}.`);
      if (course.status === "released" && lesson.required && lesson.status !== "published") throw new Error(`Released course includes required draft: ${lesson.code}.`);
    }
    return {
      topicId: reference.topicId, release: reference.release, repository: resolved.repository,
      commit: resolved.commit, manifestHash: resolved.topicHash,
      lessons: manifest.lessons.map(lesson => ({ ...lesson }))
    };
  });
  return { schemaVersion: 1, courseId: course.courseId, release: course.release, status: course.status, topics };
}

export { createCourseLock, readPinnedTopic };
