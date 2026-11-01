import { constants } from "node:fs";
import { open } from "node:fs/promises";
import path from "node:path";

import { GENESIS_MACHINE_CITY_PATH } from "@local/vibe64-genesis/server";

/**
 * The Machine City's architecture.sourceHash: the scan a recording runs
 * against, so results can say when the source has changed since. Genesis sorts
 * keys and the City can be tens of MiB, so this streams it and follows only
 * strings, nesting and the key at each level until it reaches that one field.
 */
async function readSourceIdentity(sourceRoot) {
  const target = ["architecture", "sourceHash"];
  const keys = [];
  let inString = false;
  let escaped = false;
  let text = "";
  let afterColon = false;
  const structure = /["{}[\]:,]/gu;
  const stringEnd = /["\\]/gu;
  // Opened as a regular file only, never through a link or from a FIFO.
  let handle;
  try {
    handle = await open(path.join(sourceRoot, GENESIS_MACHINE_CITY_PATH), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch {
    return null;
  }
  const stream = handle.createReadStream({ encoding: "utf8", highWaterMark: 1024 * 1024 });
  try {
    if (!(await handle.stat()).isFile()) return null;
    for await (const chunk of stream) {
      let index = 0;
      while (index < chunk.length) {
        if (escaped) {
          escaped = false;
          index += 1;
          continue;
        }
        const pattern = inString ? stringEnd : structure;
        pattern.lastIndex = index;
        const match = pattern.exec(chunk);
        const end = match ? match.index : chunk.length;
        if (inString && keys.length <= target.length && text.length < 80) text += chunk.slice(index, Math.min(end, index + 80));
        if (!match) break;
        index = end + 1;
        const found = match[0];
        if (found === "\\") {
          escaped = true;
        } else if (found === "\"" && !inString) {
          inString = true;
          text = "";
        } else if (found === "\"") {
          inString = false;
          if (afterColon && keys.length === target.length && keys.every((key, level) => key === target[level])) {
            return /^sha256:[0-9a-f]{64}$/u.test(text) ? text : null;
          }
          afterColon = false;
        } else if (found === ":") {
          keys[keys.length - 1] = text;
          afterColon = true;
        } else if (found === "{" || found === "[") {
          keys.push(null);
          afterColon = false;
        } else if (found === "}" || found === "]") {
          keys.pop();
          if (!keys.length) return null;
        } else {
          afterColon = false;
        }
      }
    }
    return null;
  } catch {
    return null;
  } finally {
    stream.destroy();
  }
}

export { readSourceIdentity };
