import { mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { bundleFiles, canonicalJson, validateTopic } from "./content.js";

async function runTrainingCli(args, { write = text => console.log(text) } = {}) {
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
