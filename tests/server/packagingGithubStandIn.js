// A stand-in GitHub for the GitHub Releases destination's tests, on a loopback port of the test's own. It answers
// the Releases API the destination reads (a repository, its releases a page at a time, the latest release, a tag's
// ref, an asset's bytes through GitHub's redirect to storage) and runs the gh command the destination starts, as
// fixtures/githubStandInGh.mjs, which hands it gh's command line, folder, environment and named files. Every API
// request and every gh command line is recorded as the destination sent it. A request or a gh run without the
// stand-in's own fake token is answered as GitHub answers a bad sign-in. gh accepts only the subcommands and flags
// modelled here, so a new flag from the destination fails until the stand-in learns what GitHub does with it.
//
// Nothing reaches GitHub: while a stand-in runs, the test process's fetch reaches only the stand-in, and the PATH
// it gives the destination puts first a `gh` that refuses to run, so a target that leaves out the stand-in's
// address or command is refused instead of reaching github.com.
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const STAND_IN_GH = fileURLToPath(new URL("./fixtures/githubStandInGh.mjs", import.meta.url));
const RECORDED_HEADERS = Object.freeze(["accept", "authorization", "user-agent", "x-github-api-version"]);
const GH_FLAGS = Object.freeze({
  create: Object.freeze({ "--repo": "value", "--title": "value", "--notes-file": "value", "--verify-tag": "switch", "--draft": "switch", "--prerelease": "switch", "--latest": "switch" }),
  upload: Object.freeze({ "--repo": "value", "--clobber": "switch" })
});

const digestOf = (content) => `sha256:${createHash("sha256").update(content).digest("hex")}`;

function answerJson(response, status, body, headers = {}) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", ...headers });
  response.end(JSON.stringify(body));
}

async function bodyOf(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

const ghAnswer = (exitCode, stderr = "", stdout = "") => ({ exitCode, stderr: stderr && `${stderr}\n`, stdout });

/**
 * gh's command line as gh's own parser reads it: `release <create|upload> <tag> [files...]` and the flags of
 * GH_FLAGS, a value flag as `--flag value` or `--flag=value`, a switch as `--flag` or `--flag=true|false`.
 */
function parseGh(args) {
  const [command, subcommand, ...rest] = args;
  const known = command === "release" ? GH_FLAGS[subcommand] : null;
  if (!known) return { error: `unknown command "${[command, subcommand].filter(Boolean).join(" ")}" for "gh"` };
  const flags = {};
  const positionals = [];
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index];
    if (!argument.startsWith("-")) {
      positionals.push(argument);
      continue;
    }
    const equals = argument.indexOf("=");
    const name = equals < 0 ? argument : argument.slice(0, equals);
    const inline = equals < 0 ? undefined : argument.slice(equals + 1);
    if (!known[name]) return { error: `unknown flag: ${name}` };
    if (known[name] === "value") {
      let value = inline;
      if (value === undefined) {
        index += 1;
        value = rest[index];
      }
      if (value === undefined) return { error: `flag needs an argument: ${name}` };
      flags[name] = value;
    } else if (inline === undefined || inline === "true" || inline === "false") {
      flags[name] = inline !== "false";
    } else {
      return { error: `invalid argument "${inline}" for "${name}" flag` };
    }
  }
  return { subcommand, flags, tag: positionals[0], paths: positionals.slice(1) };
}

/**
 * Starts the stand-in for one test: `api` and `gh` go in a target's settings, `token` is the only sign-in it
 * accepts, `baseEnvironment` is the publishing process's environment (the refusing gh first on PATH, and an
 * ambient GitHub token that must never reach gh), and `requests`, `ghCalls`, `refusedFetches` and `refusedGh()`
 * are what was sent.
 * @param {import("node:test").TestContext} t
 * @param {string} root a folder the test owns
 */
async function startGithubStandIn(t, root) {
  const token = `ghp_standin${randomBytes(12).toString("hex")}`;
  const signature = randomBytes(8).toString("hex");
  const repositories = new Map();
  const assets = new Map();
  const requests = [];
  const ghCalls = [];
  let nextId = 1000;
  let origin = "";

  function repository(name, { push = true, tags = [] } = {}) {
    const entry = { name, push, tags: new Set(tags), releases: [], latest: null };
    repositories.set(name, entry);
    return entry;
  }

  function attach(release, { name, content, withDigest = true }) {
    const bytes = Buffer.from(content);
    nextId += 1;
    const asset = { id: nextId, name, content: bytes, size: bytes.length, digest: withDigest ? digestOf(bytes) : null, release };
    release.assets = release.assets.filter((existing) => existing.name !== name).concat(asset);
    assets.set(asset.id, asset);
    return asset;
  }

  /** A release as GitHub keeps it; `latest` makes it the repository's latest. */
  function addRelease(name, { tag, title = tag, body = "", draft = false, prerelease = false, latest = false, files = [] }) {
    const owner = repositories.get(name);
    nextId += 1;
    const release = { id: nextId, repository: owner, tag, title, body, draft, prerelease, assets: [] };
    for (const file of files) attach(release, file);
    owner.releases.push(release);
    if (latest) owner.latest = release.id;
    return release;
  }

  const releaseOf = (owner, tag) => owner.releases.find((release) => release.tag === tag) || null;

  const assetJson = (asset) => ({
    id: asset.id,
    name: asset.name,
    label: "",
    state: "uploaded",
    content_type: "application/octet-stream",
    size: asset.size,
    digest: asset.digest,
    url: `${origin}repos/${asset.release.repository.name}/releases/assets/${asset.id}`,
    browser_download_url: `${origin}${asset.release.repository.name}/releases/download/${asset.release.tag}/${asset.name}`
  });

  const releaseJson = (release) => ({
    id: release.id,
    tag_name: release.tag,
    name: release.title,
    body: release.body,
    draft: release.draft,
    prerelease: release.prerelease,
    immutable: false,
    url: `${origin}repos/${release.repository.name}/releases/${release.id}`,
    html_url: `${origin}${release.repository.name}/releases/tag/${release.tag}`,
    assets: release.assets.map(assetJson)
  });

  function api(request, response, url) {
    const route = /^\/repos\/([^/]+\/[^/]+)(\/.*)?$/u.exec(url.pathname);
    const owner = route && repositories.get(route[1]);
    if (!owner) return answerJson(response, 404, { message: "Not Found", status: "404" });
    const rest = route[2] || "";
    if (rest === "") {
      return answerJson(response, 200, { full_name: owner.name, private: true, permissions: { admin: false, push: owner.push, pull: true } });
    }
    if (rest === "/releases") {
      const perPage = Math.min(Number(url.searchParams.get("per_page")) || 30, 100);
      const page = Math.max(Number(url.searchParams.get("page")) || 1, 1);
      const newestFirst = [...owner.releases].sort((left, right) => right.id - left.id);
      return answerJson(response, 200, newestFirst.slice((page - 1) * perPage, page * perPage).map(releaseJson));
    }
    if (rest === "/releases/latest") {
      const latest = owner.releases.find((release) => release.id === owner.latest);
      return latest ? answerJson(response, 200, releaseJson(latest)) : answerJson(response, 404, { message: "Not Found", status: "404" });
    }
    const assetRoute = /^\/releases\/assets\/(\d+)$/u.exec(rest);
    const asset = assetRoute && assets.get(Number(assetRoute[1]));
    if (asset?.release.repository === owner) {
      if (request.headers.accept !== "application/octet-stream") return answerJson(response, 200, assetJson(asset));
      response.writeHead(302, { location: `${origin}_storage/${asset.id}?signature=${signature}` });
      return response.end();
    }
    const tagRoute = /^\/git\/ref\/tags\/(.+)$/u.exec(rest);
    const tag = tagRoute && decodeURIComponent(tagRoute[1]);
    if (tag && owner.tags.has(tag)) {
      return answerJson(response, 200, { ref: `refs/tags/${tag}`, object: { type: "commit", sha: digestOf(tag).slice(7, 47) } });
    }
    return answerJson(response, 404, { message: "Not Found", status: "404" });
  }

  /** What GitHub, through gh, does with one gh command line. */
  function runGh({ args, env, files }) {
    const parsed = parseGh(args);
    if (parsed.error) return ghAnswer(1, parsed.error);
    if (env.GH_TOKEN !== token) return ghAnswer(1, "HTTP 401: Bad credentials");
    const { subcommand, flags, tag, paths } = parsed;
    if (!flags["--repo"]) return ghAnswer(1, "failed to run git: fatal: not a git repository (or any of the parent directories): .git");
    const owner = repositories.get(flags["--repo"]);
    if (!owner) return ghAnswer(1, `HTTP 404: Not Found (repository ${flags["--repo"]})`);
    if (!owner.push) return ghAnswer(1, "HTTP 403: Resource not accessible by personal access token");
    if (!tag) return ghAnswer(1, "could not determine the tag");
    const uploads = [];
    for (const file of paths) {
      if (files[file] === undefined) return ghAnswer(1, `open ${file}: no such file or directory`);
      uploads.push({ name: path.basename(file), content: Buffer.from(files[file], "base64") });
    }
    if (new Set(uploads.map(({ name }) => name)).size !== uploads.length) return ghAnswer(1, "HTTP 422: Validation Failed (asset already_exists)");
    const existing = releaseOf(owner, tag);
    if (subcommand === "upload") {
      if (!existing) return ghAnswer(1, "release not found");
      const taken = uploads.find(({ name }) => existing.assets.some((asset) => asset.name === name));
      if (taken && !flags["--clobber"]) return ghAnswer(1, `asset under the same name already exists: [${taken.name}]`);
      for (const upload of uploads) attach(existing, upload);
      return ghAnswer(0);
    }
    if (existing) return ghAnswer(1, "HTTP 422: Validation Failed (Release.tag_name already_exists)");
    const notesFile = flags["--notes-file"];
    if (notesFile !== undefined && files[notesFile] === undefined) return ghAnswer(1, `open ${notesFile}: no such file or directory`);
    if (!owner.tags.has(tag)) {
      if (flags["--verify-tag"]) return ghAnswer(1, `tag ${tag} doesn't exist in the repo ${owner.name}, aborting due to --verify-tag flag`);
      // Without --verify-tag, GitHub makes the tag itself, on the default branch's head.
      owner.tags.add(tag);
    }
    const draft = flags["--draft"] === true;
    const prerelease = flags["--prerelease"] === true;
    const release = addRelease(owner.name, {
      tag,
      title: flags["--title"] ?? tag,
      body: notesFile === undefined ? "" : Buffer.from(files[notesFile], "base64").toString("utf8"),
      draft,
      prerelease,
      latest: !draft && (flags["--latest"] === true || (flags["--latest"] === undefined && !prerelease)),
      files: uploads
    });
    return ghAnswer(0, "", `${releaseJson(release).html_url}\n`);
  }

  async function handle(request, response) {
    const url = new URL(request.url, origin);
    if (request.method === "POST" && url.pathname === "/_stand-in/gh") {
      const call = JSON.parse(await bodyOf(request));
      const notesFile = parseGh(call.args).flags?.["--notes-file"];
      const answer = runGh(call);
      ghCalls.push({
        args: call.args,
        cwd: call.cwd,
        env: call.env,
        notes: notesFile && call.files[notesFile] !== undefined ? Buffer.from(call.files[notesFile], "base64").toString("utf8") : null,
        exitCode: answer.exitCode
      });
      return answerJson(response, 200, answer, { connection: "close" });
    }
    requests.push({
      method: request.method,
      path: `${url.pathname}${url.search}`,
      headers: Object.fromEntries(RECORDED_HEADERS.filter((name) => request.headers[name] !== undefined).map((name) => [name, request.headers[name]]))
    });
    const stored = /^\/_storage\/(\d+)$/u.exec(url.pathname);
    if (stored) {
      // GitHub's storage address is signed, so it takes no sign-in.
      const asset = url.searchParams.get("signature") === signature && assets.get(Number(stored[1]));
      if (!asset) return answerJson(response, 403, { message: "Request has expired" });
      response.writeHead(200, { "content-type": "application/octet-stream" });
      return response.end(asset.content);
    }
    if (request.method !== "GET") return answerJson(response, 404, { message: "Not Found", status: "404" });
    if (request.headers.authorization !== `Bearer ${token}`) return answerJson(response, 401, { message: "Bad credentials", status: "401" });
    return api(request, response, url);
  }

  const server = createServer((request, response) => {
    handle(request, response).catch((error) => answerJson(response, 500, { message: String(error?.stack || error) }));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  origin = `http://127.0.0.1:${server.address().port}/`;
  t.after(() => new Promise((resolve) => {
    server.closeAllConnections();
    server.close(() => resolve());
  }));

  const refusedFetches = refuseOtherFetches(t, new URL(origin).origin);
  const refusingFolder = path.join(root, "refusing-bin");
  const refusedLog = path.join(root, "refused-gh.log");
  await mkdir(refusingFolder, { recursive: true });
  await writeFile(path.join(refusingFolder, "gh"), [
    "#!/bin/sh",
    `printf '%s\\n' "$*" >> '${refusedLog.replaceAll("'", "'\\''")}'`,
    "echo 'gh refused: the GitHub Releases tests never run the real gh' >&2",
    "exit 97",
    ""
  ].join("\n"), { mode: 0o755 });

  return {
    api: origin,
    gh: [process.execPath, STAND_IN_GH, origin],
    token,
    baseEnvironment: {
      ...process.env,
      PATH: [refusingFolder, process.env.PATH].filter(Boolean).join(path.delimiter),
      GH_TOKEN: "ambient-gh-token-never-passed",
      GITHUB_TOKEN: "ambient-github-token-never-passed"
    },
    requests,
    ghCalls,
    refusedFetches,
    refusedGh: async () => (await readFile(refusedLog, "utf8").catch(() => "")).split("\n").filter(Boolean),
    repository,
    addRelease,
    release: (name, tag) => releaseOf(repositories.get(name), tag),
    tags: (name) => [...repositories.get(name).tags].sort()
  };
}

/**
 * The test process's fetch reaches only `allowed` until the test ends; any other address is recorded and
 * refused as an unreachable network.
 */
function refuseOtherFetches(t, allowed) {
  const original = globalThis.fetch;
  const refused = [];
  globalThis.fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.origin === allowed) return original(input, init);
    refused.push(url.href);
    const cause = Object.assign(new Error(`${url.host} is not the stand-in`), { code: "REFUSED_BY_TEST" });
    return Promise.reject(new TypeError("fetch failed", { cause }));
  };
  t.after(() => {
    globalThis.fetch = original;
  });
  return refused;
}

/** After a test that used only the stand-in: nothing else was fetched and the real gh never ran. */
async function assertOnlyStandIn(standIn) {
  assert.deepEqual(standIn.refusedFetches, [], "no request left the stand-in");
  assert.deepEqual(await standIn.refusedGh(), [], "no gh but the stand-in's ran");
}

export { assertOnlyStandIn, startGithubStandIn };
