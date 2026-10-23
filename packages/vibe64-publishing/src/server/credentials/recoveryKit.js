// The recovery kit: every publishing key in one age file sealed with a separate
// passphrase the person chooses and Vibe64 never stores. It is what brings an
// install key back after a lost or replaced computer, so a release that needs a
// key whose loss is fatal (the phone install key) waits until a kit holding it
// has been downloaded.
import { createHash } from "node:crypto";

import { ageDecrypt, ageEncrypt } from "@local/vibe64-packaging/server/keys";

const KIT_CONTRACT = "vibe64.publishing-recovery-kit.v1";

function kitError(message, code = "vibe64_publishing_recovery_kit_invalid") {
  return Object.assign(new Error(message), { code });
}

async function createRecoveryKit({ store, passphrase, now = () => new Date().toISOString(), workFactor } = {}) {
  const index = await store.index();
  const entries = store.snapshot();
  if (!entries.length) throw kitError("There are no publishing keys to put in a recovery kit yet.", "vibe64_publishing_recovery_kit_empty");
  const facts = new Map(index.entries.map((entry) => [entry.id, entry]));
  const createdAt = now();
  const plaintext = Buffer.from(JSON.stringify({
    contract: KIT_CONTRACT,
    createdAt,
    entries: entries.map(({ id, value }) => ({ ...(facts.get(id) || { id }), value: value.toString("base64") }))
  }), "utf8");
  try {
    const bytes = await ageEncrypt(plaintext, passphrase, workFactor ? { workFactor } : {});
    const record = {
      createdAt,
      entryIds: entries.map(({ id }) => id).sort(),
      sha256: `sha256:${createHash("sha256").update(bytes).digest("hex")}`
    };
    await store.recordRecoveryKit(record);
    return { bytes, fileName: `vibe64-publishing-recovery-kit-${createdAt.slice(0, 10)}.age`, record };
  } finally {
    plaintext.fill(0);
    for (const { value } of entries) value.fill(0);
  }
}

// Restores every key from a kit into the (unlocked) store; existing keys with
// the same name are replaced by the kit's.
async function restoreRecoveryKit({ store, bytes, passphrase } = {}) {
  const plaintext = await ageDecrypt(bytes, passphrase);
  let kit;
  try {
    kit = JSON.parse(plaintext.toString("utf8"));
  } catch {
    throw kitError("This file is not a Vibe64 recovery kit.");
  } finally {
    plaintext.fill(0);
  }
  if (kit?.contract !== KIT_CONTRACT || !Array.isArray(kit.entries)) throw kitError("This file is not a Vibe64 recovery kit.");
  const restored = [];
  for (const { id, value, kind, label, createdAt: _createdAt, ...meta } of kit.entries) {
    const buffer = Buffer.from(String(value || ""), "base64");
    try {
      await store.put(id, { value: buffer, kind, label, meta });
    } finally {
      buffer.fill(0);
    }
    restored.push(id);
  }
  return { restored: restored.sort(), createdAt: kit.createdAt };
}

// Whether the last downloaded kit holds this key (created after the key).
function recoveryKitCovers(status, entryId) {
  const kit = status?.recoveryKit;
  const entry = (status?.entries || []).find((candidate) => candidate.id === entryId);
  return Boolean(kit && entry && kit.entryIds.includes(entryId) && kit.createdAt >= entry.createdAt);
}

export { KIT_CONTRACT, createRecoveryKit, recoveryKitCovers, restoreRecoveryKit };
