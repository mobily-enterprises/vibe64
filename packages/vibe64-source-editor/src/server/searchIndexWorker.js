import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

// Finite command, run through the execution gateway. SQLite and text processing
// stay off the HTTP event loop. WAL lets queries read while a refresh commits.
const CHUNK_LENGTH = 64 * 1024;
const QUERY_LENGTH = 240;

function openIndex(directory, readOnly = false) {
  const db = new DatabaseSync(path.join(directory, "content.sqlite"), { readOnly, timeout: 1000 });
  if (!readOnly) {
    db.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA synchronous=NORMAL;
      CREATE TABLE IF NOT EXISTS files (id INTEGER PRIMARY KEY, path TEXT UNIQUE, stamp TEXT);
      CREATE TABLE IF NOT EXISTS chunks (id INTEGER PRIMARY KEY, file_id INTEGER, line INTEGER, column INTEGER, text TEXT);
      CREATE INDEX IF NOT EXISTS chunks_file ON chunks(file_id);
      CREATE VIRTUAL TABLE IF NOT EXISTS terms USING fts5(text, content='chunks', content_rowid='id', tokenize='trigram', detail=none, columnsize=0);
      CREATE TRIGGER IF NOT EXISTS chunks_added AFTER INSERT ON chunks BEGIN
        INSERT INTO terms(rowid, text) VALUES (new.id, new.text);
      END;
      CREATE TRIGGER IF NOT EXISTS chunks_removed AFTER DELETE ON chunks BEGIN
        INSERT INTO terms(terms, rowid, text) VALUES ('delete', old.id, old.text);
      END;
    `);
  }
  return db;
}

function fileStamp(stats) {
  return `${stats.dev}:${stats.ino}:${stats.size}:${stats.mtimeNs}:${stats.ctimeNs}`;
}

async function* discoverFiles(sourceRoot, directory = "") {
  let entries;
  try {
    const absolute = path.join(sourceRoot, directory);
    if (!(await lstat(absolute)).isDirectory()) return;
    entries = await readdir(absolute, { withFileTypes: true });
  } catch (error) {
    if (["ENOENT", "ENOTDIR"].includes(error.code)) return;
    throw error;
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (entry.name === ".git" || entry.isSymbolicLink()) continue;
    const relative = directory ? `${directory}/${entry.name}` : entry.name;
    if (entry.isDirectory()) yield* discoverFiles(sourceRoot, relative);
    else if (entry.isFile()) yield relative;
  }
}

// Split at line boundaries where possible. Overlap long lines so even a
// maximum-length query crossing a chunk boundary is discoverable.
async function indexText(handle, insert, fileId) {
  let pending = "";
  let line = 1;
  let column = 1;
  function consume(end, advance) {
    insert.run(fileId, line, column, pending.slice(0, end));
    const consumed = pending.slice(0, advance);
    const lastNewline = consumed.lastIndexOf("\n");
    line += consumed.split("\n").length - 1;
    column = lastNewline < 0
      ? column + Buffer.byteLength(consumed)
      : Buffer.byteLength(consumed.slice(lastNewline + 1)) + 1;
    pending = pending.slice(advance);
  }
  for await (const text of handle.createReadStream({ encoding: "utf8", autoClose: false })) {
    if (text.includes("\0")) return false;
    pending += text;
    while (pending.length >= CHUNK_LENGTH) {
      const newline = pending.lastIndexOf("\n", CHUNK_LENGTH - 1);
      // Avoid splitting a surrogate pair in a long UTF-8 line.
      let end = newline >= 0 ? newline + 1 : CHUNK_LENGTH;
      if (newline < 0 && /[\uD800-\uDBFF]/u.test(pending[end - 1])) end -= 1;
      const advance = newline >= 0 ? end : end - QUERY_LENGTH;
      consume(end, advance);
    }
  }
  if (pending) consume(pending.length, pending.length);
  return true;
}

async function refresh({ sourceRoot, directory }) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const db = openIndex(directory);
  let previousStatus = null;
  const statusPath = path.join(directory, "status.json");
  try {
    previousStatus = JSON.parse(await readFile(statusPath, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const status = { state: "building", searchable: true, scanned: 0, total: 0, changed: 0, updatedAt: previousStatus?.updatedAt || 0 };
  let lastProgress = 0;
  const progress = async (force = false) => {
    if (force || Date.now() - lastProgress > 500) {
      lastProgress = Date.now();
      await writeFile(`${statusPath}.tmp`, JSON.stringify(status), { mode: 0o600 });
      await rename(`${statusPath}.tmp`, statusPath);
    }
  };
  try {
    const existing = new Map(db.prepare("SELECT id, path, stamp FROM files").all().map((file) => [file.path, file]));
    const paths = [];
    await progress(true);
    for await (const file of discoverFiles(sourceRoot)) {
      paths.push(file);
      status.total += 1;
      await progress();
    }
    const removeChunks = db.prepare("DELETE FROM chunks WHERE file_id = ?");
    const removeFile = db.prepare("DELETE FROM files WHERE id = ?");
    const putFile = db.prepare("INSERT INTO files(path, stamp) VALUES (?, ?) ON CONFLICT(path) DO UPDATE SET stamp=excluded.stamp RETURNING id");
    const putChunk = db.prepare("INSERT INTO chunks(file_id, line, column, text) VALUES (?, ?, ?, ?)");
    for (const relative of paths) {
      const previous = existing.get(relative);
      existing.delete(relative);
      let handle;
      try {
        const absolute = path.join(sourceRoot, relative);
        // Walk every ancestor again: a directory may have become a symlink
        // since discovery. Never index a symlink's target outside the session.
        let ancestor = sourceRoot;
        for (const part of relative.split("/").slice(0, -1)) {
          ancestor = path.join(ancestor, part);
          if (!(await lstat(ancestor)).isDirectory()) throw Object.assign(new Error("Source directory changed."), { code: "ENOENT" });
        }
        handle = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        const stats = await handle.stat({ bigint: true });
        if (!stats.isFile()) continue;
        const stamp = fileStamp(stats);
        if (previous?.stamp === stamp) continue;
        db.exec("BEGIN IMMEDIATE");
        const { id } = putFile.get(relative, stamp);
        removeChunks.run(id);
        if (!await indexText(handle, putChunk, id)) removeChunks.run(id);
        // Files being actively rewritten are retried on the next refresh.
        if (fileStamp(await handle.stat({ bigint: true })) !== stamp) {
          db.exec("ROLLBACK");
        } else {
          db.exec("COMMIT");
          status.changed += 1;
        }
      } catch (error) {
        if (db.isTransaction) db.exec("ROLLBACK");
        if (!["ENOENT", "ENOTDIR", "ELOOP"].includes(error.code)) throw error;
        if (previous) {
          db.exec("BEGIN IMMEDIATE");
          removeChunks.run(previous.id);
          removeFile.run(previous.id);
          db.exec("COMMIT");
        }
      } finally {
        await handle?.close();
        status.scanned += 1;
        await progress();
      }
    }
    db.exec("BEGIN IMMEDIATE");
    for (const file of existing.values()) {
      removeChunks.run(file.id);
      removeFile.run(file.id);
      status.changed += 1;
    }
    db.exec("COMMIT");
    status.state = "ready";
    status.updatedAt = Date.now();
    await progress(true);
    return status;
  } finally {
    if (db.isTransaction) db.exec("ROLLBACK");
    db.close();
  }
}

function search({ directory, query, limit }) {
  const db = openIndex(directory, true);
  try {
    // detail=none stores each trigram once per chunk. Exact matching below
    // validates order, punctuation and smart case without a positional index.
    const chars = [...query.toLowerCase()];
    const trigrams = new Set();
    for (let i = 0; i + 2 < chars.length; i += 1) {
      trigrams.add(chars.slice(i, i + 3).join(""));
    }
    const indexed = trigrams.size > 0 && !/[^\x20-\x7e]/u.test(query);
    const candidates = db.prepare(`SELECT c.id, f.path, c.line, c.column FROM chunks c JOIN files f ON f.id=c.file_id
      ${indexed ? "WHERE c.id IN (SELECT rowid FROM terms WHERE terms MATCH ?)" : ""} ORDER BY f.path, c.id`);
    const rows = indexed
      ? candidates.iterate([...trigrams].map((gram) => `"${gram.replaceAll('"', '""')}"`).join(" AND "))
      : candidates.iterate();
    const text = db.prepare("SELECT text FROM chunks WHERE id = ?");
    const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), /\p{Lu}/u.test(query) ? "gu" : "giu");
    const results = [];
    const seen = new Set();
    const deadline = Date.now() + 4000;
    for (const row of rows) {
      const body = text.get(row.id).text;
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(body))) {
        const prefix = body.slice(0, match.index);
        const line = row.line + prefix.split("\n").length - 1;
        const key = `${row.path}:${line}`;
        const end = body.indexOf("\n", match.index);
        pattern.lastIndex = end < 0 ? body.length : end + 1;
        if (seen.has(key)) continue;
        seen.add(key);
        if (results.length === limit) return { results, truncated: true };
        const start = prefix.lastIndexOf("\n") + 1;
        results.push({
          path: row.path,
          line,
          column: (start === 0 ? row.column : 1) + Buffer.byteLength(body.slice(start, match.index)),
          preview: body.slice(start, end < 0 ? undefined : end).replace(/\r$/u, "").slice(0, QUERY_LENGTH)
        });
      }
      if (Date.now() > deadline) return { results, truncated: true };
    }
    return { results, truncated: false };
  } finally {
    db.close();
  }
}

let request = "";
for await (const chunk of process.stdin) request += chunk;
const input = JSON.parse(request);
try {
  const result = input.operation === "refresh" ? await refresh(input) : search(input);
  process.stdout.write(JSON.stringify(result));
} catch (error) {
  process.stderr.write(String(error?.message || error));
  process.exitCode = 1;
}
