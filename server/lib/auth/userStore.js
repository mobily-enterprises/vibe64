import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";

import {
  hashPassword,
  verifyPassword
} from "./passwords.js";

const USER_RECORD_VERSION = 1;
const EMAIL_PATTERN = /^[^\s@/\\]+@[^\s@/\\]+\.[^\s@/\\]+$/u;

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
  return {
    createdAt: String(record.createdAt || ""),
    email: String(record.email || ""),
    gravatarUrl: gravatarUrl(record.email),
    invitedAt: String(record.invitedAt || ""),
    owner: record.role === "owner",
    passwordSet: Boolean(record.passwordHash),
    role: String(record.role || "member"),
    updatedAt: String(record.updatedAt || "")
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

  function userPath(email = "") {
    return path.join(root, `${canonicalUserEmail(email)}.json`);
  }

  async function readUser(email = "") {
    try {
      return normalizeUserRecord(JSON.parse(await readFile(userPath(email), "utf8")));
    } catch (error) {
      if (error?.code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  async function writeUser(record = {}) {
    await ensureRoot();
    const normalized = normalizeUserRecord(record);
    const filePath = userPath(normalized.email);
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
    await rename(tempPath, filePath);
    return normalized;
  }

  async function listUsers() {
    await ensureRoot();
    const entries = await readdir(root, {
      withFileTypes: true
    });
    const users = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) {
        continue;
      }
      const source = await readFile(path.join(root, entry.name), "utf8");
      users.push(normalizeUserRecord(JSON.parse(source)));
    }
    return users.sort((left, right) => left.email.localeCompare(right.email));
  }

  async function setupOwner(input = {}) {
    const existingUsers = await listUsers();
    if (existingUsers.length > 0) {
      const error = new Error("Owner setup has already been completed.");
      error.code = "vibe64_owner_already_exists";
      throw error;
    }
    const email = canonicalUserEmail(input.email);
    const password = matchingPassword(input);
    const now = new Date().toISOString();
    return writeUser({
      createdAt: now,
      email,
      passwordHash: await hashPassword(password),
      role: "owner",
      updatedAt: now,
      version: USER_RECORD_VERSION
    });
  }

  async function inviteUser(input = {}) {
    const email = canonicalUserEmail(input.email);
    const existing = await readUser(email);
    if (existing) {
      return existing;
    }
    const now = new Date().toISOString();
    return writeUser({
      createdAt: now,
      email,
      invitedAt: now,
      passwordHash: "",
      role: "member",
      updatedAt: now,
      version: USER_RECORD_VERSION
    });
  }

  async function claimInvite(input = {}) {
    const email = canonicalUserEmail(input.email);
    const user = await readUser(email);
    if (!user) {
      const error = new Error("Invited user was not found.");
      error.code = "vibe64_user_not_found";
      throw error;
    }
    if (user.passwordHash) {
      const error = new Error("This user already has a password.");
      error.code = "vibe64_user_password_already_set";
      throw error;
    }
    const password = matchingPassword(input);
    return writeUser({
      ...user,
      passwordHash: await hashPassword(password),
      updatedAt: new Date().toISOString()
    });
  }

  async function authenticate(input = {}) {
    const email = canonicalUserEmail(input.email);
    const user = await readUser(email);
    if (!user) {
      return {
        ok: false,
        code: "vibe64_invalid_credentials",
        message: "Email or password is incorrect."
      };
    }
    if (!user.passwordHash) {
      return {
        ok: false,
        claimRequired: true,
        code: "vibe64_user_password_not_set",
        email: user.email,
        message: "Set a password for this invited user."
      };
    }
    if (!await verifyPassword(input.password, user.passwordHash)) {
      return {
        ok: false,
        code: "vibe64_invalid_credentials",
        message: "Email or password is incorrect."
      };
    }
    return {
      ok: true,
      user
    };
  }

  async function changePassword(email = "", input = {}) {
    const user = await readUser(email);
    if (!user || !user.passwordHash) {
      const error = new Error("User password is not set.");
      error.code = "vibe64_user_password_not_set";
      throw error;
    }
    if (!await verifyPassword(input.oldPassword, user.passwordHash)) {
      const error = new Error("Old password is incorrect.");
      error.code = "vibe64_invalid_old_password";
      throw error;
    }
    const password = matchingPassword(input);
    return writeUser({
      ...user,
      passwordHash: await hashPassword(password),
      updatedAt: new Date().toISOString()
    });
  }

  return Object.freeze({
    authenticate,
    changePassword,
    claimInvite,
    inviteUser,
    listUsers,
    publicUser,
    readUser,
    setupOwner,
    usersRoot: root
  });
}

function matchingPassword(input = {}) {
  const password = String(input.password || "");
  const confirmation = String(input.passwordConfirmation || input.confirmPassword || "");
  if (password !== confirmation) {
    const error = new Error("Passwords do not match.");
    error.code = "vibe64_password_mismatch";
    throw error;
  }
  return password;
}

function normalizeUserRecord(record = {}) {
  const email = canonicalUserEmail(record.email);
  return {
    createdAt: String(record.createdAt || ""),
    email,
    invitedAt: String(record.invitedAt || ""),
    passwordHash: String(record.passwordHash || ""),
    role: record.role === "owner" ? "owner" : "member",
    updatedAt: String(record.updatedAt || ""),
    version: USER_RECORD_VERSION
  };
}

export {
  canonicalUserEmail,
  createFileUserStore,
  publicUser
};
