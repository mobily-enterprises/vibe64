import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const hash = value => createHash('sha256').update(String(value)).digest('hex');
const MAX_RECORD_BYTES = 24_000;
const MAX_FILE_RECORDS = 512;

function directory(context, filePath) {
  if (!context.runtime?.stateRoot) throw new Error('Source interpretations require the project runtime state root.');
  const scope = hash(JSON.stringify([context.sourceRoot, context.sessionId, context.agentAccountIdentity || 'local']));
  return path.join(context.runtime.stateRoot, 'source-editor', 'interpretations', scope, hash(filePath));
}

function recordPath(context, range) {
  return path.join(directory(context, range.path), `${hash(JSON.stringify([range.scope, range.symbolId || '', range.presentation]))}.json`);
}

async function readRecord(filePath) {
  let handle;
  try {
    handle = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    if ((await handle.stat()).size > MAX_RECORD_BYTES) throw new Error('Saved source interpretation exceeds its supported size.');
    const record = JSON.parse(await handle.readFile('utf8'));
    if (record.schemaVersion !== 1 || typeof record.body !== 'string' || !record.body.trim() || record.body.length > 5000
      || typeof record.summary !== 'string' || record.summary.length > 280 || !/^[a-f0-9]{64}$/.test(record.fileHash || '')
      || !/^[a-f0-9]{64}$/.test(record.cacheIdentity || '') || typeof record.promptVersion !== 'string'
      || !['description', 'steps'].includes(record.presentation) || !['file', 'selection'].includes(record.scope)
      || typeof record.path !== 'string' || typeof record.symbolId !== 'string') {
      throw new Error('Saved source interpretation is invalid. Regenerate it with the Helper.');
    }
    return record;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  } finally {
    await handle?.close();
  }
}

export async function readSourceInterpretation(context, input, cacheKey) {
  const record = await readRecord(recordPath(context, input.range));
  return record?.cacheIdentity === hash(cacheKey) && record.fileHash === input.range.fileHash && record.promptVersion === input.promptVersion
    ? { body: record.body, summary: record.summary, title: record.title, executionProfile: record.executionProfile, model: record.model } : null;
}

export async function writeSourceInterpretation(context, input, cacheKey, template, isCurrent) {
  const filePath = recordPath(context, input.range);
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  const record = { schemaVersion: 1, ...template, path: input.range.path, scope: input.range.scope,
    symbolId: input.range.symbolId || '', presentation: input.range.presentation, fileHash: input.range.fileHash,
    promptVersion: input.promptVersion, cacheIdentity: hash(cacheKey), createdAt: new Date().toISOString() };
  try {
    await writeFile(temporaryPath, JSON.stringify(record), { flag: 'wx', mode: 0o600 });
    if (await isCurrent()) await rename(temporaryPath, filePath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

export async function readSourceInterpretations(context, file, promptVersion) {
  const records = [];
  const warnings = [];
  try {
    const entries = (await readdir(directory(context, file.path))).filter(name => /^[a-f0-9]{64}\.json$/.test(name));
    if (entries.length > MAX_FILE_RECORDS) warnings.push('Only the first 512 saved interpretations are shown.');
    // Bounded reads; no index, source discovery, Helper or write on this path.
    for (let offset = 0; offset < Math.min(entries.length, MAX_FILE_RECORDS); offset += 16) {
      const batch = await Promise.allSettled(entries.slice(offset, Math.min(offset + 16, MAX_FILE_RECORDS)).map(name => readRecord(path.join(directory(context, file.path), name))));
      for (const result of batch) {
        if (result.status === 'rejected') { warnings.push('A saved pseudocode record could not be read. Regenerate it with the Helper.'); continue; }
        const record = result.value;
        if (!record || record.path !== file.path || record.presentation !== 'steps' || record.scope !== 'selection' || !record.symbolId) continue;
        records.push({ path: record.path, scope: record.scope, symbolId: record.symbolId, presentation: record.presentation,
          fileHash: record.fileHash, body: record.body, summary: record.summary, createdAt: record.createdAt,
          status: record.fileHash === file.hash && record.promptVersion === promptVersion(record.presentation) ? 'current' : 'stale' });
      }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') warnings.push('Saved pseudocode is unavailable. Regenerate it with the Helper.');
  }
  return { records, warning: [...new Set(warnings)].join(' ') };
}
