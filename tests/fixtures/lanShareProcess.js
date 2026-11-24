// A phone share in a process of its own, as the editor runs it, so a test sees whether anything a phone or the shared
// file does ends that process. It shares the APK its first argument names, sends its parent the address, and answers
// "state" with how many of its descriptors are open on the APK and what it warned, and "stop" by stopping and exiting.
import { readdirSync, readlinkSync } from "node:fs";
import path from "node:path";

import { createLanShare } from "../../packages/vibe64-publishing/src/server/lanShare.js";

const [file] = process.argv.slice(2);
const warnings = [];
const share = createLanShare({
  addresses: () => ["127.0.0.1"],
  host: "127.0.0.1",
  logger: { warn: (fields) => warnings.push(fields) }
});
const started = await share.start({ key: "r-1/app", file, fileName: path.basename(file) });

/** This process's descriptors open on the file, removed or not. */
function openDescriptors() {
  let count = 0;
  for (const descriptor of readdirSync("/proc/self/fd")) {
    try {
      if (readlinkSync(`/proc/self/fd/${descriptor}`).replace(/ \(deleted\)$/u, "") === file) count += 1;
    } catch {
      // A descriptor closed while the folder was read.
    }
  }
  return count;
}

process.on("message", async (message) => {
  if (message === "state") process.send({ type: "state", openFiles: openDescriptors(), warnings });
  if (message === "stop") {
    await share.stop();
    process.exit(0);
  }
});
process.send({ type: "ready", url: started.url });
