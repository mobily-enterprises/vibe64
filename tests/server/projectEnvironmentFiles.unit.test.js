import assert from "node:assert/strict";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  GENERATED_ENV_HEADER,
  materializeProjectEnvironmentFiles,
  projectEnvironmentFilesAreCurrent
} from "../../packages/vibe64-project/src/server/projectEnvironmentFiles.js";

async function temporarySource(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-project-env-"));
  t.after(() => rm(root, {
    force: true,
    recursive: true
  }));
  await mkdir(path.join(root, ".git", "info"), {
    recursive: true
  });
  await writeFile(path.join(root, ".git", "info", "exclude"), "# Keep local rules.\n");
  return root;
}

test("project environment files are deterministic shared-workspace Stack projections", async (t) => {
  const sourceRoot = await temporarySource(t);
  const first = await materializeProjectEnvironmentFiles({
    environment: {
      DB_PASSWORD: "secret value",
      DB_PORT: "3306"
    },
    files: [{ format: "dotenv", path: ".env" }],
    sourceRoot
  });
  const envBefore = await lstat(path.join(sourceRoot, ".env"), { bigint: true });
  const excludeBefore = await lstat(path.join(sourceRoot, ".git/info/exclude"), { bigint: true });
  assert.equal(await projectEnvironmentFilesAreCurrent({
    environment: { DB_PASSWORD: "secret value", DB_PORT: "3306" },
    files: [{ format: "dotenv", path: ".env" }],
    sourceRoot
  }), true);
  const second = await materializeProjectEnvironmentFiles({
    environment: {
      DB_PASSWORD: "secret value",
      DB_PORT: "3306"
    },
    files: [{ format: "dotenv", path: ".env" }],
    sourceRoot
  });

  assert.equal(first[0].changed, true);
  assert.equal(second[0].changed, false);
  // Unchanged projections may belong to a different member of the shared
  // workspace group. Even chmod to the same mode would fail for that writer.
  assert.equal((await lstat(path.join(sourceRoot, ".env"), { bigint: true })).ctimeNs, envBefore.ctimeNs);
  assert.equal((await lstat(path.join(sourceRoot, ".git/info/exclude"), { bigint: true })).ctimeNs, excludeBefore.ctimeNs);
  assert.equal(await readFile(path.join(sourceRoot, ".env"), "utf8"), [
    GENERATED_ENV_HEADER,
    "",
    "DB_PASSWORD=\"secret value\"",
    "DB_PORT=3306",
    ""
  ].join("\n"));
  assert.equal((await lstat(path.join(sourceRoot, ".env"))).mode & 0o777, 0o600);
  assert.equal(await readFile(path.join(sourceRoot, ".git", "info", "exclude"), "utf8"), [
    "# Keep local rules.",
    "",
    "# BEGIN Vibe64 managed environment files",
    "/.env",
    "/.env.vibe64-backup-*",
    "# END Vibe64 managed environment files",
    ""
  ].join("\n"));
  assert.equal((await lstat(path.join(sourceRoot, ".git", "info", "exclude"))).mode & 0o777, 0o600);
});

test("checking environment readiness does not create files or take ownership of user content", async (t) => {
  const sourceRoot = await temporarySource(t);
  const input = { environment: { VALUE: "current" }, files: [{ format: "dotenv", path: ".env" }], sourceRoot };
  const excludePath = path.join(sourceRoot, ".git", "info", "exclude");
  const before = await readFile(excludePath, "utf8");
  assert.equal(await projectEnvironmentFilesAreCurrent(input), false);
  await assert.rejects(() => readFile(path.join(sourceRoot, ".env")), { code: "ENOENT" });
  assert.equal(await readFile(excludePath, "utf8"), before);
  await materializeProjectEnvironmentFiles(input);
  await writeFile(path.join(sourceRoot, ".env"), "USER_CONTENT=yes\n");
  assert.equal(await projectEnvironmentFilesAreCurrent(input), false);
  assert.equal(await readFile(path.join(sourceRoot, ".env"), "utf8"), "USER_CONTENT=yes\n");
});

test("environment inspection leaves missing Git info for materialization to create", async (t) => {
  const sourceRoot = await temporarySource(t);
  const infoDirectory = path.join(sourceRoot, ".git", "info");
  await rm(infoDirectory, { recursive: true });
  const input = { environment: { VALUE: "current" }, files: [{ format: "dotenv", path: ".env" }], sourceRoot };

  assert.equal(await projectEnvironmentFilesAreCurrent(input), false);
  await assert.rejects(() => lstat(infoDirectory), { code: "ENOENT" });
  await materializeProjectEnvironmentFiles(input);
  assert.equal(await projectEnvironmentFilesAreCurrent(input), true);
});

test("project environment files preserve an unmanaged file before taking ownership", async (t) => {
  const sourceRoot = await temporarySource(t);
  await writeFile(path.join(sourceRoot, ".env"), "PERSONAL=true\n");
  const original = await lstat(path.join(sourceRoot, ".env"));

  const [result] = await materializeProjectEnvironmentFiles({
    environment: { DB_HOST: "127.0.0.1" },
    files: [{ format: "dotenv", path: ".env" }],
    now: new Date("2026-08-15T01:02:03.004Z"),
    sourceRoot
  });

  assert.equal(result.preservedPath, path.join(
    sourceRoot,
    ".env.vibe64-backup-2026-08-15T01-02-03-004Z"
  ));
  assert.equal(await readFile(result.preservedPath, "utf8"), "PERSONAL=true\n");
  const preserved = await lstat(result.preservedPath);
  assert.equal(preserved.ino, original.ino);
  assert.equal(preserved.mode, original.mode);
  assert.equal(preserved.uid, original.uid);
  assert.match(await readFile(path.join(sourceRoot, ".env"), "utf8"), /DB_HOST=127\.0\.0\.1/u);
});

test("project environment file backups never replace an earlier preserved file", async (t) => {
  const sourceRoot = await temporarySource(t);
  const now = new Date("2026-08-15T01:02:03.004Z");
  const base = path.join(sourceRoot, ".env.vibe64-backup-2026-08-15T01-02-03-004Z");
  await Promise.all([
    writeFile(path.join(sourceRoot, ".env"), "CURRENT=true\n"),
    writeFile(base, "EARLIER=true\n")
  ]);

  const [result] = await materializeProjectEnvironmentFiles({
    environment: { DB_HOST: "127.0.0.1" },
    files: [{ format: "dotenv", path: ".env" }],
    now,
    sourceRoot
  });

  assert.equal(result.preservedPath, `${base}-1`);
  assert.equal(await readFile(base, "utf8"), "EARLIER=true\n");
  assert.equal(await readFile(`${base}-1`, "utf8"), "CURRENT=true\n");
});

test("project environment files refuse a symbolic-link projection", async (t) => {
  const sourceRoot = await temporarySource(t);
  const outside = await temporarySource(t);
  await symlink(path.join(outside, "secret"), path.join(sourceRoot, ".env"));

  await assert.rejects(
    () => materializeProjectEnvironmentFiles({
      environment: { DB_PASSWORD: "secret" },
      files: [{ format: "dotenv", path: ".env" }],
      sourceRoot
    }),
    { code: "vibe64_environment_file_symlink" }
  );
});

test("project environment files refuse a symbolic-link Git exclude", async (t) => {
  const sourceRoot = await temporarySource(t);
  const outside = await temporarySource(t);
  const excludePath = path.join(sourceRoot, ".git", "info", "exclude");
  await rm(excludePath);
  await symlink(path.join(outside, "exclude"), excludePath);

  await assert.rejects(
    () => materializeProjectEnvironmentFiles({
      environment: { DB_PASSWORD: "secret" },
      files: [{ format: "dotenv", path: ".env" }],
      sourceRoot
    }),
    { code: "vibe64_environment_git_exclude_symlink" }
  );
});

for (const [operation, inspectOrWrite] of [
  ["readiness inspection", projectEnvironmentFilesAreCurrent],
  ["materialization", materializeProjectEnvironmentFiles]
]) {
  test(`environment ${operation} refuses a symbolic-link Git info directory`, async (t) => {
    const sourceRoot = await temporarySource(t);
    const outside = await temporarySource(t);
    const externalExclude = path.join(outside, "exclude");
    const original = "# This file is outside the project.\n";
    await writeFile(externalExclude, original);
    const infoDirectory = path.join(sourceRoot, ".git", "info");
    await rm(infoDirectory, { recursive: true });
    await symlink(outside, infoDirectory);

    await assert.rejects(() => inspectOrWrite({
      environment: { DB_PASSWORD: "secret" },
      files: [{ format: "dotenv", path: ".env" }],
      sourceRoot
    }), { code: "vibe64_environment_git_exclude_symlink" });
    assert.equal(await readFile(externalExclude, "utf8"), original);
    await assert.rejects(() => readFile(path.join(sourceRoot, ".env")), { code: "ENOENT" });
  });
}
