import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  assertSafeOsUsername,
  normalizeOsUsername
} from "./osUserIdentity.js";
import {
  MAX_PREFERRED_NAME_LENGTH,
  normalizePreferredName
} from "./personalAiProfile.js";

const MEMBERSHIP_RECORD_VERSION = 2;
const ACTIVE_MEMBERSHIP_STATUSES = new Set(["active"]);
const membershipRecordMutations = new Map();

function membershipRootFromDaemonStateRoot(daemonStateRoot = "") {
  if (!daemonStateRoot) {
    throw new Error("A daemon state root is required for Vibe64 membership.");
  }
  return path.join(path.resolve(daemonStateRoot), "users");
}

function normalizeMembershipRole(value = "") {
  return String(value || "").trim() === "owner" ? "owner" : "member";
}

function normalizeMembershipStatus(value = "") {
  return ACTIVE_MEMBERSHIP_STATUSES.has(String(value || "").trim()) ? "active" : "disabled";
}

function normalizeMembershipRecord(record = {}, {
  username = ""
} = {}) {
  const normalizedUsername = assertSafeOsUsername(record.username || username);
  const now = new Date().toISOString();
  const github = normalizeGithubIdentity(record.github);
  return {
    createdAt: String(record.createdAt || now),
    ...(github ? { github } : {}),
    preferredName: normalizePreferredName(record.preferredName),
    role: normalizeMembershipRole(record.role),
    status: normalizeMembershipStatus(record.status || "active"),
    updatedAt: String(record.updatedAt || record.createdAt || now),
    username: normalizedUsername,
    version: MEMBERSHIP_RECORD_VERSION
  };
}

function normalizeStoredMembershipRecord(record, {
  username = ""
} = {}) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    const error = new Error("Vibe64 membership record must be an object.");
    error.code = "vibe64_membership_record_invalid";
    throw error;
  }
  if (record.version !== 1 && record.version !== MEMBERSHIP_RECORD_VERSION) {
    const error = new Error(
      `Vibe64 membership record version ${String(record.version ?? "(missing)")} is not supported.`
    );
    error.code = "vibe64_membership_record_version_unsupported";
    throw error;
  }
  if (
    record.version === MEMBERSHIP_RECORD_VERSION &&
    !Object.hasOwn(record, "preferredName")
  ) {
    const error = new Error("Vibe64 membership record is missing preferredName.");
    error.code = "vibe64_membership_record_invalid";
    throw error;
  }
  return normalizeMembershipRecord({
    ...record,
    ...(record.version === 1 ? { preferredName: "" } : {})
  }, {
    username
  });
}

function publicMembership(record = {}) {
  const normalized = normalizeMembershipRecord(record);
  return {
    createdAt: normalized.createdAt,
    preferredName: normalized.preferredName,
    role: normalized.role,
    status: normalized.status,
    updatedAt: normalized.updatedAt,
    username: normalized.username
  };
}

function normalizeGithubIdentity(identity = {}) {
  const login = String(identity?.login || "").trim();
  if (!login) {
    return null;
  }
  return {
    avatarUrl: String(identity.avatarUrl || identity.avatar_url || ""),
    connectedAt: String(identity.connectedAt || ""),
    id: identity.id ?? null,
    login
  };
}

function createVibe64MembershipStore({
  membershipRoot = "",
  osUserResolver = null
} = {}) {
  if (!membershipRoot) {
    throw new Error("createVibe64MembershipStore requires membershipRoot.");
  }
  const root = path.resolve(membershipRoot);

  async function ensureRoot() {
    await mkdir(root, {
      mode: 0o700,
      recursive: true
    });
  }

  function userPath(username = "") {
    return path.join(root, `${assertSafeOsUsername(username)}.json`);
  }

  async function readMembership(username = "") {
    const normalizedUsername = assertSafeOsUsername(username);
    try {
      return normalizeStoredMembershipRecord(JSON.parse(await readFile(userPath(normalizedUsername), "utf8")), {
        username: normalizedUsername
      });
    } catch (error) {
      if (error?.code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  async function listMemberships() {
    await ensureRoot();
    const entries = await readdir(root, {
      withFileTypes: true
    });
    const records = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) {
        continue;
      }
      const username = entry.name.slice(0, -".json".length);
      try {
        const record = await readMembership(username);
        if (record) {
          records.push(record);
        }
      } catch {
        continue;
      }
    }
    return records.sort((left, right) => left.username.localeCompare(right.username));
  }

  async function requireOsUser(username = "") {
    if (typeof osUserResolver !== "function") {
      return null;
    }
    return osUserResolver(username);
  }

  async function writeMembership(record = {}) {
    const normalized = normalizeMembershipRecord(record);
    const filePath = userPath(normalized.username);
    const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(tempPath, `${JSON.stringify(normalized, null, 2)}\n`, {
        flag: "wx",
        mode: 0o600
      });
      await rename(tempPath, filePath);
      return normalized;
    } finally {
      await rm(tempPath, {
        force: true
      });
    }
  }

  async function mutateMembership(username = "", operation) {
    const normalizedUsername = assertSafeOsUsername(username);
    const filePath = userPath(normalizedUsername);
    const previous = membershipRecordMutations.get(filePath) || Promise.resolve();
    const mutation = previous.catch(() => {}).then(() => operation(normalizedUsername));
    membershipRecordMutations.set(filePath, mutation);
    try {
      return await mutation;
    } finally {
      if (membershipRecordMutations.get(filePath) === mutation) {
        membershipRecordMutations.delete(filePath);
      }
    }
  }

  async function enableUser(username = "", {
    role = "member"
  } = {}) {
    return mutateMembership(username, async (normalizedUsername) => {
      await requireOsUser(normalizedUsername);
      await ensureRoot();
      const existing = await readMembership(normalizedUsername);
      const now = new Date().toISOString();
      const record = normalizeMembershipRecord({
        ...(existing || {}),
        createdAt: existing?.createdAt || now,
        role,
        status: "active",
        updatedAt: now,
        username: normalizedUsername
      });
      return writeMembership(record);
    });
  }

  async function disableUser(username = "") {
    return mutateMembership(username, async (normalizedUsername) => {
      const existing = await readMembership(normalizedUsername);
      if (!existing) {
        return null;
      }
      if (existing.role === "owner") {
        const activeOwners = (await listMemberships()).filter((record) => (
          record.role === "owner" &&
          record.status === "active" &&
          record.username !== normalizedUsername
        ));
        if (activeOwners.length === 0) {
          const error = new Error("You cannot disable the last Vibe64 owner.");
          error.code = "vibe64_cannot_disable_last_owner";
          throw error;
        }
      }
      const now = new Date().toISOString();
      const record = normalizeMembershipRecord({
        ...existing,
        status: "disabled",
        updatedAt: now
      });
      return writeMembership(record);
    });
  }

  async function updateGithubIdentity(username = "", identity = {}) {
    return mutateMembership(username, async (normalizedUsername) => {
      const existing = await readMembership(normalizedUsername);
      if (!existing) {
        return null;
      }
      const now = new Date().toISOString();
      return writeMembership({
        ...existing,
        github: normalizeGithubIdentity({
          ...identity,
          connectedAt: identity.connectedAt || now
        }),
        updatedAt: now
      });
    });
  }

  async function updatePreferredName(username = "", preferredName = "") {
    return mutateMembership(username, async (normalizedUsername) => {
      const existing = await readMembership(normalizedUsername);
      if (!existing) {
        return null;
      }
      return writeMembership({
        ...existing,
        preferredName: normalizePreferredName(preferredName),
        updatedAt: new Date().toISOString()
      });
    });
  }

  async function removeUser(username = "") {
    return mutateMembership(username, async (normalizedUsername) => {
      await rm(userPath(normalizedUsername), {
        force: true
      });
    });
  }

  async function requireActiveUser(username = "") {
    const normalizedUsername = normalizeOsUsername(username);
    const record = normalizedUsername ? await readMembership(normalizedUsername) : null;
    if (!record || record.status !== "active") {
      const error = new Error("OS user is not enabled for Vibe64.");
      error.code = "vibe64_os_user_not_enabled";
      throw error;
    }
    return record;
  }

  return Object.freeze({
    disableUser,
    enableUser,
    listMemberships,
    publicMembership,
    readMembership,
    removeUser,
    requireActiveUser,
    updateGithubIdentity,
    updatePreferredName,
    root
  });
}

export {
  ACTIVE_MEMBERSHIP_STATUSES,
  MAX_PREFERRED_NAME_LENGTH,
  MEMBERSHIP_RECORD_VERSION,
  createVibe64MembershipStore,
  membershipRootFromDaemonStateRoot,
  normalizeMembershipRecord,
  normalizePreferredName,
  publicMembership
};
