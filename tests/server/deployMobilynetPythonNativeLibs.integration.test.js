import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { vibe64DeploymentInspection } from "../../packages/vibe64-genesis/src/server/applicationDeployment.js";
import { servicePackages, serviceUpload } from "../../packages/vibe64-deploy/src/adapters/mobilynet/declaration.js";
import { needsOfStack } from "../../packages/vibe64-deploy/src/needsOfStack.js";
import { packArchive, settingsPerService } from "../../packages/vibe64-deploy/src/package.js";
import { DAY, settle, world } from "./vibe64DeployStandInHelpers.js";

// A Production Python app with PyPI's manylinux wheels (numpy, pandas, scipy) on mobilynet. The deploy engine makes its
// package from its Deployment section (servicePackages, packArchive, serviceUpload) and the mobilynet stand-in takes the
// release. The stand-in builds and runs nothing, so the test then does with that upload what mobilynet does: it builds
// it as mobilynet's build runner does (as `build` in /home/build/src there, here a build folder, with only PATH, HOME,
// USER, LOGNAME, LANG and TMPDIR, the declared and build packages' programs first on PATH), keeps the output read-only
// in another folder, as a machine's /nix/var/mobilynet/apps/<app>, with the build folder gone, and runs the service
// there with the declared packages' programs. The packages are the real ones at /nix/var/mobilynet/packages, which only
// a host with mobilynet's packages has; the wheels come from a folder of pinned, hash-checked wheels
// (tests/fixtures/python-native-wheels.txt says how it is made), never from PyPI. Without both the test skips, saying
// why; a whole run on a host that has them runs it.

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const REQUIREMENTS = path.join(ROOT, "tests/fixtures/python-native-wheels.txt");
const PACKAGES_ROOT = "/nix/var/mobilynet/packages";
// The interpreter, the two libraries' packages and the build's patchelf; the rest of the declared packages come from
// the host's own folders when it lacks them, as the runner's PATH ends with them.
const PACKAGES = ["python313", "gcc-unwrapped^lib", "zlib", "patchelf"];
const TEST_ROOT = process.env.VIBE64_LANGUAGE_RUNTIME_TEST_ROOT || "";
const WHEELS = TEST_ROOT && path.join(TEST_ROOT, "python-wheels");
const SYSTEM_PATH = "/usr/local/bin:/usr/bin:/bin";
// The app's own module, which Serve runs: it imports the three, computes with each, and says what it was given.
const REPORT = `import json, os, sys
import numpy, pandas, scipy.stats

libraries = sorted({line.split()[-1] for line in open("/proc/self/maps")
                    if any(name in line for name in ("libstdc++.so", "libgcc_s.so", "libz.so"))})
print(json.dumps({
    "versions": [numpy.__version__, pandas.__version__, scipy.__version__],
    "solved": float(numpy.linalg.solve([[2.0, 0.0], [0.0, 4.0]], [2.0, 4.0]).sum()),
    "cdf": float(scipy.stats.norm.cdf(0)),
    "sum": int(pandas.Series([1, 2, 3]).sum()),
    "libraries": libraries,
    "environment": sorted(key for key in os.environ if key.startswith(("LD_", "NIX_PYTHON"))),
    "prefix": sys.prefix,
}))
`;

const exists = (file) => access(file).then(() => true, () => false);

async function skipReason() {
  if (!TEST_ROOT) {
    return "VIBE64_LANGUAGE_RUNTIME_TEST_ROOT names no folder of pinned wheels (tests/fixtures/python-native-wheels.txt); "
      + "a whole run on a host with mobilynet's packages and those wheels runs this test";
  }
  if (!(await exists(WHEELS))) return `${WHEELS} does not exist (tests/fixtures/python-native-wheels.txt says how to make it)`;
  const missing = [];
  for (const name of PACKAGES) if (!(await exists(path.join(PACKAGES_ROOT, name)))) missing.push(name);
  if (missing.length) {
    return `this host has no ${missing.join(", ")} at ${PACKAGES_ROOT}: only a host with mobilynet's packages runs this test`;
  }
  return false;
}

/** Runs a program to its end, giving its exit code and output instead of throwing. */
function run(file, args, options) {
  return new Promise((resolve) => {
    execFile(file, args, { maxBuffer: 16 * 1024 * 1024, ...options }, (error, stdout, stderr) => {
      resolve({ code: error ? (error.code ?? 1) : 0, stdout, stderr });
    });
  });
}

/**
 * The profile as mobilynet links one, at the same path in the build VM and on the machine (/nix/var/mobilynet/profile
 * there): each program of these packages, the first package's where two have one.
 */
async function profileOf(folder, names) {
  await rm(folder, { recursive: true, force: true });
  await mkdir(path.join(folder, "bin"), { recursive: true });
  for (const name of names) {
    const store = await realpath(path.join(PACKAGES_ROOT, name)).catch(() => null);
    const programs = store ? await readdir(path.join(store, "bin")).catch(() => []) : [];
    for (const program of programs) {
      if (!(await exists(path.join(folder, "bin", program)))) await symlink(path.join(store, "bin", program), path.join(folder, "bin", program));
    }
  }
  return path.join(folder, "bin");
}

const reason = await skipReason();

test("a Production Python app's manylinux wheels load from its app folder on mobilynet, from the libraries its runtime declares", { skip: reason, timeout: 600_000 }, async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-python-production-"));
  t.after(async () => {
    await run("chmod", ["-R", "u+w", root]);
    await rm(root, { recursive: true, force: true });
  });

  // The app's commit and its Deployment section, as the Stack says them.
  const app = path.join(root, "app");
  await mkdir(app);
  const git = async (args) => (await run("git", args, { cwd: app, env: { PATH: process.env.PATH, HOME: root } })).stdout;
  await writeFile(path.join(app, "requirements.txt"), await readFile(REQUIREMENTS, "utf8"));
  await writeFile(path.join(app, "report.py"), REPORT);
  await git(["init", "-q", "-b", "main"]);
  await git(["add", "-A"]);
  await git(["-c", "user.name=t", "-c", "user.email=t@example.test", "commit", "-q", "-m", "app"]);
  const commit = (await git(["rev-parse", "HEAD"])).trim();
  const deployment = vibe64DeploymentInspection({
    environment: { stackHash: "sha256:stack", resources: [] },
    section: {
      status: "ready",
      stackHash: "sha256:stack",
      lines: [
        "",
        "- Runtimes: `python`",
        "- Ready when: `GET` `/health` returns `200`",
        "- Prepare `Create virtual environment`: `python3` `-m` `venv` `.venv`",
        "- Prepare `Install dependencies`: `.venv/bin/python` `-m` `pip` `install` `--quiet` `--no-index` `--no-cache-dir` "
          + `\`--find-links\` \`${WHEELS}\` \`--require-hashes\` \`--only-binary=:all:\` \`-r\` \`requirements.txt\``,
        "- Serve `Start`: `.venv/bin/python` `-m` `report`"
      ],
      components: [],
      source: "project"
    }
  });
  const noResource = () => assert.fail("the app has no resource");
  const { needs, problem } = needsOfStack(deployment, { preferredAlternative: noResource, resourceKindIsDatabase: noResource });
  assert.equal(problem, null);
  const { declarations, scripts } = servicePackages({ app: "report", deployment, needs, settings: settingsPerService(needs) });
  const declaration = declarations.web;
  const scratch = path.join(root, "scratch");
  await mkdir(scratch);
  const upload = serviceUpload((await packArchive({ commit, git, scratch, scripts })).bytes, declaration);

  // mobilynet (its stand-in) takes the release.
  const { standIn, production } = world();
  const { release } = await production.createRelease(declaration.name, { archive: upload.bytes, sha256: upload.sha256 });
  settle(standIn);
  assert.equal(release.version, `${DAY}-${upload.sha256.slice(0, 7)}`);

  // The build VM: the upload unpacked into the build user's source folder, the build command run there.
  const source = path.join(root, "build/home/src");
  await mkdir(source, { recursive: true });
  await writeFile(path.join(root, "upload.tar.gz"), upload.bytes);
  assert.equal((await run("tar", ["-xzf", path.join(root, "upload.tar.gz"), "-C", source])).code, 0);
  const profile = path.join(root, "profile");
  const buildPath = await profileOf(profile, [...declaration.requiredPackages, ...declaration.build.packages ?? []]);
  await mkdir(path.join(root, "build/tmp"));
  const built = await run("/bin/bash", ["-c", declaration.build.command], {
    cwd: source,
    env: { PATH: `${buildPath}:${SYSTEM_PATH}`, HOME: path.join(root, "build/home"), USER: "build", LOGNAME: "build", LANG: "C.UTF-8", TMPDIR: path.join(root, "build/tmp") }
  });
  assert.equal(built.code, 0, built.stderr);

  // The machine: the output kept read-only in the app's folder, the build VM gone, the service run there as its login.
  assert.deepEqual(declaration.build.output, ["."]);
  const appFolder = path.join(root, "apps", declaration.name);
  await mkdir(appFolder, { recursive: true });
  assert.equal((await run("cp", ["-a", `${source}/.`, appFolder])).code, 0);
  await rm(path.join(root, "build"), { recursive: true, force: true });
  assert.equal((await run("chmod", ["-R", "a-w", appFolder])).code, 0);
  const settings = path.join(root, "settings.json");
  await writeFile(settings, JSON.stringify({ APP_ENV: "production" }));
  const serveScript = path.join(root, "serve-web.sh");
  const serveText = await readFile(path.join(appFolder, "vibe64-app/serve-web.sh"), "utf8");
  await writeFile(serveScript, serveText.replace(`/run/app-settings/${declaration.name}/settings.json`, settings));
  const machinePath = await profileOf(profile, declaration.requiredPackages);
  await mkdir(path.join(root, "home", declaration.name), { recursive: true });
  const served = await run("/bin/bash", [serveScript], {
    cwd: appFolder,
    env: { PATH: `${machinePath}:${SYSTEM_PATH}`, HOME: path.join(root, "home", declaration.name), USER: declaration.name, LOGNAME: declaration.name, LANG: "C.UTF-8" }
  });
  assert.equal(served.code, 0, served.stderr);
  const report = JSON.parse(served.stdout.trim().split("\n").at(-1));

  assert.deepEqual(report.versions, ["2.3.5", "3.1.1", "1.18.1"]);
  assert.deepEqual([report.solved, report.cdf, report.sum], [2, 0.5, 6]);
  assert.equal(report.prefix, path.join(appFolder, ".venv"), "the service runs the venv the build made");
  // Each library from the packages the runtime declares, and nothing about them in the environment.
  const declared = await Promise.all(["gcc-unwrapped^lib/lib/libgcc_s.so.1", "gcc-unwrapped^lib/lib/libstdc++.so.6", "zlib/lib/libz.so.1"]
    .map((library) => realpath(path.join(PACKAGES_ROOT, library))));
  assert.deepEqual(report.libraries, declared.sort());
  assert.deepEqual(report.environment, []);
  assert.match(built.stdout, /^Python: point native modules at the C\+\+ runtime and zlib$/mu, "the build's last step");
});
