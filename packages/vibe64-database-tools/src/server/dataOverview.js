import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { sessionSourcePath } from "@local/vibe64-core/server/sessionSourcePath";
import { DATA_OVERVIEW_MAX_BYTES, DATA_OVERVIEW_PATH, validateDataOverview } from "../shared/dataOverview.js";

export async function readDataOverview(session) {
  const result = { path: DATA_OVERVIEW_PATH, present: false, hash: "", error: "", definition: { version: 1, actors: [] } };
  const root = sessionSourcePath(session);
  if (!root) return result;
  let handle;
  try {
    handle = await open(path.join(root, DATA_OVERVIEW_PATH), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    result.present = true;
    const stats = await handle.stat();
    if (!stats.isFile() || stats.size > DATA_OVERVIEW_MAX_BYTES) throw new Error("Data overview must be a regular JSON file smaller than 256 KiB.");
    const buffer = Buffer.alloc(DATA_OVERVIEW_MAX_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > DATA_OVERVIEW_MAX_BYTES) throw new Error("Data overview is larger than 256 KiB.");
    const content = buffer.subarray(0, length);
    result.hash = createHash("sha256").update(content).digest("hex");
    result.definition = validateDataOverview(JSON.parse(content.toString("utf8")));
  } catch (error) {
    if (error.code !== "ENOENT") {
      result.present = true;
      result.error = error.message || "The data overview could not be read.";
    }
  } finally {
    await handle?.close();
  }
  return result;
}
