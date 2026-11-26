import assert from "node:assert/strict";
import fsPromises, { mkdtemp, rm, utimes } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createVibe64SessionStore } from "@local/vibe64-runtime/server/sessionStore";

// Every route reads its session, and each session read read every metadata value from its own file: a session with
// many values cost that many file reads on each of the many reads a page's polls make. An unchanged session's values
// are now read once.

/** Counts the files read below `root` while `operation` runs. */
async function fileReadsBelow(root, operation) {
  const readFile = fsPromises.readFile;
  let reads = 0;
  fsPromises.readFile = function countedReadFile(file, ...rest) {
    if (String(file).startsWith(root)) reads += 1;
    return readFile.call(this, file, ...rest);
  };
  syncBuiltinESMExports();
  try {
    await operation();
  } finally {
    fsPromises.readFile = readFile;
    syncBuiltinESMExports();
  }
  return reads;
}

async function sessionWithValues(t, count) {
  const systemRoot = await mkdtemp(path.join(os.tmpdir(), "vibe64-metadata-reads-"));
  t.after(() => rm(systemRoot, { recursive: true, force: true }));
  const store = createVibe64SessionStore({ projectContextRoot: systemRoot, projectRuntimeRoot: path.join(systemRoot, "projects/one") });
  await store.createSession({ sessionId: "work", runtimeKind: "genesis" });
  for (let index = 0; index < count; index += 1) await store.writeMetadataValue("work", `value_${index}`, `value ${index}`);
  const session = await store.readSession("work");
  const metadataRoot = path.join(session.sessionRoot || "", "metadata");
  return { metadataRoot, store };
}

test("reading an unchanged session again reads none of its metadata files, however many values it has", async (t) => {
  const repeated = {};
  for (const count of [5, 50]) {
    const { metadataRoot, store } = await sessionWithValues(t, count);
    // Values written a while ago, as an open session's are between its changes.
    const minuteAgo = new Date(Date.now() - 60_000);
    await utimes(metadataRoot, minuteAgo, minuteAgo);
    const first = await store.readSession("work");
    assert.equal(first.metadata[`value_${count - 1}`], `value ${count - 1}`);
    repeated[count] = await fileReadsBelow(metadataRoot, async () => {
      for (let read = 0; read < 4; read += 1) {
        const session = await store.readSession("work");
        assert.equal(session.metadata.value_0, "value 0");
        session.metadata.value_0 = "changed by a caller";
      }
    });
    // A value written meanwhile is read at once.
    await store.writeMetadataValue("work", "value_0", "rewritten");
    assert.equal((await store.readSession("work")).metadata.value_0, "rewritten");
    await store.writeMetadataValue("work", "late", "added");
    assert.equal((await store.readSession("work")).metadata.late, "added");
  }
  assert.equal(repeated[50], repeated[5], `metadata files read by 4 more reads: ${JSON.stringify(repeated)}`);
});

test("each writer of a session's metadata replaces or removes its file, so the next read sees what it wrote", async (t) => {
  // A session read reuses its values while the metadata folder is unchanged, which holds only while every writer
  // publishes by rename or removal. A writer that wrote a value in place would leave this read stale.
  const { metadataRoot, store } = await sessionWithValues(t, 3);
  const renewalId = "metadata-reads-renewal";
  const writers = [
    ["writeMetadataValue", () => store.writeMetadataValue("work", "value_0", "by writeMetadataValue"),
      (metadata) => metadata.value_0 === "by writeMetadataValue"],
    ["writeMetadataValueForRenewal", () => store.writeMetadataValueForRenewal("work", "value_1", "for renewal"),
      (metadata) => metadata.value_1 === "for renewal"],
    ["writeSessionLabel", () => store.writeSessionLabel("work", "Renamed work"),
      (metadata) => Object.values(metadata).includes("Renamed work")],
    ["deleteMetadataValue", () => store.deleteMetadataValue("work", "value_2"),
      (metadata) => !("value_2" in metadata)],
    ["deleteMetadataValues", () => store.deleteMetadataValues("work", ["value_1"]),
      (metadata) => !("value_1" in metadata)],
    ["quiesceSessionForRenewal", () => store.quiesceSessionForRenewal({ renewalId, sourceSessionId: "work" }),
      (metadata) => metadata.renewal_quiesced_id === renewalId],
    ["restoreSessionAfterRenewalCancellation",
      () => store.restoreSessionAfterRenewalCancellation({ renewalId, sourceSessionId: "work" }),
      (metadata) => !("renewal_quiesced_id" in metadata) && metadata.renewal_restored_id === renewalId]
  ];
  for (const [name, write, wrote] of writers) {
    const minuteAgo = new Date(Date.now() - 60_000);
    await utimes(metadataRoot, minuteAgo, minuteAgo);
    await store.readMetadata("work");
    assert.equal(await fileReadsBelow(metadataRoot, () => store.readMetadata("work")), 0, `${name}: the read before it was reused`);
    await write();
    const metadata = await store.readMetadata("work");
    assert.ok(wrote(metadata), `${name}: ${JSON.stringify(metadata)}`);
  }
});
