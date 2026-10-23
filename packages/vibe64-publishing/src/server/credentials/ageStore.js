// The person's publishing keys on this computer: tokens, sign-ins and signing
// keys in one age file encrypted with their passphrase, in their own home
// folder (`<personal publishing folder>/keys.age`, mode 0600). A plain index
// beside it lists what is stored (ids, kinds, labels, public facts), never a
// secret value.
//
// The person unlocks the keys in Vibe64's own interface, for one release or a
// short window. While unlocked, the decrypted values live only in this process's
// memory; locking (or the window ending) zeroes them. Any program running as
// the same user can read memory and files of that user, which the Publish page
// says plainly.
import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { DEFAULT_WORK_FACTOR, ageDecrypt, ageEncrypt } from "./age.js";
import { readJsonFile, serialized, writeJsonFile } from "../state/jsonFile.js";

const KEYS_CONTRACT = "vibe64.publishing-keys.v1";
const INDEX_CONTRACT = "vibe64.publishing-keys-index.v1";
const ENTRY_ID = /^[a-z0-9][a-z0-9:._-]{0,127}$/u;
const DEFAULT_WINDOW_MS = 15 * 60 * 1000;
const MAX_WINDOW_MS = 8 * 60 * 60 * 1000;

function storeError(message, code) {
  return Object.assign(new Error(message), { code });
}

function publicFacts(meta = {}) {
  const facts = {};
  for (const [name, value] of Object.entries(meta || {})) {
    if (!/^[a-z][A-Za-z0-9]*$/u.test(name)) continue;
    if (typeof value === "string" && value.length <= 512) facts[name] = value;
    else if (typeof value === "boolean" || Number.isFinite(value)) facts[name] = value;
  }
  return facts;
}

function createAgeStore({
  directory,
  now = () => Date.now(),
  workFactor = DEFAULT_WORK_FACTOR,
  defaultWindowMs = DEFAULT_WINDOW_MS
} = {}) {
  if (!path.isAbsolute(directory || "")) throw new TypeError("The publishing key store needs an absolute folder.");
  const file = path.join(directory, "keys.age");
  const indexFile = path.join(directory, "keys-index.json");
  const exclusive = serialized();
  let unlocked = null; // { entries: Map<id, Buffer>, passphrase: Buffer, until: number }

  function zero() {
    if (!unlocked) return;
    for (const value of unlocked.entries.values()) value.fill(0);
    unlocked.passphrase.fill(0);
    unlocked = null;
  }

  function current() {
    if (unlocked && now() >= unlocked.until) zero();
    return unlocked;
  }

  function requireUnlocked() {
    const state = current();
    if (!state) throw storeError("Unlock your publishing keys first.", "vibe64_publishing_keys_locked");
    return state;
  }

  async function exists() {
    return Boolean(await stat(file).catch(() => null));
  }

  async function readIndex() {
    const value = await readJsonFile(indexFile, () => ({ contract: INDEX_CONTRACT, entries: [], recoveryKit: null }));
    if (value?.contract !== INDEX_CONTRACT) throw storeError("The publishing key index is not in a format this Vibe64 reads.", "vibe64_publishing_state_invalid");
    return value;
  }

  async function writeIndex(index) {
    await writeJsonFile(indexFile, { ...index, contract: INDEX_CONTRACT }, { mode: 0o600, directoryMode: 0o700 });
  }

  async function seal(state) {
    const entries = Object.fromEntries([...state.entries].map(([id, value]) => [id, value.toString("base64")]));
    const plaintext = Buffer.from(JSON.stringify({ contract: KEYS_CONTRACT, entries }), "utf8");
    try {
      const sealed = await ageEncrypt(plaintext, state.passphrase, { workFactor });
      await writeBytes(sealed);
    } finally {
      plaintext.fill(0);
    }
  }

  async function writeBytes(bytes) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);
    const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
    try {
      await writeFile(temporary, bytes, { mode: 0o600, flag: "wx" });
      await rename(temporary, file);
    } finally {
      await rm(temporary, { force: true });
    }
  }

  async function open(passphrase) {
    const decrypted = await ageDecrypt(await readFile(file), passphrase);
    try {
      const value = JSON.parse(decrypted.toString("utf8"));
      if (value?.contract !== KEYS_CONTRACT) throw storeError("These publishing keys are not in a format this Vibe64 reads.", "vibe64_publishing_state_invalid");
      return new Map(Object.entries(value.entries).map(([id, encoded]) => [id, Buffer.from(encoded, "base64")]));
    } finally {
      decrypted.fill(0);
    }
  }

  function windowOf(windowMs) {
    const value = windowMs === undefined || windowMs === null ? defaultWindowMs : Number(windowMs);
    if (!Number.isInteger(value) || value < 1000 || value > MAX_WINDOW_MS) throw storeError("Keys unlock for between a second and eight hours.", "vibe64_publishing_keys_window_invalid");
    return value;
  }

  async function status() {
    const state = current();
    const index = await readIndex();
    return {
      exists: await exists(),
      unlocked: Boolean(state),
      unlockedUntil: state ? new Date(state.until).toISOString() : null,
      entries: index.entries,
      recoveryKit: index.recoveryKit || null
    };
  }

  return Object.freeze({
    directory,
    file,
    status,
    create({ passphrase, windowMs } = {}) {
      return exclusive(async () => {
        if (await exists()) throw storeError("Your publishing keys already exist. Unlock them instead.", "vibe64_publishing_keys_exist");
        zero();
        const state = { entries: new Map(), passphrase: Buffer.from(String(passphrase ?? ""), "utf8"), until: now() + windowOf(windowMs) };
        try {
          await seal(state);
        } catch (error) {
          state.passphrase.fill(0);
          throw error;
        }
        unlocked = state;
        await writeIndex({ entries: [], recoveryKit: null });
        return status();
      });
    },
    unlock({ passphrase, windowMs } = {}) {
      return exclusive(async () => {
        if (!await exists()) throw storeError("Create your publishing keys first.", "vibe64_publishing_keys_missing");
        const entries = await open(passphrase);
        zero();
        unlocked = { entries, passphrase: Buffer.from(String(passphrase), "utf8"), until: now() + windowOf(windowMs) };
        return status();
      });
    },
    lock() {
      zero();
      return status();
    },
    isUnlocked() {
      return Boolean(current());
    },
    // Internal: the decrypted value of one entry, for one Stage 2 operation.
    // Callers copy it into the stage's private file; never into a response.
    read(id) {
      const state = requireUnlocked();
      const value = state.entries.get(id);
      if (!value) throw storeError(`Your publishing keys hold no ${id}.`, "vibe64_publishing_key_missing");
      return Buffer.from(value);
    },
    has(id) {
      return Boolean(current()?.entries.has(id));
    },
    put(id, { value, kind, label, meta = {} } = {}) {
      return exclusive(async () => {
        if (!ENTRY_ID.test(id || "")) throw storeError("That key name is not valid.", "vibe64_publishing_key_invalid");
        const state = requireUnlocked();
        const bytes = Buffer.isBuffer(value) ? Buffer.from(value) : Buffer.from(String(value ?? ""), "utf8");
        if (!bytes.length) throw storeError("There is nothing to store.", "vibe64_publishing_key_invalid");
        const previous = state.entries.get(id);
        state.entries.set(id, bytes);
        try {
          await seal(state);
        } catch (error) {
          if (previous) state.entries.set(id, previous);
          else state.entries.delete(id);
          throw error;
        }
        previous?.fill(0);
        const index = await readIndex();
        const entry = { id, kind: String(kind || "secret"), label: String(label || id).slice(0, 200), createdAt: new Date(now()).toISOString(), ...publicFacts(meta) };
        await writeIndex({ ...index, entries: [...index.entries.filter((existing) => existing.id !== id), entry].sort((left, right) => left.id.localeCompare(right.id)) });
        return entry;
      });
    },
    remove(id) {
      return exclusive(async () => {
        const state = requireUnlocked();
        const previous = state.entries.get(id);
        if (!previous) throw storeError(`Your publishing keys hold no ${id}.`, "vibe64_publishing_key_missing");
        state.entries.delete(id);
        await seal(state);
        previous.fill(0);
        const index = await readIndex();
        await writeIndex({ ...index, entries: index.entries.filter((entry) => entry.id !== id) });
        return { removed: id };
      });
    },
    // Internal, for the recovery kit: every entry with its index facts.
    snapshot() {
      const state = requireUnlocked();
      return [...state.entries].map(([id, value]) => ({ id, value: Buffer.from(value) }));
    },
    async index() {
      return readIndex();
    },
    recordRecoveryKit(record) {
      return exclusive(async () => {
        const index = await readIndex();
        await writeIndex({ ...index, recoveryKit: record });
        return record;
      });
    }
  });
}

export { createAgeStore };
