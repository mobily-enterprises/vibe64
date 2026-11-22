import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import {
  inspectConnectedAdapters,
  restoreDisconnected,
  runConnectedAdapterStep,
  sessionTrees
} from "../../packages/vibe64-project/src/server/connectedAdapters/index.js";
import { pipAdapter } from "../../packages/vibe64-project/src/server/connectedAdapters/pip.js";
import { writeManagedGitExcludes } from "../../packages/vibe64-project/src/server/projectEnvironmentFiles.js";

// Vibe64's pip treatment with a stand-in for Python and pip (real Git): what it asks the toolchain,
// what it leaves in the session, and why its proof refuses. The real toolchain runs in
// examples/connected-development/pip/prove.sh (vibe64ConnectedAdapterProofs).
const exec = promisify(execFile);
const repository = "https://github.com/example/library";
const SITE = path.join(".venv", "lib", "python3.12", "site-packages");
const PIN_NOTE = "# Vibe64: the connected checkout takes the place of this pin:";

async function git(cwd, ...args) {
  return exec("git", args, { cwd });
}

/** A session whose source requires acme-library and whose connected copy holds it (at `version`). */
async function fixture(t, { requirements = "acme-library>=1.0,<2\n", version = "1.0.0" } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "vibe64-connected-pip-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, "session", "source");
  await mkdir(source, { recursive: true });
  await writeFile(path.join(source, "requirements.txt"), requirements);
  await writeFile(path.join(source, "app.py"), "import acme_library\n");
  await git(source, "init", "-q", "--initial-branch=main");
  await git(source, "add", "--all");
  await git(source, "-c", "user.name=t", "-c", "user.email=t@e", "commit", "-qm", "app");
  const copy = path.join(root, "session", "connected", "library");
  await mkdir(path.join(copy, "src", "acme_library"), { recursive: true });
  await writeFile(path.join(copy, "pyproject.toml"), `[project]\nname = "acme-library" # the distribution\nversion = "${version}"\n`);
  return {
    source,
    copy: await realpath(copy),
    repositories: [{ name: "Library", repository, relationship: "dependency", type: "pip", sourceRoot: copy }]
  };
}

/**
 * Python and pip as the adapter sees them: a venv, editable installs, the probe, pip check, and
 * `pip download`, which finds the `published` versions (or no index at all when `reachable` is false).
 */
function toolchain({
  calls = [],
  probe = () => ({ ok: true, stdout: "acme-library imports acme_library\n", stderr: "" }),
  published = ["1.0.0"],
  reachable = true
} = {}) {
  return async ({ command, args, cwd }) => {
    const shown = path.isAbsolute(command) ? path.relative(cwd, command) : command;
    calls.push([shown, ...args]);
    if (command === "git") {
      try {
        const { stdout, stderr } = await exec(command, args, { cwd });
        return { ok: true, stdout, stderr };
      } catch (error) {
        return { ok: false, stdout: String(error.stdout || ""), stderr: String(error.stderr || "") };
      }
    }
    if (command === "python3" && args.join(" ") === "-m venv .venv") {
      await mkdir(path.join(cwd, ".venv", "bin"), { recursive: true });
      await writeFile(path.join(cwd, ".venv", "bin", "python"), "");
      await mkdir(path.join(cwd, SITE), { recursive: true });
      return { ok: true, stdout: "", stderr: "" };
    }
    if (shown === ".venv/bin/python" && args.slice(0, 3).join(" ") === "-m pip install") {
      for (const [index, arg] of args.entries()) {
        if (arg !== "-e") continue;
        const info = path.join(cwd, SITE, "acme_library-1.0.0.dist-info");
        await mkdir(info, { recursive: true });
        await writeFile(path.join(info, "METADATA"), "Metadata-Version: 2.1\nName: acme-library\nVersion: 1.0.0\n");
        await writeFile(path.join(info, "direct_url.json"), JSON.stringify({ url: pathToFileURL(args[index + 1]).href, dir_info: { editable: true } }));
      }
      return { ok: true, stdout: "", stderr: "" };
    }
    if (shown === ".venv/bin/python" && args[0] === "-c") return probe(args);
    if (shown === ".venv/bin/python" && args.slice(0, 3).join(" ") === "-m pip check") {
      return { ok: true, stdout: "No broken requirements found.\n", stderr: "" };
    }
    if (shown === ".venv/bin/python" && args.slice(0, 3).join(" ") === "-m pip download") {
      const wanted = args.at(-1);
      const notFound = `ERROR: Could not find a version that satisfies the requirement ${wanted} (from versions: ${published.join(", ")})\n` +
        `ERROR: No matching distribution found for ${wanted}\n`;
      if (!reachable) {
        return {
          ok: false,
          stdout: "",
          stderr: "WARNING: Retrying (Retry(total=4, connect=None, read=None, redirect=None, status=None)) after connection broken by " +
            "'NewConnectionError(\"Failed to establish a new connection: [Errno 101] Network is unreachable\")': /simple/acme-library/\n" + notFound
        };
      }
      return published.includes(wanted.split("==")[1]) ? { ok: true, stdout: "", stderr: "" } : { ok: false, stdout: "", stderr: notFound };
    }
    return { ok: false, stdout: "", stderr: `unexpected ${shown} ${args.join(" ")}` };
  };
}

function step(f, action, runCommand) {
  return runConnectedAdapterStep({ action, repository, repositories: f.repositories, sessionSourceRoot: f.source, runCommand });
}

async function status(f) {
  const [entry] = await inspectConnectedAdapters({ repositories: f.repositories, sessionSourceRoot: f.source });
  return entry;
}

test("pip: apply installs the checkout editable in .venv with the tracked requirements in one resolution and keeps .venv out of Git", async t => {
  const f = await fixture(t);
  const calls = [];
  const runCommand = toolchain({ calls });
  const applied = await step(f, "apply", runCommand);
  assert.equal(applied.ok, true, applied.error);
  assert.equal(applied.output, [
    "[Connected] Created the session's virtual environment .venv.",
    `[Connected] Library: acme-library installed editable from ${f.copy} in .venv.`
  ].join("\n"));
  const install = [".venv/bin/python", "-m", "pip", "install", "--quiet", "--disable-pip-version-check", "-r", "requirements.connected.txt", "-e", f.copy];
  assert.deepEqual(calls.filter(([command]) => command !== "git"), [["python3", "-m", "venv", ".venv"], install]);
  // No exact pin of the connected distribution: the derived requirements are the tracked ones.
  assert.equal(await readFile(path.join(f.source, "requirements.connected.txt"), "utf8"), "acme-library>=1.0,<2\n");
  assert.match(await readFile(path.join(f.source, ".git", "info", "exclude"), "utf8"),
    /# BEGIN Vibe64 managed connected pip packages files\n(?:.*\n)*\/\.venv\n(?:.*\n)*\/requirements\.connected\.txt\n(?:.*\n)*# END/u);
  assert.equal((await git(f.source, "status", "--porcelain", "--untracked-files=all")).stdout, "");

  // Idempotent: the environment is kept, the one resolution runs again.
  calls.length = 0;
  assert.equal((await step(f, "apply", runCommand)).ok, true);
  assert.deepEqual(calls.filter(([command]) => command !== "git"), [install]);

  calls.length = 0;
  const proved = await step(f, "proof", runCommand);
  assert.deepEqual(proved, { ok: true, output: "[Connected] Library is in effect." });
  assert.equal(calls[0][0], ".venv/bin/python");
  assert.deepEqual(calls[0].slice(-2), ["acme-library", f.copy]);
  assert.deepEqual(calls[1], [".venv/bin/python", "-m", "pip", "check", "--disable-pip-version-check"]);
  assert.deepEqual(await status(f), {
    name: "Library",
    repository,
    type: "pip",
    sourceRoot: f.repositories[0].sourceRoot,
    inEffect: true,
    reason: ""
  });
});

test("pip: a tracked .venv is refused before anything is installed", async t => {
  const f = await fixture(t);
  await mkdir(path.join(f.source, ".venv"));
  await writeFile(path.join(f.source, ".venv", "pyvenv.cfg"), "home = /usr/bin\n");
  await git(f.source, "add", "--all");
  await git(f.source, "-c", "user.name=t", "-c", "user.email=t@e", "commit", "-qm", "venv");
  const calls = [];
  const applied = await step(f, "apply", toolchain({ calls }));
  assert.equal(applied.ok, false);
  assert.equal(applied.code, "vibe64_connected_derived_tracked");
  assert.match(applied.error, /tracks \.venv\/pyvenv\.cfg in Git/u);
  assert.deepEqual(calls.filter(([command]) => command !== "git"), []);
});

test("pip: the proof says exactly why the checkout is not in effect", async t => {
  const f = await fixture(t);
  const notInEffect = async (reason, runCommand = toolchain()) => {
    assert.deepEqual(await step(f, "proof", runCommand), { ok: false, error: `Connected Library is not in effect: ${reason}` });
  };
  await notInEffect(`the session has no .venv yet; prepare the workspace to install acme-library from ${f.copy}.`);
  assert.equal((await step(f, "apply", toolchain())).ok, true);
  const info = path.join(f.source, SITE, "acme_library-1.0.0.dist-info");
  const directUrl = await readFile(path.join(info, "direct_url.json"), "utf8");

  // The published distribution in place of the editable one.
  await rm(path.join(info, "direct_url.json"));
  await notInEffect(`.venv holds acme-library 1.0.0, not an editable install of ${f.copy}; prepare the workspace again.`);
  assert.equal((await status(f)).inEffect, false);

  // An editable install of another checkout.
  await writeFile(path.join(info, "direct_url.json"), JSON.stringify({ url: "file:///elsewhere/library", dir_info: { editable: true } }));
  await notInEffect(`acme-library in .venv is installed from /elsewhere/library, not this session's copy ${f.copy}; prepare the workspace again.`);

  // The files say so, but Python loads the module from somewhere else.
  await writeFile(path.join(info, "direct_url.json"), directUrl);
  assert.equal((await status(f)).inEffect, true);
  await notInEffect(
    `.venv's Python does not load acme-library from ${f.copy}: acme_library imports from /elsewhere/acme_library/__init__.py, not ${f.copy}`,
    toolchain({ probe: () => ({ ok: false, stdout: "", stderr: `acme_library imports from /elsewhere/acme_library/__init__.py, not ${f.copy}\n` }) })
  );

  await rm(info, { recursive: true });
  await notInEffect(`acme-library is not installed in .venv; prepare the workspace to install it from ${f.copy}.`);
});

test("pip: once a connection is gone, preparation removes the derived requirements and names its editable install", async t => {
  const f = await fixture(t);
  assert.deepEqual(await restoreDisconnected({ repositories: [], sessionSourceRoot: f.source }), []);
  assert.equal((await step(f, "apply", toolchain())).ok, true);
  assert.deepEqual(await restoreDisconnected({ repositories: f.repositories, sessionSourceRoot: f.source }), []);
  assert.deepEqual(await restoreDisconnected({ repositories: [], sessionSourceRoot: f.source }), [
    "[Connected] No pip connection remains: removed requirements.connected.txt.",
    `[Connected] .venv still has acme-library installed editable from ${f.copy}, which is no longer connected. ` +
    "Run `.venv/bin/python -m pip install --force-reinstall acme-library` (or remove .venv and prepare the workspace) for the published package."
  ]);
  assert.equal(await readFile(path.join(f.source, "requirements.connected.txt"), "utf8").catch(() => null), null);
});

test("pip: an exact pin of the connected distribution makes way for a checkout past it, and the derived file follows requirements.txt", async t => {
  const tracked = "acme-library==1.0.0  # pinned\nrequests==2.31.0 ; python_version > \"3.8\"\n";
  const f = await fixture(t, { requirements: tracked, version: "1.1.0" });
  assert.equal((await step(f, "apply", toolchain())).ok, true);
  assert.equal(
    await readFile(path.join(f.source, "requirements.connected.txt"), "utf8"),
    `${PIN_NOTE} acme-library==1.0.0  # pinned\nrequests==2.31.0 ; python_version > "3.8"\n`
  );
  assert.deepEqual(await step(f, "proof", toolchain()), { ok: true, output: "[Connected] Library is in effect." });
  assert.equal(await readFile(path.join(f.source, "requirements.txt"), "utf8"), tracked);

  await writeFile(path.join(f.source, "requirements.txt"), `${tracked}rich==13.7.0\n`);
  assert.equal((await status(f)).reason, "requirements.connected.txt does not match requirements.txt; prepare the workspace again.");
});

/** The adapter's context for Save, as the index gives it. */
function saveContext(f, runCommand) {
  return {
    connection: f.repositories[0],
    connections: f.repositories,
    repositories: f.repositories,
    sessionSourceRoot: f.source,
    trees: sessionTrees(f.source, f.repositories),
    runCommand,
    writeGitExcludes: (tree, paths) => writeManagedGitExcludes(tree, paths, { section: "connected pip packages" })
  };
}

test("pip: locked reads the checkout's version beside the tracked pin Staging and Production install", async t => {
  const pinned = await fixture(t, { requirements: "acme-library[extra]==1.0.0\n", version: "1.1.0" });
  assert.deepEqual(await pipAdapter.locked(saveContext(pinned, null)), [{ package: "acme-library", connected: "1.1.0", locked: "1.0.0" }]);
  const ranged = await fixture(t, { version: "1.1.0" });
  assert.deepEqual(await pipAdapter.locked(saveContext(ranged, null)), [{ package: "acme-library", connected: "1.1.0", locked: null }]);
  const unused = await fixture(t, { requirements: "requests==2.31.0\n" });
  assert.deepEqual(await pipAdapter.locked(saveContext(unused, null)), []);
});

test("pip: Save moves the tracked pin to the checkout's version only once pip finds it published", async t => {
  const tracked = "# app\nacme-library==1.0.0 ; python_version >= \"3.11\"\nrequests==2.31.0\n";
  const f = await fixture(t, { requirements: tracked, version: "1.1.0" });
  assert.equal((await step(f, "apply", toolchain())).ok, true);
  const requirements = path.join(f.source, "requirements.txt");

  // Not published yet: nothing changes, and nothing is wrong to report.
  assert.deepEqual(await pipAdapter.bump(saveContext(f, toolchain())), { bumped: [], lines: [] });
  assert.equal(await readFile(requirements, "utf8"), tracked);

  // The index cannot be reached: nothing changes, and the line says why.
  const unreachable = await pipAdapter.bump(saveContext(f, toolchain({ published: ["1.0.0", "1.1.0"], reachable: false })));
  assert.deepEqual(unreachable.bumped, []);
  assert.match(unreachable.lines[0], /^\[Connected\] Library: could not check whether acme-library 1\.1\.0 is published: WARNING: Retrying .*Network is unreachable/u);
  assert.equal(await readFile(requirements, "utf8"), tracked);

  const calls = [];
  const moved = await pipAdapter.bump(saveContext(f, toolchain({ calls, published: ["1.0.0", "1.1.0"] })));
  assert.deepEqual(moved.bumped, [{ package: "acme-library", from: "1.0.0", to: "1.1.0" }]);
  assert.equal(moved.lines[0], "[Connected] Library: Staging and Production now use the published acme-library 1.1.0.");
  assert.deepEqual(calls.find(([, ...args]) => args[2] === "download").slice(-1), ["acme-library==1.1.0"]);
  assert.equal(await readFile(requirements, "utf8"), "# app\nacme-library==1.1.0 ; python_version >= \"3.11\"\nrequests==2.31.0\n");
  // The checkout stays in effect, its derived requirements following the moved pin.
  assert.deepEqual(await step(f, "proof", toolchain()), { ok: true, output: "[Connected] Library is in effect." });

  // Now the pin is the checkout's version: nothing to move, nothing asked.
  calls.length = 0;
  assert.deepEqual(await pipAdapter.bump(saveContext(f, toolchain({ calls, published: ["1.0.0", "1.1.0"] }))), { bumped: [], lines: [] });
  assert.deepEqual(calls, []);
});
