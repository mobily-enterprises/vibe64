import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";

const USER_RECORD_VERSION = 2;
const MAX_TENANT_USERS = 10;
const EMAIL_PATTERN = /^[^\s@/\\]+@[^\s@/\\]+\.[^\s@/\\]+$/u;
const ACTIVE_USER_STATUSES = new Set(["active", "invited"]);
const SAFE_FILE_STEM_PATTERN = /^[A-Za-z0-9_.:-]+$/u;

function canonicalUserEmail(value = "") {
  const email = String(value || "").trim().toLowerCase();
  if (!EMAIL_PATTERN.test(email)) {
    const error = new Error("Enter a valid email address.");
    error.code = "vibe64_invalid_user_email";
    throw error;
  }
  return email;
}

function publicUser(record = {}) {
  const normalized = normalizeUserRecord(record);
  return {
    acceptedAt: normalized.acceptedAt,
    canceledAt: normalized.canceledAt,
    createdAt: normalized.createdAt,
    email: normalized.email,
    gravatarUrl: gravatarUrl(normalized.email),
    github: normalized.github,
    identityLinked: Boolean(normalized.supabaseUserId),
    invitedAt: normalized.invitedAt,
    owner: normalized.role === "owner",
    revokedAt: normalized.revokedAt,
    role: normalized.role,
    status: normalized.status,
    updatedAt: normalized.updatedAt
  };
}

function gravatarUrl(email = "") {
  const hash = crypto.createHash("md5").update(canonicalUserEmail(email)).digest("hex");
  return `https://www.gravatar.com/avatar/${hash}?d=identicon`;
}

function createFileUserStore({
  usersRoot = ""
} = {}) {
  if (!usersRoot) {
    throw new Error("createFileUserStore requires usersRoot.");
  }
  const root = path.resolve(usersRoot);

  async function ensureRoot() {
    await mkdir(root, {
      recursive: true
    });
  }

  function emailUserPath(email = "") {
    return path.join(root, `${canonicalUserEmail(email)}.json`);
  }

  function userRecordPath(record = {}) {
    const normalized = normalizeUserRecord(record);
    const stem = normalized.supabaseUserId
      ? canonicalUserFileStem(normalized.supabaseUserId)
      : canonicalUserEmail(normalized.email);
    return path.join(root, `${stem}.json`);
  }

  async function readUserFile(filePath = "") {
    const record = normalizeUserRecord(JSON.parse(await readFile(filePath, "utf8")));
    return canonicalStoredUserRecord(filePath, record);
  }

  async function readUser(email = "") {
    const normalizedEmail = canonicalUserEmail(email);
    return (await listUsers()).find((user) => user.email === normalizedEmail) || null;
  }

  async function writeUser(record = {}) {
    await ensureRoot();
    const normalized = normalizeUserRecord(record);
    const filePath = userRecordPath(normalized);
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
    await rename(tempPath, filePath);
    const invitePath = emailUserPath(normalized.email);
    if (invitePath !== filePath) {
      await rm(invitePath, {
        force: true
      });
    }
    return normalized;
  }

  async function deleteUserRecord(record = {}) {
    await ensureRoot();
    const normalized = normalizeUserRecord(record);
    await rm(userRecordPath(normalized), {
      force: true
    });
    await rm(emailUserPath(normalized.email), {
      force: true
    });
    return normalized;
  }

  async function listUsers() {
    await ensureRoot();
    const entries = await readdir(root, {
      withFileTypes: true
    });
    const usersByKey = new Map();
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) {
        continue;
      }
      const user = await readUserFile(path.join(root, entry.name));
      if (!user) {
        continue;
      }
      usersByKey.set(user.supabaseUserId || user.email, user);
    }
    return [...usersByKey.values()].sort((left, right) => left.email.localeCompare(right.email));
  }

  async function setupRequired() {
    const users = await listUsers();
    return !users.some((user) => user.role === "owner" && ACTIVE_USER_STATUSES.has(user.status));
  }

  async function ownerInvitePending() {
    const users = await listUsers();
    return (
      !users.some((user) => user.role === "owner" && user.status === "active") &&
      users.some((user) => user.role === "owner" && user.status === "invited" && !user.supabaseUserId)
    );
  }

  async function acceptSupabaseIdentity(identity = {}) {
    const email = canonicalUserEmail(identity.email);
    const supabaseUserId = canonicalSupabaseUserId(identity.id || identity.sub);
    const now = new Date().toISOString();
    const users = await listUsers();
    const linked = users.find((user) => user.supabaseUserId === supabaseUserId);
    if (linked) {
      return activateLinkedUser(linked, {
        email,
        now,
        supabaseUserId
      });
    }

    const existing = await readUser(email);
    if (existing) {
      return activateExistingUser(existing, {
        now,
        supabaseUserId
      });
    }

    if (!users.some((user) => user.role === "owner" && ACTIVE_USER_STATUSES.has(user.status))) {
      return writeUser({
        acceptedAt: now,
        createdAt: now,
        email,
        role: "owner",
        status: "active",
        supabaseUserId,
        updatedAt: now,
        version: USER_RECORD_VERSION
      });
    }

    const error = new Error("This Supabase user is not invited to this Vibe64 instance.");
    error.code = "vibe64_user_not_invited";
    throw error;
  }

  async function activateLinkedUser(user, {
    email = "",
    now = new Date().toISOString(),
    supabaseUserId = ""
  } = {}) {
    if (user.status === "revoked") {
      const error = new Error("This user has been removed from this Vibe64 instance.");
      error.code = "vibe64_user_revoked";
      throw error;
    }
    if (user.status === "canceled") {
      const error = new Error("This invite has been canceled.");
      error.code = "vibe64_invite_canceled";
      throw error;
    }
    if (email !== user.email) {
      const error = new Error("Supabase email does not match this local Vibe64 member.");
      error.code = "vibe64_supabase_email_mismatch";
      throw error;
    }
    return writeUser({
      ...user,
      acceptedAt: user.acceptedAt || now,
      status: "active",
      supabaseUserId,
      updatedAt: now
    });
  }

  async function activateExistingUser(user, {
    now = new Date().toISOString(),
    supabaseUserId = ""
  } = {}) {
    if (user.status === "revoked") {
      const error = new Error("This user has been removed from this Vibe64 instance.");
      error.code = "vibe64_user_revoked";
      throw error;
    }
    if (user.status === "canceled") {
      const error = new Error("This invite has been canceled.");
      error.code = "vibe64_invite_canceled";
      throw error;
    }
    if (user.supabaseUserId && user.supabaseUserId !== supabaseUserId) {
      const error = new Error("This email is already linked to another Supabase user.");
      error.code = "vibe64_supabase_user_mismatch";
      throw error;
    }
    return writeUser({
      ...user,
      acceptedAt: user.acceptedAt || now,
      status: "active",
      supabaseUserId,
      updatedAt: now
    });
  }

  async function inviteUser(input = {}) {
    const email = canonicalUserEmail(input.email);
    const existing = await readUser(email);
    const now = new Date().toISOString();
    if (existing?.status === "active") {
      return existing;
    }
    await assertTenantUserCapacity(email);
    const invited = await writeUser({
      ...(existing || {}),
      acceptedAt: "",
      canceledAt: "",
      createdAt: existing?.createdAt || now,
      email,
      invitedAt: now,
      revokedAt: "",
      role: "member",
      status: "invited",
      supabaseUserId: "",
      updatedAt: now,
      version: USER_RECORD_VERSION
    });
    if (existing?.supabaseUserId) {
      await rm(userRecordPath(existing), {
        force: true
      });
    }
    return invited;
  }

  async function cancelInvite(input = {}) {
    const email = canonicalUserEmail(input.email);
    const user = await requireUser(email);
    if (user.status !== "invited") {
      const error = new Error("Only pending invites can be canceled.");
      error.code = "vibe64_invite_not_pending";
      throw error;
    }
    const now = new Date().toISOString();
    await deleteUserRecord(user);
    return normalizeUserRecord({
      ...user,
      canceledAt: now,
      status: "canceled",
      updatedAt: now
    });
  }

  async function revokeUser(input = {}, actor = {}) {
    const email = canonicalUserEmail(input.email);
    const actorEmail = actor?.email ? canonicalUserEmail(actor.email) : "";
    if (actorEmail && email === actorEmail) {
      const error = new Error("You cannot remove your own Vibe64 user.");
      error.code = "vibe64_cannot_revoke_self";
      throw error;
    }
    const user = await requireUser(email);
    if (user.status === "invited") {
      return cancelInvite(input);
    }
    if (user.status !== "active") {
      return deleteUserRecord(user);
    }
    if (user.role === "owner") {
      const activeOwners = (await listUsers()).filter((item) => (
        item.role === "owner" &&
        item.status === "active" &&
        item.email !== email
      ));
      if (activeOwners.length === 0) {
        const error = new Error("You cannot remove the last active owner.");
        error.code = "vibe64_cannot_revoke_last_owner";
        throw error;
      }
    }
    const now = new Date().toISOString();
    await deleteUserRecord(user);
    return normalizeUserRecord({
      ...user,
      revokedAt: now,
      status: "revoked",
      updatedAt: now
    });
  }

  async function userForSession(session = {}) {
    const supabaseUserId = String(session.supabaseUserId || "").trim();
    if (!supabaseUserId) {
      return null;
    }
    const users = await listUsers();
    const user = users.find((item) => item.supabaseUserId === supabaseUserId);
    if (!user || user.status !== "active") {
      return null;
    }
    if (user.supabaseUserId !== supabaseUserId) {
      return null;
    }
    return user;
  }

  async function requireUser(email = "") {
    const user = await readUser(email);
    if (!user) {
      const error = new Error("Vibe64 user was not found.");
      error.code = "vibe64_user_not_found";
      throw error;
    }
    return user;
  }

  async function updateGithubIdentity(input = {}, identity = {}) {
    const email = canonicalUserEmail(input.email);
    const user = await requireUser(email);
    if (user.status !== "active") {
      const error = new Error("GitHub identity can only be linked to an active Vibe64 user.");
      error.code = "vibe64_user_not_active";
      throw error;
    }
    return writeUser({
      ...user,
      github: normalizeGithubIdentity({
        ...identity,
        connectedAt: identity.connectedAt || new Date().toISOString()
      }),
      updatedAt: new Date().toISOString()
    });
  }

  async function assertTenantUserCapacity(email = "") {
    const normalizedEmail = canonicalUserEmail(email);
    const activeOrInvited = (await listUsers()).filter((user) => (
      ACTIVE_USER_STATUSES.has(user.status) &&
      user.email !== normalizedEmail
    ));
    if (activeOrInvited.length >= MAX_TENANT_USERS) {
      const error = new Error(`This tenant already has ${MAX_TENANT_USERS} active or invited users.`);
      error.code = "vibe64_tenant_user_limit_reached";
      throw error;
    }
  }

  return Object.freeze({
    acceptSupabaseIdentity,
    cancelInvite,
    inviteUser,
    listUsers,
    ownerInvitePending,
    publicUser,
    readUser,
    revokeUser,
    setupRequired,
    updateGithubIdentity,
    userForSession,
    userLimit: MAX_TENANT_USERS,
    usersRoot: root
  });
}

function canonicalSupabaseUserId(value = "") {
  const id = String(value || "").trim();
  if (!id) {
    const error = new Error("Supabase user id is missing.");
    error.code = "vibe64_invalid_supabase_user";
    throw error;
  }
  return id;
}

function canonicalUserFileStem(value = "") {
  const stem = String(value || "").trim();
  if (!stem || !SAFE_FILE_STEM_PATTERN.test(stem)) {
    const error = new Error("User file id is invalid.");
    error.code = "vibe64_invalid_user_file_id";
    throw error;
  }
  return stem;
}

function normalizeStatus(record = {}) {
  const status = String(record.status || "").trim().toLowerCase();
  if (["active", "invited", "canceled", "revoked"].includes(status)) {
    return status;
  }
  if (record.revokedAt) {
    return "revoked";
  }
  if (record.canceledAt) {
    return "canceled";
  }
  if (record.invitedAt) {
    return "invited";
  }
  return "active";
}

function normalizeUserRecord(record = {}) {
  const email = canonicalUserEmail(record.email);
  const now = new Date().toISOString();
  const status = normalizeStatus(record);
  return {
    acceptedAt: String(record.acceptedAt || (status === "active" ? record.updatedAt || record.createdAt || "" : "")),
    canceledAt: String(record.canceledAt || ""),
    createdAt: String(record.createdAt || now),
    email,
    github: normalizeGithubIdentity(record.github),
    invitedAt: String(record.invitedAt || ""),
    revokedAt: String(record.revokedAt || ""),
    role: record.role === "owner" ? "owner" : "member",
    status,
    supabaseUserId: String(record.supabaseUserId || ""),
    updatedAt: String(record.updatedAt || record.createdAt || now),
    version: USER_RECORD_VERSION
  };
}

function canonicalStoredUserRecord(filePath = "", record = {}) {
  if (!ACTIVE_USER_STATUSES.has(record.status)) {
    return null;
  }
  const stem = path.basename(filePath, ".json");
  if (record.supabaseUserId) {
    return stem === canonicalUserFileStem(record.supabaseUserId) ? record : null;
  }
  if (record.status !== "invited") {
    return null;
  }
  return stem === canonicalUserEmail(record.email) ? record : null;
}

function normalizeGithubIdentity(value = {}) {
  const login = String(value?.login || "").trim();
  if (!login) {
    return null;
  }
  return {
    avatarUrl: String(value.avatarUrl || value.avatar_url || ""),
    connectedAt: String(value.connectedAt || ""),
    id: Number.isFinite(Number(value.id)) ? Number(value.id) : null,
    login
  };
}

export {
  canonicalUserEmail,
  createFileUserStore,
  publicUser
};
