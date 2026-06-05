import crypto from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

function createFileSessionStore({
  sessionsRoot = "",
  ttlSeconds = DEFAULT_SESSION_TTL_SECONDS
} = {}) {
  if (!sessionsRoot) {
    throw new Error("createFileSessionStore requires sessionsRoot.");
  }
  const root = path.resolve(sessionsRoot);
  const ttl = Number.isInteger(Number(ttlSeconds)) && Number(ttlSeconds) > 0
    ? Number(ttlSeconds)
    : DEFAULT_SESSION_TTL_SECONDS;

  async function ensureRoot() {
    await mkdir(root, {
      recursive: true
    });
  }

  async function createSession(user = {}) {
    await ensureRoot();
    const id = crypto.randomUUID();
    const token = crypto.randomBytes(32).toString("base64url");
    const now = new Date();
    const record = {
      createdAt: now.toISOString(),
      email: String(user.email || ""),
      expiresAt: new Date(now.getTime() + ttl * 1000).toISOString(),
      id,
      tokenHash: tokenDigest(token),
      version: 1
    };
    await writeSession(record);
    return {
      cookieValue: `${id}.${token}`,
      expiresAt: record.expiresAt,
      id,
      maxAge: ttl
    };
  }

  async function readSession(cookieValue = "") {
    const parsed = parseSessionCookie(cookieValue);
    if (!parsed) {
      return null;
    }
    const record = await readSessionRecord(parsed.id);
    if (!record) {
      return null;
    }
    if (Date.parse(record.expiresAt) <= Date.now()) {
      await destroySession(parsed.id);
      return null;
    }
    return timingSafeEqualHex(record.tokenHash, tokenDigest(parsed.token))
      ? record
      : null;
  }

  async function destroySession(id = "") {
    await rm(sessionPath(id), {
      force: true
    });
  }

  async function writeSession(record = {}) {
    const filePath = sessionPath(record.id);
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
    await rename(tempPath, filePath);
  }

  async function readSessionRecord(id = "") {
    try {
      return JSON.parse(await readFile(sessionPath(id), "utf8"));
    } catch (error) {
      if (error?.code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  function sessionPath(id = "") {
    if (!/^[0-9a-f-]{36}$/u.test(String(id || ""))) {
      return path.join(root, "invalid-session-id");
    }
    return path.join(root, `${id}.json`);
  }

  return Object.freeze({
    createSession,
    destroySession,
    readSession,
    sessionsRoot: root,
    ttlSeconds: ttl
  });
}

function parseSessionCookie(value = "") {
  const match = /^([0-9a-f-]{36})\.([A-Za-z0-9_-]+)$/u.exec(String(value || ""));
  return match
    ? {
        id: match[1],
        token: match[2]
      }
    : null;
}

function tokenDigest(token = "") {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function timingSafeEqualHex(left = "", right = "") {
  const leftBuffer = Buffer.from(String(left || ""), "hex");
  const rightBuffer = Buffer.from(String(right || ""), "hex");
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

export {
  DEFAULT_SESSION_TTL_SECONDS,
  createFileSessionStore
};
