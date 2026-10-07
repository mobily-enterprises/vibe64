import { mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { bundleFiles, canonicalJson, validateTopic } from "./content.js";
import { createCourseLock, readPinnedTopic } from "./catalogue.js";
import { createTrainingContentInstaller } from "./contentInstaller.js";
import { createInstalledTrainingCatalogue } from "./installedCatalogue.js";

async function runTrainingCli(args, { write = text => console.log(text) } = {}) {
  if (args[0] === "install-topic") {
    const [, directory, systemRoot] = args;
    if (args.length !== 3 || !directory || !systemRoot) throw new Error("Usage: vibe64 training install-topic <committed-topic-directory> <system-root>");
    const sourceRoot = await realpath(directory);
    const { topicId, release, repository, commit, topicHash } = await readPinnedTopic(sourceRoot);
    const pin = { schemaVersion: 1, topicId, release, repository, commit, topicHash };
    const result = await createTrainingContentInstaller({ systemRoot: path.resolve(systemRoot) }).installTopic({ sourceRoot, pin });
    write(JSON.stringify({ ok: true, installed: result.installed, pin: result.pin }, null, 2));
    return 0;
  }
  if (args[0] === "installed-courses") {
    if (args.length !== 2 || !args[1]) throw new Error("Usage: vibe64 training installed-courses <system-root>");
    const catalogue = await createInstalledTrainingCatalogue({ systemRoot: path.resolve(args[1]) }).readCatalogue();
    write(JSON.stringify({ ok: true, ...catalogue }, null, 2));
    return 0;
  }
  if (args[0] === "enable-course" || args[0] === "disable-course") {
    const [command, first, second, systemRoot, revision] = args;
    if (args.length !== 5 || !first || !second || !systemRoot || !/^(0|[1-9][0-9]*)$/u.test(revision || "") || !Number.isSafeInteger(Number(revision))) {
      throw new Error(command === "enable-course"
        ? "Usage: vibe64 training enable-course <course.json> <course.lock.json> <system-root> <expected-revision>"
        : "Usage: vibe64 training disable-course <courseId> <release> <system-root> <expected-revision>");
    }
    const catalogue = createInstalledTrainingCatalogue({ systemRoot: path.resolve(systemRoot) });
    const expectedRevision = Number(revision);
    const result = command === "enable-course"
      ? await catalogue.enableCourse({ course: JSON.parse(await readFile(first, "utf8")), lock: JSON.parse(await readFile(second, "utf8")), expectedRevision })
      : await catalogue.disableCourse({ courseId: first, release: second, expectedRevision });
    write(JSON.stringify({ ok: true, ...result }, null, 2));
    return 0;
  }
  if (args[0] === "publish-manifest") {
    const [, coursePath, ...directories] = args;
    if (!coursePath || !directories.length) throw new Error("Usage: vibe64 training publish-manifest <course.json> <committed-topic-directory...>");
    const input = await realpath(coursePath);
    const filename = path.join(await realpath(path.dirname(path.resolve(coursePath))), "course.lock.json");
    if (filename === input || path.basename(coursePath) === "course.lock.json") {
      throw new Error("Course lock output must not replace its input course descriptor.");
    }
    const course = JSON.parse(await readFile(input, "utf8"));
    const topics = [];
    for (const directory of directories) {
      const root = await realpath(directory);
      const relative = path.relative(root, filename);
      if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))) {
        throw new Error("Course lock output must be outside every pinned source topic.");
      }
      topics.push(await readPinnedTopic(root));
    }
    const lock = createCourseLock(course, topics);
    const temporary = `${filename}.tmp-${randomUUID()}`;
    try {
      await writeFile(temporary, `${canonicalJson(lock)}\n`, { flag: "wx" });
      await rename(temporary, filename);
    } finally {
      await rm(temporary, { force: true });
    }
    write(JSON.stringify({ ok: true, courseId: lock.courseId, status: lock.status, lockPath: filename, topics: lock.topics.length }, null, 2));
    return 0;
  }
  const [command, directory, destination] = args;
  if (!["validate", "bundle"].includes(command) || !directory || (command === "bundle" && !destination) || args.length !== (command === "bundle" ? 3 : 2)) {
    throw new Error("Usage: vibe64 training validate <topic-directory> | bundle <topic-directory> <new-output-directory>");
  }
  const source = await realpath(directory);
  const result = await validateTopic(source);
  const manifest = { schemaVersion: 1, topic: result.topic, release: result.release, topicHash: result.topicHash,
    topicManifest: result.topicManifest, lessons: result.bundles.map(({ lesson, hash, status, required, manifest }) => ({
    code: lesson.code, hash, status, required, manifest
  })) };
  if (command === "bundle") {
    const requestedOutput = path.resolve(destination);
    const output = path.join(await realpath(path.dirname(requestedOutput)), path.basename(requestedOutput));
    const relative = path.relative(source, output);
    if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))) throw new Error("Bundle output must be outside the source topic.");
    // Exclusive directory creation preserves existing output. The completion manifest is written last.
    await mkdir(output);
    try {
      const files = bundleFiles([result.topicManifest, ...result.bundles.map(bundle => bundle.manifest)]);
      for (const file of files) {
        const bytes = await readFile(path.join(source, file.path));
        if (createHash("sha256").update(bytes).digest("hex") !== file.sha256) throw new Error(`Source changed during bundling: ${file.path}. Validate and retry.`);
        const filename = path.join(output, "files", file.path);
        await mkdir(path.dirname(filename), { recursive: true });
        await writeFile(filename, bytes, { flag: "wx" });
      }
      await writeFile(path.join(output, "bundle.json"), `${canonicalJson(manifest)}\n`, { flag: "wx" });
    } catch (error) {
      await rm(output, { recursive: true, force: true });
      throw error;
    }
  }
  write(JSON.stringify({ ok: true, topicId: result.topic.topicId, status: result.topic.status,
    lessons: result.bundles.map(({ lesson, hash, status }) => ({ code: lesson.code, hash, status })) }, null, 2));
  return 0;
}

export { runTrainingCli };
