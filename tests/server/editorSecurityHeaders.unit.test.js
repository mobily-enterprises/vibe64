import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import {
  VIBE64_RUNTIME_NAMESPACE_ENV
} from "@local/studio-terminal-core/server/studioRuntimeIdentity";
import { createLaunchPreviewProxyRegistry } from "../../packages/vibe64-terminals/src/server/launchPreviewProxy.js";
import { prepareServerBuild, STATIC_SERVER_ENTRY_PATH } from "../../tooling/release/server-build.mjs";
import * as editorServer from "../../server.js";

process.env[VIBE64_RUNTIME_NAMESPACE_ENV] = "editor-security-headers";

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const COMPOSED = Object.freeze({
  authRequired: false,
  local: false,
  mode: "composed",
  projectCatalogEnabled: true,
  singleTargetRoot: ""
});
const SELF_ONLY = /(?:^|;)\s*frame-ancestors 'self'\s*(?:;|$)/u;
const SECURITY_HEADERS = Object.freeze([
  "x-content-type-options",
  "referrer-policy",
  "strict-transport-security",
  "content-security-policy",
  "content-security-policy-report-only",
  "x-frame-options",
  "cache-control"
]);
// An editor page, a missing page, a representative API answer, a missing API path, routes with policies of their
// own and a Pages viewing link.
const ANSWERED = Object.freeze([
  "/app",
  "/app/project/demo",
  "/api/health",
  "/api/nothing-here",
  "/api/framing-proof/sandboxed",
  "/api/framing-proof/no-frames",
  "/api/vibe64/pages/view/ended-link"
]);
const run = promisify(execFile);

/** Runs the rest of the test under this APP_ENV, as a host starts the editor. */
function useAppEnvironment(t, appEnv) {
  const before = { APP_ENV: process.env.APP_ENV, NODE_ENV: process.env.NODE_ENV };
  Object.assign(process.env, { APP_ENV: appEnv, NODE_ENV: ["staging", "production"].includes(appEnv) ? "production" : "development" });
  t.after(() => {
    for (const [name, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
}

/**
 * An app root with a built page, whose server can also start as the release bundle's static entry does: its
 * features from the providers tooling/release/server-build.mjs collected, not from reading node_modules.
 */
async function releaseAppRoot(t) {
  const root = await mkdtemp(path.join(tmpdir(), "vibe64-editor-framing-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  const appRoot = path.join(root, "app");
  await mkdir(appRoot);
  for (const entry of ["app.json", "package.json", "server.js", "server", "bin", "config"]) {
    await cp(path.join(sourceRoot, entry), path.join(appRoot, entry), { recursive: true });
  }
  await symlink(path.join(sourceRoot, "node_modules"), path.join(appRoot, "node_modules"));
  await mkdir(path.join(appRoot, "dist"));
  await writeFile(path.join(appRoot, "dist/index.html"), "<!doctype html><html><head><title>Vibe64</title></head><body></body></html>");
  return { appRoot, systemRoot: path.join(root, "state") };
}

/** The release bundle's static entry in this app root, written as the release writes it, minus the bundling. */
async function releaseServerOf({ appRoot }) {
  await prepareServerBuild({ appRoot });
  return import(pathToFileURL(path.join(appRoot, STATIC_SERVER_ENTRY_PATH)).href);
}

/** What each of ANSWERED answers: its status, its security headers and, for a page, its body. */
async function answersOf(app) {
  const answers = {};
  for (const url of ANSWERED) {
    const response = await app.inject({ method: "GET", url });
    answers[url] = {
      status: response.statusCode,
      headers: Object.fromEntries(SECURITY_HEADERS.map((name) => [name, response.headers[name]])),
      ...(String(response.headers["content-type"]).startsWith("text/html") ? { body: response.body } : {})
    };
  }
  return answers;
}

/**
 * Starts the editor's server, on a runtime like the dev server's or like the release bundle's, with two routes of
 * its own that set a policy, as the file downloads and a host's sign-in callback do.
 */
async function startEditor({ appRoot, systemRoot }, server = editorServer) {
  const app = await server.createServer({ appRoot, runtimeProfile: COMPOSED, systemRoot, logLevel: "silent" });
  app.get("/api/framing-proof/sandboxed", (request, reply) => reply
    .header("Content-Security-Policy", "default-src 'none'; sandbox;")
    .send("file"));
  app.get("/api/framing-proof/no-frames", (request, reply) => reply
    .header("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
    .send("callback"));
  return app;
}

function framingOf(response) {
  return {
    policy: response.headers["content-security-policy"],
    frameOptions: response.headers["x-frame-options"]
  };
}

async function assertEditorRefusesOtherFrames(app) {
  // An editor page, a representative API answer, a missing API path and a missing page alike.
  for (const url of ["/app", "/app/project/demo", "/api/health", "/api/nothing-here"]) {
    const response = await app.inject({ method: "GET", url });
    const { policy, frameOptions } = framingOf(response);
    assert.match(String(policy), SELF_ONLY, `${url} must refuse other sites' frames`);
    assert.equal(frameOptions, "SAMEORIGIN", `${url} must carry X-Frame-Options`);
  }
  const page = await app.inject({ method: "GET", url: "/app" });
  assert.equal(page.statusCode, 200);
  assert.match(page.headers["content-type"], /^text\/html/u);
  // A route's own policy gains the directive in the one header, never a second one.
  const sandboxed = await app.inject({ method: "GET", url: "/api/framing-proof/sandboxed" });
  assert.equal(sandboxed.headers["content-security-policy"], "default-src 'none'; sandbox; frame-ancestors 'self'");
  assert.equal(sandboxed.headers["x-frame-options"], "SAMEORIGIN");
  // A route that names its frame ancestors keeps its policy, and gets no X-Frame-Options to contradict it.
  const callback = await app.inject({ method: "GET", url: "/api/framing-proof/no-frames" });
  assert.equal(callback.headers["content-security-policy"], "default-src 'none'; frame-ancestors 'none'");
  assert.equal(callback.headers["x-frame-options"], undefined);
  // A Pages viewing link is framed on purpose (its files by the frame host's opaque origin): its own headers only.
  const pageLink = await app.inject({ method: "GET", url: "/api/vibe64/pages/view/ended-link" });
  assert.equal(pageLink.statusCode, 404);
  assert.equal(pageLink.headers["content-security-policy"], "default-src 'none'; sandbox");
  assert.equal(pageLink.headers["x-frame-options"], undefined);
}

test("in production every editor answer refuses other sites' frames, on the runtime the dev server starts", async (t) => {
  useAppEnvironment(t, "production");
  const app = await startEditor(await releaseAppRoot(t));
  try {
    await assertEditorRefusesOtherFrames(app);
  } finally {
    await app.close();
  }
});

test("in production every editor answer refuses other sites' frames, on the runtime the release bundle starts", async (t) => {
  useAppEnvironment(t, "production");
  const roots = await releaseAppRoot(t);
  const app = await startEditor(roots, await releaseServerOf(roots));
  try {
    await assertEditorRefusesOtherFrames(app);
  } finally {
    await app.close();
  }
});

test("in production the release bundle answers as the dev server does: a year of HSTS, nosniff, no report-only policy", async (t) => {
  useAppEnvironment(t, "production");
  const development = await startEditor(await releaseAppRoot(t));
  let expected;
  try {
    expected = await answersOf(development);
  } finally {
    await development.close();
  }
  const releaseRoots = await releaseAppRoot(t);
  const release = await startEditor(releaseRoots, await releaseServerOf(releaseRoots));
  try {
    assert.deepEqual(await answersOf(release), expected);
  } finally {
    await release.close();
  }
  for (const url of ANSWERED) {
    assert.equal(expected[url].headers["x-content-type-options"], "nosniff", url);
    // The editor's own host name only: each Preview is a name below it.
    assert.equal(expected[url].headers["strict-transport-security"], "max-age=31536000", url);
    assert.equal(expected[url].headers["content-security-policy-report-only"], undefined, url);
  }
  assert.equal(expected["/app"].headers["content-security-policy"], "frame-ancestors 'self'");
  assert.equal(expected["/app"].headers["referrer-policy"], "strict-origin-when-cross-origin");
  assert.equal(expected["/app"].headers["cache-control"], "no-store");
  assert.match(expected["/app"].body, /<head><meta name="jskit-app-environment" content="production"><title>/u);
  assert.equal(expected["/api/health"].headers["cache-control"], "no-store, no-cache, must-revalidate");
  assert.equal(expected["/api/nothing-here"].headers["cache-control"], "no-store, no-cache, must-revalidate");
  // A Pages viewing link keeps its own sandbox headers.
  assert.equal(expected["/api/vibe64/pages/view/ended-link"].headers["referrer-policy"], "no-referrer");
  assert.equal(expected["/api/vibe64/pages/view/ended-link"].headers["cache-control"], "no-store");
});

test("the release bundle refuses to start where the dev server refuses: APP_ENV unknown, NODE_ENV not production, a retired setting", async (t) => {
  const roots = await releaseAppRoot(t);
  await prepareServerBuild({ appRoot: roots.appRoot });
  // Each start in a child of its own, which ends with the outcome whatever the refused start left open.
  const starter = path.join(path.dirname(roots.appRoot), "start-editor.mjs");
  await writeFile(starter, [
    "const [entry, appRoot, systemRoot, profile] = process.argv.slice(2);",
    "const server = await import(entry);",
    "try {",
    "  const app = await server.createServer({ appRoot, systemRoot, logLevel: \"silent\", runtimeProfile: JSON.parse(profile) });",
    "  await app.close();",
    "  console.log(\"STARTED\");",
    "} catch (error) {",
    "  console.log(`REFUSED ${error.message}`);",
    "}",
    "process.exit(0);"
  ].join("\n"));
  const outcome = async (entry, env) => {
    const { stdout } = await run(process.execPath, [
      starter,
      pathToFileURL(path.join(roots.appRoot, entry)).href,
      roots.appRoot,
      roots.systemRoot,
      JSON.stringify(COMPOSED)
    ], { env: { ...process.env, ...env }, timeout: 60_000 });
    return stdout.split("\n").find((line) => /^(STARTED|REFUSED )/u.test(line));
  };
  const production = { APP_ENV: "production", NODE_ENV: "production" };
  for (const [env, refusal] of [
    [production, null],
    [{ APP_ENV: "production", NODE_ENV: "development" }, /^REFUSED APP_ENV is production, so NODE_ENV must be production, and it is development\./u],
    [{ APP_ENV: "prod", NODE_ENV: "production" }, /^REFUSED APP_ENV is "prod", which is not an environment JSKIT knows\./u],
    [{ ...production, SIDE_EFFECTS: "live" }, /^REFUSED SIDE_EFFECTS was replaced by APP_ENV: remove SIDE_EFFECTS\./u]
  ]) {
    const development = await outcome("server.js", env);
    if (refusal) assert.match(String(development), refusal, `the dev server with ${JSON.stringify(env)}`);
    else assert.equal(development, "STARTED");
    assert.equal(await outcome(STATIC_SERVER_ENTRY_PATH, env), development, `the release bundle with ${JSON.stringify(env)}`);
  }
});

test("Staging refuses other sites' frames too", async (t) => {
  useAppEnvironment(t, "staging");
  const app = await startEditor(await releaseAppRoot(t));
  try {
    for (const url of ["/app", "/api/health"]) {
      const { policy, frameOptions } = framingOf(await app.inject({ method: "GET", url }));
      assert.match(String(policy), SELF_ONLY);
      assert.equal(frameOptions, "SAMEORIGIN");
    }
  } finally {
    await app.close();
  }
});

test("in development an outer editor's Preview may frame the editor, so it names no frame ancestors", async (t) => {
  useAppEnvironment(t, "development");
  const app = await startEditor(await releaseAppRoot(t));
  try {
    for (const url of ["/app", "/api/health"]) {
      const { policy, frameOptions } = framingOf(await app.inject({ method: "GET", url }));
      assert.doesNotMatch(String(policy ?? ""), /frame-ancestors/u);
      assert.equal(frameOptions, undefined);
    }
  } finally {
    await app.close();
  }
});

test("a production editor's Preview answers name no frame ancestors, as the editor frames them", async (t) => {
  useAppEnvironment(t, "production");
  const target = createHttpServer((request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end("<!doctype html><html><head><title>App</title></head><body>app</body></html>");
  });
  await new Promise((resolve) => target.listen(0, "127.0.0.1", resolve));
  const registry = createLaunchPreviewProxyRegistry({ env: process.env });
  try {
    const preview = await registry.ensure({
      editorOrigin: "http://127.0.0.1:3000",
      sessionId: "session-framing",
      targetHref: `http://127.0.0.1:${target.address().port}/`,
      terminalSessionId: "terminal-framing"
    });
    const response = await fetch(preview.href, { redirect: "follow" });
    assert.equal(response.status, 200);
    assert.match(await response.text(), /app/u);
    assert.doesNotMatch(String(response.headers.get("content-security-policy") || ""), /frame-ancestors/u);
    assert.equal(response.headers.get("x-frame-options"), null);
    assert.equal(response.headers.get("strict-transport-security"), null);
  } finally {
    await registry.closeAll();
    await new Promise((resolve) => target.close(resolve));
  }
});
