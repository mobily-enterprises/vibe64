import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { codexAuthMarkerPath, writeCodexAuthMarker } from "../codexAuthState.js";

const id = "20260923-codex-login-id";

async function run({ systemRoot, apply, backupRoot, report }) {
  const markerPath = codexAuthMarkerPath(systemRoot);
  let original;
  try {
    original = await readFile(markerPath, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    report("info", "No Codex connection marker; nothing to upgrade.");
    return;
  }
  let marker;
  try {
    marker = JSON.parse(original);
  } catch {
    throw new Error("Codex status.json is not valid JSON; repair it before retrying.");
  }
  if (!marker || marker.version !== 1 || typeof marker.connected !== "boolean") {
    throw new Error("Codex status.json has an unsupported shape or version; inspect it before retrying.");
  }
  if (!marker.connected) {
    report("info", "Codex is disconnected; the next successful login creates its identity.");
    return;
  }
  if (Object.hasOwn(marker, "loginId")) {
    if (typeof marker.loginId !== "string" ||
        !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(marker.loginId)) {
      throw new Error("Codex status.json contains an invalid loginId; refusing to replace an existing identity.");
    }
    report("info", "Codex login identity is already present; preserving it.");
    return;
  }
  report("warning", "Existing Codex connection needs a local login identity. Previous temporary-assistance ownership will not carry over.");
  if (!apply) return;
  await mkdir(backupRoot, { recursive: true, mode: 0o700 });
  const backupPath = path.join(backupRoot, "codex-status.json");
  try {
    await writeFile(backupPath, original, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    if (await readFile(backupPath, "utf8") !== original) {
      throw new Error("Codex marker differs from the saved upgrade backup; inspect both before retrying.");
    }
  }
  if (await readFile(markerPath, "utf8") !== original) {
    throw new Error("Codex marker changed during upgrade; stop all writers before retrying.");
  }
  await writeCodexAuthMarker(systemRoot, { ...marker, loginId: randomUUID() });
  report("info", "Added local Codex login identity; original marker backed up. Native credentials were not changed.");
}

export default { id, run };
