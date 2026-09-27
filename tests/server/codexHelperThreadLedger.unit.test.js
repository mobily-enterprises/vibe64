import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  CODEX_HELPER_THREAD_LEDGER_SCHEMA_VERSION,
  CODEX_HELPER_THREAD_LIFECYCLES,
  codexHelperThreadRecordId,
  createCodexHelperThreadLedger,
  defineCodexHelperThreadRecord
} from "../../packages/vibe64-terminals/src/server/codexHelperThreadLedger.js";
import {
  VIBE64_AGENT_EXECUTION_PROFILE_IDS,
  VIBE64_AGENT_EXECUTION_WORKLOAD_IDS,
  defineVibe64AgentExecutionProfileResolution,
  vibe64AgentExecutionProfileAuditSnapshot
} from "../../packages/vibe64-runtime/src/shared/agentExecutionProfiles.js";

function helperProfile() {
  return vibe64AgentExecutionProfileAuditSnapshot(
    defineVibe64AgentExecutionProfileResolution({
      limits: {
        maxInputCharacters: 100_000,
        maxOutputCharacters: 32_000,
        timeoutMs: 180_000
      },
      model: "gpt-5.6-luna",
      policy: {
        environmentAccess: false,
        networkAccess: false,
        repositoryWrite: false,
        tools: "none"
      },
      profileId: VIBE64_AGENT_EXECUTION_PROFILE_IDS.HELPER,
      providerId: "codex",
      request: {
        allowProviderModelFallback: false,
        reasoning: true,
        summary: false
      },
      revision: "codex-helper-luna-low-v2",
      thinking: "low",
      workloadId: VIBE64_AGENT_EXECUTION_WORKLOAD_IDS.SOURCE_EXPLANATION
    })
  );
}

function ownershipRecord(root, overrides = {}) {
  const now = new Date().toISOString();
  return defineCodexHelperThreadRecord({
    createdAt: now,
    executionProfile: helperProfile(),
    identity: {
      providerId: "codex",
      providerKeyFingerprint: `sha256:${"c".repeat(64)}`,
      runtime: {
        accountIdentitySignature: `sha256:${"a".repeat(64)}`,
        authStateSignature: `v1:${"b".repeat(24)}`,
        endpoint: `unix://${path.join(root, "codex.sock")}`,
        executionMode: "interactive",
        executionContextHash: "c".repeat(12),
        provider: "codex_app_server",
        runtimeDir: path.join(root, "codex-runtime"),
        runtimesHash: "d".repeat(12),
        terminalEnvHash: "e".repeat(12),
        toolHomeSource: "",
        transport: "unix"
      },
      server: {
        userAgent: "vibe64/0.149.0 (ledger unit test)"
      },
      transportId: "codex_app_server"
    },
    lifecycle: CODEX_HELPER_THREAD_LIFECYCLES.READY,
    ownershipId: "ownership-1",
    projectContextRoot: path.join(root, "authority"),
    projectRuntimeRoot: root,
    revision: 1,
    schemaVersion: CODEX_HELPER_THREAD_LEDGER_SCHEMA_VERSION,
    sessionId: "session-1",
    threadId: "thread-1",
    turnId: "",
    updatedAt: now,
    workdir: path.join(root, "sessions", "active", "session-1", "source"),
    ...overrides
  });
}

async function withLedger(operation) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-helper-ledger-"));
  try {
    await operation({
      ledger: createCodexHelperThreadLedger({ projectRuntimeRoot: root }),
      root
    });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function isolatedLedgerModule(label = "ledger") {
  const moduleUrl = new URL(
    "../../packages/vibe64-terminals/src/server/codexHelperThreadLedger.js",
    import.meta.url
  );
  moduleUrl.searchParams.set("test-instance", `${label}-${crypto.randomUUID()}`);
  return import(moduleUrl.href);
}

test("helper ownership ledger round-trips and enforces revision CAS", async () => {
  await withLedger(async ({ ledger, root }) => {
    const first = ownershipRecord(root);
    await assert.rejects(
      ledger.write(ownershipRecord(root, { revision: 2 })),
      /must start at revision 1/u
    );
    assert.deepEqual(await ledger.write(first), first);
    assert.deepEqual(await ledger.readAll(), {
      failures: [],
      records: [first]
    });

    const second = ownershipRecord(root, {
      createdAt: first.createdAt,
      ownershipId: first.ownershipId,
      revision: 2,
      updatedAt: new Date(Date.parse(first.updatedAt) + 1).toISOString()
    });
    await assert.rejects(
      ledger.write(ownershipRecord(root, {
        createdAt: first.createdAt,
        ownershipId: first.ownershipId,
        revision: 3,
        updatedAt: second.updatedAt
      }), { expected: first }),
      (error) => error.code === "vibe64_codex_helper_ledger_conflict"
    );
    await assert.rejects(
      ledger.write(ownershipRecord(root, {
        createdAt: first.createdAt,
        identity: {
          ...first.identity,
          providerKeyFingerprint: `sha256:${"d".repeat(64)}`
        },
        ownershipId: first.ownershipId,
        revision: 2,
        updatedAt: second.updatedAt
      }), { expected: first }),
      (error) => error.code === "vibe64_codex_helper_ledger_conflict"
    );
    assert.deepEqual(await ledger.write(second, { expected: first }), second);
    await assert.rejects(
      ledger.write(ownershipRecord(root, {
        createdAt: first.createdAt,
        ownershipId: first.ownershipId,
        revision: 3,
        updatedAt: new Date(Date.parse(first.updatedAt) + 2).toISOString()
      }), { expected: first }),
      (error) => error.code === "vibe64_codex_helper_ledger_conflict"
    );
    await assert.rejects(
      ledger.remove(first),
      (error) => error.code === "vibe64_codex_helper_ledger_conflict"
    );
    assert.equal(await ledger.remove(second), true);
    await assert.rejects(
      ledger.remove(second),
      (error) => error.code === "vibe64_codex_helper_ledger_conflict"
    );
  });
});

test("helper ownership ledger serializes competing creates and updates", async () => {
  await withLedger(async ({ ledger, root }) => {
    const otherLedger = createCodexHelperThreadLedger({ projectRuntimeRoot: root });
    const first = ownershipRecord(root);
    const competing = ownershipRecord(root, { ownershipId: "ownership-2" });
    const creates = await Promise.allSettled([
      ledger.write(first),
      otherLedger.write(competing)
    ]);
    assert.equal(creates.filter(({ status }) => status === "fulfilled").length, 1);
    assert.equal(creates.filter(({ status }) => status === "rejected").length, 1);
    assert.equal(
      creates.find(({ status }) => status === "rejected").reason.code,
      "vibe64_codex_helper_ledger_conflict"
    );

    const current = (await ledger.readAll()).records[0];
    const update = (suffix) => ownershipRecord(root, {
      createdAt: current.createdAt,
      lifecycle: CODEX_HELPER_THREAD_LIFECYCLES.ACTIVE,
      ownershipId: current.ownershipId,
      revision: 2,
      turnId: `turn-${suffix}`,
      updatedAt: new Date(Date.parse(current.updatedAt) + Number(suffix)).toISOString()
    });
    const updates = await Promise.allSettled([
      ledger.write(update(1), { expected: current }),
      otherLedger.write(update(2), { expected: current })
    ]);
    assert.equal(updates.filter(({ status }) => status === "fulfilled").length, 1);
    assert.equal(updates.filter(({ status }) => status === "rejected").length, 1);
    assert.equal(
      updates.find(({ status }) => status === "rejected").reason.code,
      "vibe64_codex_helper_ledger_conflict"
    );
  });
});

test("helper ownership ledger never overwrites or removes mismatched durable state", async () => {
  await withLedger(async ({ ledger, root }) => {
    const first = ownershipRecord(root);
    await ledger.write(first);
    const filePath = path.join(ledger.root, `${codexHelperThreadRecordId(first)}.json`);
    const tampered = {
      ...first,
      lifecycle: CODEX_HELPER_THREAD_LIFECYCLES.CLEANUP_REQUIRED
    };
    await writeFile(filePath, `${JSON.stringify(tampered, null, 2)}\n`, "utf8");
    const second = ownershipRecord(root, {
      createdAt: first.createdAt,
      ownershipId: first.ownershipId,
      revision: 2,
      updatedAt: new Date(Date.parse(first.updatedAt) + 1).toISOString()
    });

    await assert.rejects(
      ledger.write(second, { expected: first }),
      (error) => error.code === "vibe64_codex_helper_ledger_conflict"
    );
    await assert.rejects(
      ledger.remove(first),
      (error) => error.code === "vibe64_codex_helper_ledger_conflict"
    );
    assert.deepEqual(JSON.parse(await readFile(filePath, "utf8")), tampered);
  });
});

test("helper ownership ledger recovers a lock left by a dead process", async () => {
  await withLedger(async ({ ledger, root }) => {
    const record = ownershipRecord(root);
    const locksRoot = path.join(ledger.root, ".locks");
    const lockPath = path.join(locksRoot, "ledger.lock");
    await mkdir(locksRoot, { recursive: true });
    await writeFile(lockPath, `${JSON.stringify({
      createdAt: new Date().toISOString(),
      pid: 2_147_483_647,
      processId: "dead-process",
      token: "dead-lock"
    })}\n`);

    assert.deepEqual(await ledger.write(record), record);
    assert.deepEqual(await readdir(locksRoot), []);
  });
});

test("helper ownership ledger serializes stale-lock recovery across module instances", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-helper-ledger-race-"));
  const staleVerified = deferred();
  const releaseStaleRecovery = deferred();
  const contenderBlocked = deferred();
  let contenderAcquired = false;
  let firstWrite = null;
  let secondWrite = null;
  try {
    const [firstModule, secondModule] = await Promise.all([
      isolatedLedgerModule("stale-recovery-a"),
      isolatedLedgerModule("stale-recovery-b")
    ]);
    const firstLedger = firstModule.createCodexHelperThreadLedger({
      observeLock: async ({ stage }) => {
        if (stage === "stale-verified") {
          staleVerified.resolve();
          await releaseStaleRecovery.promise;
        }
      },
      projectRuntimeRoot: root
    });
    const secondLedger = secondModule.createCodexHelperThreadLedger({
      observeLock: ({ stage }) => {
        if (stage === "host-acquired") {
          contenderAcquired = true;
        }
        if (stage === "host-contended") {
          contenderBlocked.resolve();
        }
      },
      projectRuntimeRoot: root
    });
    const locksRoot = path.join(firstLedger.root, ".locks");
    const lockPath = path.join(locksRoot, "ledger.lock");
    await mkdir(locksRoot, { recursive: true });
    await writeFile(lockPath, `${JSON.stringify({
      createdAt: new Date().toISOString(),
      pid: 2_147_483_647,
      processId: "dead-process",
      token: "dead-lock"
    })}\n`);

    const record = ownershipRecord(root);
    firstWrite = firstLedger.write(record);
    let staleTimeout;
    try {
      await Promise.race([
        staleVerified.promise,
        new Promise((_, reject) => {
          staleTimeout = setTimeout(
            () => reject(new Error("First ledger did not reach stale-lock verification.")),
            1000
          );
        }),
        firstWrite.then(
          () => Promise.reject(new Error("First ledger completed before stale-lock verification.")),
          (error) => Promise.reject(error)
        )
      ]);
    } finally {
      clearTimeout(staleTimeout);
    }
    secondWrite = secondLedger.write(record);
    let contentionTimeout;
    try {
      await Promise.race([
        contenderBlocked.promise,
        new Promise((_, reject) => {
          contentionTimeout = setTimeout(
            () => reject(new Error("Competing ledger did not reach the host lock.")),
            1000
          );
        })
      ]);
    } finally {
      clearTimeout(contentionTimeout);
    }
    assert.equal(contenderAcquired, false);

    releaseStaleRecovery.resolve();
    assert.deepEqual(await firstWrite, record);
    await assert.rejects(
      secondWrite,
      (error) => error.code === "vibe64_codex_helper_ledger_conflict"
    );
    assert.equal(contenderAcquired, true);
    assert.deepEqual(await readdir(locksRoot), []);
    assert.equal((await readdir(root)).includes("3"), false);
  } finally {
    releaseStaleRecovery.resolve();
    await Promise.allSettled([firstWrite, secondWrite].filter(Boolean));
    await rm(root, { force: true, recursive: true });
  }
});

test("helper ownership ledger preserves malformed and oversized state as blockers", async () => {
  await withLedger(async ({ ledger, root }) => {
    const record = ownershipRecord(root);
    await ledger.write(record);
    const recordPath = path.join(ledger.root, `${codexHelperThreadRecordId(record)}.json`);
    await writeFile(recordPath, "x".repeat((64 * 1024) + 1));

    const listed = await ledger.readAll();
    assert.equal(listed.records.length, 0);
    assert.equal(listed.failures.length, 1);
    assert.match(listed.failures[0].error, /exceeds 65536 bytes/u);
    assert.equal((await readFile(recordPath, "utf8")).length, (64 * 1024) + 1);

    const lockPath = path.join(
      ledger.root,
      ".locks",
      "ledger.lock"
    );
    await writeFile(lockPath, "not-json");
    await assert.rejects(
      ledger.write(ownershipRecord(root, { ownershipId: "ownership-2" })),
      /lock cannot be verified/u
    );
    assert.equal(await readFile(lockPath, "utf8"), "not-json");
  });
});

test("helper ownership records reject relative, non-normalized, and unbounded identity", async () => {
  await withLedger(async ({ root }) => {
    const valid = ownershipRecord(root);
    assert.throws(
      () => defineCodexHelperThreadRecord({ ...valid, workdir: "relative/source" }),
      /normalized absolute path/u
    );
    assert.throws(
      () => defineCodexHelperThreadRecord({
        ...valid,
        projectContextRoot: `${root}/authority/../authority`
      }),
      /normalized absolute path/u
    );
    assert.throws(
      () => defineCodexHelperThreadRecord({
        ...valid,
        identity: {
          ...valid.identity,
          runtime: {
            ...valid.identity.runtime,
            endpoint: "x".repeat(8193)
          }
        }
      }),
      /exceeds 8192 characters/u
    );
    assert.throws(
      () => defineCodexHelperThreadRecord({
        ...valid,
        identity: {
          ...valid.identity,
          providerKeyFingerprint: "not-a-fingerprint"
        }
      }),
      /must be a SHA-256 signature/u
    );
    assert.throws(
      () => defineCodexHelperThreadRecord({
        ...valid,
        identity: {
          ...valid.identity,
          runtime: {
            ...valid.identity.runtime,
            executionMode: "unsupported"
          }
        }
      }),
      /managed Codex app-server/u
    );
    assert.throws(
      () => defineCodexHelperThreadRecord({
        ...valid,
        identity: {
          ...valid.identity,
          runtime: {
            ...valid.identity.runtime,
            authStateSignature: "credential-shaped-state"
          }
        }
      }),
      /versioned state signature/u
    );
    assert.throws(
      () => defineCodexHelperThreadRecord({
        ...valid,
        identity: {
          ...valid.identity,
          runtime: {
            ...valid.identity.runtime,
            endpoint: "https://example.invalid/codex"
          }
        }
      }),
      /managed Codex app-server/u
    );
    assert.doesNotThrow(
      () => defineCodexHelperThreadRecord({
        ...valid,
        identity: {
          ...valid.identity,
          runtime: {
            ...valid.identity.runtime,
            toolHomeSource: path.join(root, "credential-home")
          }
        }
      })
    );
    assert.throws(
      () => defineCodexHelperThreadRecord({
        ...valid,
        updatedAt: new Date(Date.parse(valid.createdAt) - 1000).toISOString()
      }),
      /cannot precede createdAt/u
    );
  });
});

test("helper ownership ledger bounds record inventory before parsing it", async () => {
  await withLedger(async ({ ledger, root }) => {
    await mkdir(ledger.root, { recursive: true });
    await Promise.all(Array.from({ length: 1024 }, (_, index) => {
      return writeFile(path.join(ledger.root, `${String(index).padStart(4, "0")}.json`), "{}");
    }));
    await assert.rejects(
      ledger.write(ownershipRecord(root)),
      /cannot exceed 1024 records/u
    );
    await writeFile(path.join(ledger.root, "overflow.json"), "{}");
    const listed = await ledger.readAll();
    assert.equal(listed.records.length, 0);
    assert.equal(listed.failures.length, 1);
    assert.match(listed.failures[0].error, /exceeds 1024 records/u);
  });
});
