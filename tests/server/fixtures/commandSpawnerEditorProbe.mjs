// An editor, for commandSpawner.unit.test.js: it starts its command spawner, as the editor server does at boot, then
// one long command each through execFileCommand, runCaptureCommand and spawnCommand, each writing its pid to
// <dir>/<way>.pid, and runs until it is ended.
// Usage: node commandSpawnerEditorProbe.mjs <dir>
import { mkdirSync } from "node:fs";
import path from "node:path";

import { runCaptureCommand } from "../../../packages/vibe64-execution/src/server/engines/capture.js";
import {
  execFileCommand,
  spawnCommand,
  startCommandSpawner
} from "../../../packages/vibe64-execution/src/server/engines/commandSpawner.js";

const dir = process.argv[2];
mkdirSync(dir, { recursive: true });
startCommandSpawner();
const env = { PATH: process.env.PATH };
const run = (name) => ["sh", ["-c", `echo $$ > ${path.join(dir, `${name}.pid`)}; exec sleep 30`]];
execFileCommand(...run("execFile"), { env }).catch(() => {});
void runCaptureCommand(...run("capture"), { env, timeout: 60_000 });
spawnCommand(...run("spawn"), { env }).on("error", () => {});
