import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { setImmediate } from "node:timers/promises";
import test from "node:test";
import { parse } from "@vue/compiler-sfc";
import { createRenderer, onMounted, onUnmounted } from "vue";
import { createMemoryHistory, createRouter, useRouter } from "vue-router";
import { sourceEditorLinkTarget } from "../../src/lib/vibe64SourceEditorLinks.js";

const { descriptor } = parse(await readFile(new URL("../../src/App.vue", import.meta.url), "utf8"));
const linkSetup = await readFile(new URL("../../src/composables/useVibe64InAppLinks.js", import.meta.url), "utf8");
// Execute the real shell setup and lifecycle with Vue; rendering is irrelevant
// to document-level link delegation.
const setupShell = new Function("onMounted", "onUnmounted", "useRouter", "window", "document",
  linkSetup.replace(/^import .*;$/gmu, "").replace("export function", "function") +
  descriptor.scriptSetup.content.replace(/^import .*;$/gmu, ""));
const origin = "https://vibe64.example";
const start = "/app/project/example";
const issue = `${start}/dashboard/issues?issue=44`;
const renderer = createRenderer({
  createComment: () => ({}), insert() {}, remove() {}, parentNode() {}, nextSibling() {}
});

async function fixture(t) {
  const document = new EventTarget();
  const window = { location: new URL(start, origin) };
  const page = { render: () => null };
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", component: page },
      { path: "/app/project/:slug", component: page },
      { path: "/app/project/:slug/dashboard/issues", component: page },
      { path: "/app/project/:slug/dashboard/env", component: page },
      { path: "/app/manage/accounts", component: page },
      { path: "/:pathMatch(.*)*", name: "not-found", component: page }
    ]
  });
  await router.push(start);
  const app = renderer.createApp({
    setup() { setupShell(onMounted, onUnmounted, useRouter, window, document); },
    render: () => null
  });
  app.use(router).mount({});
  let mounted = true;
  function unmount() {
    if (mounted) app.unmount();
    mounted = false;
  }
  t.after(unmount);

  async function click(href, { attributes = {}, prevented = false, ...init } = {}) {
    const anchor = {
      href: URL.canParse(href, window.location.href) ? new URL(href, window.location.href).href : href,
      getAttribute: (key) => key === "href" ? href : attributes[key] ?? null,
      hasAttribute: (key) => Object.hasOwn(attributes, key),
      relList: { contains: (value) => (attributes.rel || "").split(/\s/u).includes(value) }
    };
    const event = new Event("click", { cancelable: true });
    Object.assign(event, { button: 0, ...init });
    // A nested label/icon still resolves its containing anchor.
    Object.defineProperty(event, "target", { value: { closest: () => anchor } });
    if (prevented) event.preventDefault();
    document.dispatchEvent(event);
    await setImmediate();
    return event;
  }
  return { unmount, router, click };
}

test("ordinary full and root-relative in-app links preserve route, query and fragment", async (t) => {
  const { router, click } = await fixture(t);
  for (const href of [issue, `${origin}${issue}`, `//vibe64.example${issue}`,
    `${origin}${issue}#comment-2`, "/app/project/another/dashboard/env?key=A%2FB#value",
    "/app/manage/accounts", "/"]) {
    await router.replace(start);
    const event = await click(href);
    const url = new URL(href, origin);
    assert.equal(event.defaultPrevented, true, href);
    assert.equal(router.currentRoute.value.fullPath, `${url.pathname}${url.search}${url.hash}`, href);
  }
});

test("ordinary relative anchors and explicit self targets use registered routes", async (t) => {
  const { router, click } = await fixture(t);
  const event = await click("example/dashboard/issues?issue=44", { attributes: { target: "_self" } });
  assert.equal(event.defaultPrevented, true);
  assert.equal(router.currentRoute.value.fullPath, issue);
});

test("external, non-page, malformed and fragment-only destinations keep browser behavior", async (t) => {
  const { router, click } = await fixture(t);
  for (const href of [
    `https://other.example${issue}`, `https://vibe64.example.other.example${issue}`,
    `http://vibe64.example${issue}`, `https://name:secret@vibe64.example${issue}`,
    "https://github.com/example/project/issues/44", "mailto:person@example.com", "javascript:void(0)",
    "file:///tmp/readme.md", "https://[invalid", "/api/download/file", "/missing",
    "/project/example/dashboard/issues?issue=44", "#comment-2", ""
  ]) {
    assert.equal((await click(href)).defaultPrevented, false, href);
    assert.equal(router.currentRoute.value.fullPath, start, href);
  }
});

test("modifiers, middle clicks, downloads and explicit targets retain browser behavior", async (t) => {
  const { router, click } = await fixture(t);
  for (const options of [
    { ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 },
    { attributes: { download: "" } }, { attributes: { rel: "external noopener" } },
    { attributes: { target: "_blank" } }, { attributes: { target: "named-window" } }
  ]) {
    assert.equal((await click(issue, options)).defaultPrevented, false, JSON.stringify(options));
    assert.equal(router.currentRoute.value.fullPath, start);
  }
});

test("component-owned file and router clicks are not handled twice", async (t) => {
  const { router, click } = await fixture(t);
  const sourceRoot = "/workspace/sessions/active/session/source";
  const href = `${sourceRoot}/src/Booking.vue:44`;
  assert.deepEqual(sourceEditorLinkTarget({ href, sourceRoot }), { path: "src/Booking.vue", line: 44, column: 0 });
  await click(href, { prevented: true });
  await click(issue, { prevented: true });
  assert.equal(router.currentRoute.value.fullPath, start);
});

test("in-app links respect navigation guards instead of falling back to a reload", async (t) => {
  const { router, click } = await fixture(t);
  router.beforeEach(() => false);
  assert.equal((await click(issue)).defaultPrevented, true);
  assert.equal(router.currentRoute.value.fullPath, start);
});

test("unmount removes document delegation", async (t) => {
  const { unmount, router, click } = await fixture(t);
  unmount();
  const unmountedPath = router.currentRoute.value.fullPath;
  assert.equal((await click(issue)).defaultPrevented, false);
  assert.equal(router.currentRoute.value.fullPath, unmountedPath);
});
