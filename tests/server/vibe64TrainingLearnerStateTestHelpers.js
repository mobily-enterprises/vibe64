// What the learner state test files share (vibe64TrainingLearnerState, vibe64TrainingInstalledCatalogue and
// vibe64TrainingLearnerAttempts): a learner store over an installed, pinned introduction course, and the tree and
// helpers their tests read it with.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile, execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createCourseLock, readPinnedTopic } from "../../packages/vibe64-training/src/server/catalogue.js";
import { createTrainingContentInstaller } from "../../packages/vibe64-training/src/server/contentInstaller.js";
import { createTrainingLearnerState } from "../../packages/vibe64-training/src/server/learnerState.js";
import { silentLogger } from "@jskit-ai/kernel/server/runtime/logger";

export async function fixture(t, { published = true, noExercise = false, secondLesson = false, preparationBusyWaitMs } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vibe64-learner-state-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const systemRoot = path.join(root, "system");
  const sourceRoot = path.join(root, "source");
  await fs.mkdir(systemRoot, { mode: 0o700 });
  await fs.mkdir(sourceRoot);
  async function write(filename, value, base = sourceRoot) {
    const destination = path.join(base, filename);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, typeof value === "string" ? value : `${JSON.stringify(value)}\n`);
  }
  const topic = { schemaVersion: 1, topicId: "intro-topic", domainId: "vibe64", title: "One introduction", status: "preview", outline: "training/outline.md", prerequisites: [],
    lessons: [{ code: "INTRO-01", descriptor: "training/lessons/INTRO-01/lesson.json", status: published ? "published" : "draft", required: true },
      ...(secondLesson ? [{ code: "INTRO-02", descriptor: "training/lessons/INTRO-02/lesson.json", status: "published", required: true }] : [])] };
  await write("package.json", { name: "learn-state-fixture", version: "0.1.0", repository: { type: "git", url: "https://github.com/examples/learn-state-fixture.git" }, vibe64Training: topic });
  await write("training/outline.md", "# One introduction\nTry the practice app.\n");
  await write("training/lessons/INTRO-01/lesson.json", { schemaVersion: 2, code: "INTRO-01", title: "Try the practice app", prerequisites: [], estimatedMinutes: 10,
    visuals: [], ...(noExercise ? {} : { exercise: { kind: "bundled", source: "../../exercises/app", reuse: "attempt" } }),
    steps: [{ id: "try-it", title: "Try it", body: "steps/try.md", check: { kind: "self" }, required: true }] });
  await write("training/lessons/INTRO-01/steps/try.md", "# Try the app\nPress its button.\n");
  if (secondLesson) {
    await write("training/lessons/INTRO-02/lesson.json", { schemaVersion: 2, code: "INTRO-02", title: "Read the next step", prerequisites: [], estimatedMinutes: 5,
      visuals: [], steps: [{ id: "read-it", title: "Read it", body: "steps/read.md", check: { kind: "self" }, required: true }] });
    await write("training/lessons/INTRO-02/steps/read.md", "# Read on\nThis is the next step.\n");
  }
  await write("training/exercises/app/package.json", { name: "state-practice-app", private: true, type: "module" });
  await write("training/exercises/app/server.mjs", 'import { createServer } from "node:http";\nconst args = process.argv.slice(2);\ncreateServer((request, response) => response.end("Practice app")).listen(Number(args[args.indexOf("--port") + 1] || 8080), args[args.indexOf("--host") + 1] || "127.0.0.1");\n');
  await write("training/exercises/app/genesis/version", "3\n");
  await write("training/exercises/app/genesis/stack.md", '# Stack\n\n## Components\n\n## Workspace setup\n\n- Prepare `Check syntax` with `nodejs`: `node` `--check` `server.mjs`\n\n## Outputs\n\n### Target `app`: Practice app\n\n- Default.\n- Mode: `interactive`\n- Workdir: `.`\n- Runtimes: `nodejs`\n- Run `Start`: `node` `server.mjs` `--host` `{host}` `--port` `{port}`\n\n#### Presentation\n\n- Kind: `web`\n- Preferred port: `8080`\n- URL path: `/`\n- Ready when: `GET` `/` returns `200`\n');
  execFileSync("git", ["-C", sourceRoot, "init", "-b", "main"], { stdio: "ignore" });
  execFileSync("git", ["-C", sourceRoot, "add", "."], { stdio: "ignore" });
  execFileSync("git", ["-C", sourceRoot, "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", "-c", "user.name=Training fixture", "-c", "user.email=training@example.invalid", "commit", "-m", "Pinned introduction"], { stdio: "ignore" });
  const sourcePin = await readPinnedTopic(sourceRoot);
  const topicPin = { schemaVersion: 1, topicId: sourcePin.topicId, release: sourcePin.release, repository: sourcePin.repository, commit: sourcePin.commit, topicHash: sourcePin.topicHash };
  await createTrainingContentInstaller({ systemRoot }).installTopic({ sourceRoot, pin: topicPin });
  const lock = createCourseLock({ schemaVersion: 1, courseId: "intro-course", title: "Introduction", release: "0.1.0", status: "preview", topics: [{ topicId: topicPin.topicId, release: topicPin.release }] }, [sourcePin]);
  const pinFor = index => ({ course: { courseId: lock.courseId, release: lock.release }, topic: topicPin,
    lesson: { code: lock.topics[0].lessons[index].code, hash: lock.topics[0].lessons[index].hash } });
  const pin = pinFor(0);
  const secondPin = secondLesson ? pinFor(1) : null;
  const actor = { uid: 42, username: "learner" };
  const state = createTrainingLearnerState({ logger: silentLogger, systemRoot, preparationBusyWaitMs });
  const userRoot = value => path.join(systemRoot, "training", "users", Buffer.from(String(value.uid ?? value.username)).toString("base64url"));
  const paths = { root: userRoot(actor), progress: path.join(userRoot(actor), "progress.json"), active: path.join(userRoot(actor), "active-lesson.json"),
    mode: path.join(userRoot(actor), "learning-mode.json"), lock: path.join(userRoot(actor), "state.lock") };
  const reserve = options => state.reserveAttempt({ actor, requestId: "start-1", expectedRevision: 0, pin, ...options });
  return { root, systemRoot, sourceRoot, pin, secondPin, actor, state, userRoot, paths, reserve, write };
}

export async function treeState(directory) {
  const result = [];
  async function visit(filename) {
    const stat = await fs.lstat(filename);
    const relative = path.relative(directory, filename);
    if (stat.isSymbolicLink()) result.push({ path: relative, link: await fs.readlink(filename) });
    else if (stat.isDirectory()) {
      result.push({ path: relative, directory: true, mode: stat.mode, mtime: stat.mtimeMs });
      for (const name of (await fs.readdir(filename)).sort()) await visit(path.join(filename, name));
    } else result.push({ path: relative, mode: stat.mode, mtime: stat.mtimeMs, hash: createHash("sha256").update(await fs.readFile(filename)).digest("hex") });
  }
  await visit(directory);
  return result;
}

// Fails, once, the removal of the temporary file a write renamed onto target: a failure after the file was published.
export function failCleanupAfterRename(t, target, message) {
  const realRename = fs.rename;
  const realRemove = fs.rm;
  let published = "";
  let interrupted = false;
  const renameSpy = t.mock.method(fs, "rename", async (...args) => {
    await realRename(...args);
    if (args[1] === target) published = String(args[0]);
  });
  const removeMock = t.mock.method(fs, "rm", async (...args) => {
    if (!interrupted && published && String(args[0]) === published) {
      interrupted = true;
      throw Object.assign(new Error(message), { code: "EIO" });
    }
    return realRemove(...args);
  });
  syncBuiltinESMExports();
  return { restore() { renameSpy.mock.restore(); removeMock.mock.restore(); syncBuiltinESMExports(); } };
}

export async function recoveryProcedure(f) {
  const guide = await fs.readFile(new URL("../../docs/training-state-recovery.md", import.meta.url), "utf8");
  const blocks = [...guide.matchAll(/^```bash\n([\s\S]*?)^```/gmu)].map(match => match[1]);
  assert.equal(blocks.length, 5, "Execute the guide's actual setup, backup, stage, validation and publication blocks.");
  const [setup, backup, stage, validate, publish] = blocks;
  const backupRoot = path.join(f.root, "private-checkpoints");
  await fs.mkdir(backupRoot, { mode: 0o700 });
  const run = (snippets, extra = {}) => promisify(execFile)(
    "/bin/bash",
    ["--noprofile", "--norc", "-c", [
      'trap \'printf "Fixture stage=%s\\n" "${stage:-}"\' EXIT',
      ...snippets
    ].join("\n")],
    {
      env: {
        ...process.env,
        system_root: f.systemRoot,
        application_root: fileURLToPath(new URL("../../", import.meta.url)),
        backup_root: backupRoot,
        ...extra
      }
    }
  );
  const copy = async () => {
    const result = await run([setup, backup]);
    return /^Copy completed: (.+)$/mu.exec(result.stdout)?.[1];
  };
  const restore = (checkpoint, extra) => run([setup, stage, validate, publish], { checkpoint, ...extra });
  const stagePath = result => /^Fixture stage=(.+)$/mu.exec(result.stdout)?.[1];
  return { backupRoot, setup, backup, stage, validate, publish, run, copy, restore, stagePath };
}
