import { writeFile } from "node:fs/promises";

import {
  createVibe64SessionStore
} from "@local/vibe64-runtime/server";

const [
  projectLocalRoot = "",
  targetRoot = "",
  sessionId = "",
  metadataName = "",
  enteredPath = "",
  mode = "run"
] = process.argv.slice(2);

const store = createVibe64SessionStore({
  projectLocalRoot,
  targetRoot
});

function send(message) {
  return new Promise((resolve, reject) => {
    if (typeof process.send !== "function") {
      reject(new Error("Session mutation worker requires an IPC channel."));
      return;
    }
    process.send(message, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function waitForRelease() {
  return new Promise((resolve, reject) => {
    function cleanup() {
      process.off("disconnect", onDisconnect);
      process.off("message", onMessage);
    }
    function onDisconnect() {
      cleanup();
      reject(new Error("Session mutation worker disconnected before release."));
    }
    function onMessage(message) {
      if (message?.type !== "release") {
        return;
      }
      cleanup();
      resolve();
    }
    process.on("disconnect", onDisconnect);
    process.on("message", onMessage);
  });
}

const release = mode === "hold" ? waitForRelease() : Promise.resolve();
const mutation = store.mutateSession(sessionId, async () => {
  await writeFile(enteredPath, `${new Date().toISOString()}\n`, "utf8");
  if (mode === "hold") {
    await send({
      type: "entered"
    });
  }
  await release;
  await store.writeMetadataValue(sessionId, metadataName, "done");
});

if (mode !== "hold") {
  await send({
    type: "mutation-requested"
  });
}
await mutation;
