import { writeFile } from "node:fs/promises";

import {
  createVibe64SessionStore
} from "@local/vibe64-runtime/server";

const [
  projectLocalRoot = "",
  targetRoot = "",
  sessionId = "",
  metadataName = "",
  delayMs = "0",
  enteredPath = ""
] = process.argv.slice(2);

const store = createVibe64SessionStore({
  projectLocalRoot,
  targetRoot
});

await store.mutateSession(sessionId, async () => {
  await writeFile(enteredPath, `${new Date().toISOString()}\n`, "utf8");
  await new Promise((resolve) => {
    setTimeout(resolve, Number(delayMs) || 0);
  });
  await store.writeMetadataValue(sessionId, metadataName, "done");
});
