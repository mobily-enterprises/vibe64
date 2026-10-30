import vm from "node:vm";
import assert from "node:assert/strict";
import test from "node:test";

import {
  PREVIEW_BRIDGE_VERSION,
  PREVIEW_INTERACTION_MESSAGE_TYPE,
  PREVIEW_PICK_RESULT_MESSAGE_TYPE,
  PREVIEW_PICK_START_MESSAGE_TYPE,
  PREVIEW_PICK_STOP_MESSAGE_TYPE,
  PREVIEW_RECORDING_MESSAGE_TYPE
} from "../../packages/vibe64-terminals/src/shared/launchPreviewProtocol.js";
import { injectLaunchPreviewBridge } from "../../packages/vibe64-terminals/src/server/launchPreviewBridge.js";

// Runs the real injected bridge, and the project locator it inlines, against a
// small fake page: Pick and recorded interactions, as the editor drives them.
const EDITOR_ORIGIN = "https://editor.example";
const RECORDING_ID = "rec_abcdefghijklmnopqrst";
const HEADER = "x-vibe64-interaction";

function matchesSelector(node, selector) {
  return selector.split(",").some((part) => {
    const [, tag, attribute, value] = part.trim().match(/^([a-z0-9]*)(?:\[([a-z-]+)(?:=([a-z]+))?\])?$/u) || [];
    if (tag === undefined) return false;
    if (tag && node.tagName.toLowerCase() !== tag) return false;
    if (!attribute) return Boolean(tag);
    const actual = node.getAttribute(attribute);
    return value === undefined ? actual !== null : actual === value;
  });
}

class FakeElement {
  constructor(tag, attributes = {}, children = [], properties = {}) {
    this.nodeType = 1;
    this.tagName = tag.toUpperCase();
    this.attributes = { ...attributes };
    this.childNodes = [];
    this.parentNode = null;
    this.style = {};
    Object.assign(this, properties);
    for (const child of children) this.append(typeof child === "string" ? { nodeType: 3, nodeValue: child } : child);
  }
  getAttribute(name) {
    return Object.hasOwn(this.attributes, name) ? String(this.attributes[name]) : null;
  }
  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }
  append(...nodes) {
    for (const node of nodes) {
      node.parentNode = this;
      this.childNodes.push(node);
    }
  }
  remove() {
    this.parentNode?.childNodes.splice(this.parentNode.childNodes.indexOf(this), 1);
    this.parentNode = null;
  }
  closest(selector) {
    for (let node = this; node?.nodeType === 1; node = node.parentNode) {
      if (matchesSelector(node, selector)) return node;
    }
    return null;
  }
  getBoundingClientRect() {
    return { left: 12, top: 40, width: 120, height: 32 };
  }
}

const el = (tag, attributes, children, properties) => new FakeElement(tag, attributes, children, properties);

function bridgePage({ locatorSource = "", parentOrigins = [EDITOR_ORIGIN], recording = null } = {}) {
  const messages = [];
  const targetOrigins = [];
  const listeners = new Map();
  const fetches = [];
  const xhrHeaders = [];
  let clock = 10000;
  const html = el("html");
  const body = el("body");
  html.append(body);
  class FakeXhr {
    addEventListener() {}
  }
  FakeXhr.prototype.open = function open() {};
  FakeXhr.prototype.send = function send() {};
  FakeXhr.prototype.setRequestHeader = function setRequestHeader(name, value) {
    xhrHeaders.push([String(name).toLowerCase(), value]);
  };
  const window = {
    location: new URL("https://preview.example/notes"),
    history: {},
    console: { log() {}, info() {}, warn() {}, error() {}, debug() {} },
    parent: { postMessage: (value, targetOrigin) => { messages.push(value); targetOrigins.push(targetOrigin); } },
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(listener);
    },
    fetch: async (input, init = {}) => {
      fetches.push({ url: String(input?.url || input), headers: new Headers(init?.headers || input?.headers || {}) });
      return { status: 200, statusText: "OK", url: String(input), headers: new Headers(),
        clone() { return { headers: new Headers(), body: null, text: async () => "" }; } };
    },
    XMLHttpRequest: FakeXhr
  };
  const document = {
    readyState: "complete",
    title: "Notes",
    documentElement: html,
    body,
    createElement: (tag) => el(tag),
    getElementById(id) {
      const find = (node) => node.getAttribute?.("id") === id ? node : (node.childNodes || []).map(find).find(Boolean);
      return find(html) || null;
    },
    addEventListener() {}
  };
  const context = vm.createContext({ window, document, URL, Headers, Request, ErrorEvent: class ErrorEvent {},
    queueMicrotask, setTimeout, performance: { now: () => clock } });
  const page = injectLaunchPreviewBridge("<head></head>", {
    locatorSource,
    parentOrigins,
    recording,
    targetOrigin: "http://127.0.0.1:4000"
  });
  const scripts = [...page.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gu)].map((match) => match[1]);
  for (const script of scripts) vm.runInContext(script, context);
  function event(type, target, fields = {}) {
    let prevented = false;
    let stopped = false;
    return {
      type, target, isTrusted: true, ...fields,
      preventDefault() { prevented = true; },
      stopImmediatePropagation() { stopped = true; },
      get prevented() { return prevented; },
      get stopped() { return stopped; }
    };
  }
  return {
    body, context, html, messages, scripts, targetOrigins, fetches, xhrHeaders,
    dispatch(type, target, fields) {
      const value = event(type, target, fields);
      for (const listener of listeners.get(type) || []) {
        listener(value);
        if (value.stopped) break;
      }
      return value;
    },
    post(data, origin = EDITOR_ORIGIN) {
      for (const listener of listeners.get("message") || []) listener({ data, origin, source: window.parent });
    },
    of: (type) => messages.filter((message) => message.type === type),
    overlay: () => html.childNodes.find((node) => node.getAttribute?.("data-vibe64-preview-pick") === "1") || null,
    advance(ms) { clock += ms; },
    fetch: (...args) => window.fetch(...args),
    xhr(url) {
      const request = new window.XMLHttpRequest();
      request.open("POST", url);
      request.send("{}");
    }
  };
}

const nextTask = () => new Promise((resolve) => setTimeout(resolve, 0));
const locator = `globalThis.__vibe64LocateElement = (element) => {
  for (let node = element; node; node = node.parentNode) {
    if (node.vueFile) return { file: node.vueFile, name: node.vueName };
  }
  return null;
};`;

test("Pick outlines the element, prevents only its own click, and answers with the locator's component", async () => {
  const page = bridgePage({ locatorSource: locator });
  const save = el("button", {}, ["Save ", el("span", {}, ["draft"])]);
  const card = el("section", {}, [save], { vueFile: "/srv/source/src/components/NoteCard.vue", vueName: "NoteCard" });
  page.body.append(card);

  const ordinary = page.dispatch("click", save);
  assert.equal(ordinary.prevented, false, "a click outside Pick is left alone");
  assert.equal(page.overlay(), null);

  page.post({ type: PREVIEW_PICK_START_MESSAGE_TYPE });
  const overlay = page.overlay();
  assert.ok(overlay, "Pick adds its outline");
  assert.match(overlay.style.cssText, /pointer-events:none/u);
  page.dispatch("pointermove", save);
  assert.equal(overlay.style.display, "block");
  assert.equal(overlay.style.left, "12px");
  assert.equal(overlay.childNodes[0].textContent, "NoteCard");
  assert.equal(page.dispatch("pointerdown", save).prevented, true);
  const picked = page.dispatch("click", save);
  assert.equal(picked.prevented, true);
  assert.equal(picked.stopped, true);
  assert.equal(page.overlay(), null, "the outline goes once the pick is made");
  assert.deepEqual(JSON.parse(JSON.stringify(page.of(PREVIEW_PICK_RESULT_MESSAGE_TYPE))), [{
    componentFile: "/srv/source/src/components/NoteCard.vue",
    componentName: "NoteCard",
    elementLabel: "button \"Save draft\"",
    type: PREVIEW_PICK_RESULT_MESSAGE_TYPE,
    version: PREVIEW_BRIDGE_VERSION
  }]);
  assert.equal(page.dispatch("click", save).prevented, false, "the next click is the app's again");
});

test("Escape and the editor's stop end Pick, and a page without a locator picks no component", () => {
  const page = bridgePage();
  const link = el("a", { href: "/help", title: "Help" }, ["Help"]);
  page.body.append(link);

  page.post({ type: PREVIEW_PICK_START_MESSAGE_TYPE });
  const escape = page.dispatch("keydown", link, { key: "Escape" });
  assert.equal(escape.prevented, true);
  assert.equal(page.overlay(), null);
  assert.deepEqual(page.of(PREVIEW_PICK_RESULT_MESSAGE_TYPE).map(({ cancelled }) => cancelled), [true]);

  page.post({ type: PREVIEW_PICK_START_MESSAGE_TYPE });
  page.post({ type: PREVIEW_PICK_STOP_MESSAGE_TYPE });
  assert.equal(page.overlay(), null);
  assert.equal(page.dispatch("click", link).prevented, false);

  page.post({ type: PREVIEW_PICK_START_MESSAGE_TYPE });
  page.dispatch("click", link);
  const [, result] = page.of(PREVIEW_PICK_RESULT_MESSAGE_TYPE);
  assert.equal(result.componentFile, null);
  assert.equal(result.componentName, null);
  assert.equal(result.elementLabel, "link \"Help\"");
});

test("a foreign parent can neither start Pick nor turn recording on, and replies go only to the editor", async () => {
  const page = bridgePage({ locatorSource: locator });
  const button = el("button", {}, ["Add"]);
  page.body.append(button);
  page.post({ type: PREVIEW_PICK_START_MESSAGE_TYPE }, "https://evil.example");
  assert.equal(page.overlay(), null);
  page.post({ type: PREVIEW_RECORDING_MESSAGE_TYPE, active: true, recordingId: RECORDING_ID, nextInteraction: 1 }, "https://evil.example");
  page.dispatch("click", button);
  assert.equal(page.of(PREVIEW_INTERACTION_MESSAGE_TYPE).length, 0);

  page.post({ type: PREVIEW_RECORDING_MESSAGE_TYPE, active: true, recordingId: RECORDING_ID, nextInteraction: 1 });
  page.post({ type: PREVIEW_PICK_START_MESSAGE_TYPE });
  page.dispatch("click", button);
  await nextTask();
  page.dispatch("click", button);
  assert.ok(page.targetOrigins.length > 2);
  assert.ok(page.targetOrigins.every((origin) => origin === EDITOR_ORIGIN), "no reply uses targetOrigin *");
  assert.deepEqual(page.of(PREVIEW_INTERACTION_MESSAGE_TYPE).map(({ id }) => id), ["i_0001"], "a pick click is not an interaction");

  const silent = bridgePage({ parentOrigins: [] });
  silent.post({ type: PREVIEW_PICK_START_MESSAGE_TYPE });
  assert.equal(silent.overlay(), null, "a bridge with no known editor ignores every parent");
});

test("a recorded click, submit and Enter each start one interaction, numbered from the editor's next number", async () => {
  const page = bridgePage({ locatorSource: locator, recording: { active: true, recordingId: RECORDING_ID } });
  const save = el("button", { type: "submit" }, ["Save"]);
  const title = el("input", { id: "title", type: "text" }, [], { value: "my typed title" });
  const notes = el("textarea", {}, ["first draft text"]);
  const form = el("form", { "aria-label": "New note" }, [el("label", { for: "title" }, ["Title"]), title, notes, save],
    { vueFile: "src/components/NoteForm.vue" });
  title.labels = [form.childNodes[0]];
  page.body.append(form);

  page.dispatch("click", save);
  assert.equal(page.of(PREVIEW_INTERACTION_MESSAGE_TYPE).length, 0, "nothing is numbered before the editor says where to start");

  page.post({ type: PREVIEW_RECORDING_MESSAGE_TYPE, active: true, recordingId: RECORDING_ID, nextInteraction: 7 });
  const click = page.dispatch("click", save);
  page.dispatch("submit", form, { submitter: save });
  assert.equal(click.prevented, false, "recording prevents nothing");
  await nextTask();
  page.dispatch("submit", form);
  await nextTask();
  page.dispatch("keydown", title, { key: "Enter" });
  await nextTask();
  page.dispatch("keydown", notes, { key: "Enter" });
  page.dispatch("keydown", title, { key: "a" });
  page.dispatch("click", save, { isTrusted: false });

  const interactions = JSON.parse(JSON.stringify(page.of(PREVIEW_INTERACTION_MESSAGE_TYPE)));
  assert.deepEqual(interactions.map(({ id, kind, elementLabel, componentFile }) => ({ id, kind, elementLabel, componentFile })), [
    { id: "i_0007", kind: "click", elementLabel: "button \"Save\"", componentFile: "src/components/NoteForm.vue" },
    { id: "i_0008", kind: "submit", elementLabel: "form \"New note\"", componentFile: "src/components/NoteForm.vue" },
    { id: "i_0009", kind: "enter", elementLabel: "textbox \"Title\"", componentFile: "src/components/NoteForm.vue" }
  ]);
  assert.ok(interactions.every((message) => !Number.isNaN(Date.parse(message.at)) && message.version === PREVIEW_BRIDGE_VERSION));
  assert.doesNotMatch(JSON.stringify(page.messages), /my typed title|first draft/u, "typed values never leave the page");

  page.post({ type: PREVIEW_RECORDING_MESSAGE_TYPE, active: true, recordingId: RECORDING_ID, nextInteraction: 2 });
  await nextTask();
  page.dispatch("click", save);
  assert.equal(page.of(PREVIEW_INTERACTION_MESSAGE_TYPE).at(-1).id, "i_0010", "a lower number from the editor never reuses an id");

  page.post({ type: PREVIEW_RECORDING_MESSAGE_TYPE, active: false, recordingId: null });
  await nextTask();
  page.dispatch("click", save);
  page.post({ type: PREVIEW_RECORDING_MESSAGE_TYPE, active: true, recordingId: "rec_not-valid", nextInteraction: 1 });
  await nextTask();
  page.dispatch("click", save);
  assert.equal(page.of(PREVIEW_INTERACTION_MESSAGE_TYPE).length, 4, "no interaction once recording is off or its id is not a recording id");
});

test("same-origin fetch and XHR within 1 s of an interaction carry its id; cross-origin and later ones never do", async () => {
  const page = bridgePage();
  const add = el("button", {}, ["Add"]);
  page.body.append(add);
  await page.fetch("/api/notes");
  page.post({ type: PREVIEW_RECORDING_MESSAGE_TYPE, active: true, recordingId: RECORDING_ID, nextInteraction: 1 });
  page.dispatch("click", add);
  page.advance(400);
  await page.fetch("/api/notes", { method: "POST", headers: { "content-type": "application/json" } });
  await page.fetch(new Request("https://preview.example/api/tags", { headers: { accept: "application/json" } }));
  await page.fetch("https://api.other.example/track", { method: "POST" });
  await page.fetch("http://127.0.0.1:4000/api/direct");
  page.xhr("/api/legacy");
  page.xhr("https://api.other.example/legacy");
  page.advance(601);
  await page.fetch("/api/late");
  page.xhr("/api/late");

  const sent = page.fetches.map(({ url, headers }) => [url, headers.get(HEADER)]);
  assert.deepEqual(sent, [
    ["/api/notes", null],
    ["/api/notes", "i_0001"],
    ["https://preview.example/api/tags", "i_0001"],
    ["https://api.other.example/track", null],
    ["http://127.0.0.1:4000/api/direct", null],
    ["/api/late", null]
  ]);
  assert.equal(page.fetches[1].headers.get("content-type"), "application/json", "the app's own headers stay");
  assert.equal(page.fetches[2].headers.get("accept"), "application/json", "a Request's own headers stay");
  assert.deepEqual(page.xhrHeaders.filter(([name]) => name === HEADER), [[HEADER, "i_0001"]]);

  await nextTask();
  page.dispatch("click", add);
  await page.fetch("/api/notes");
  assert.equal(page.fetches.at(-1).headers.get(HEADER), "i_0002", "the next interaction takes over");
});

test("labels use role or tag and a visible label, never values, and a password field stays generic", async () => {
  const page = bridgePage();
  page.post({ type: PREVIEW_RECORDING_MESSAGE_TYPE, active: true, recordingId: RECORDING_ID, nextInteraction: 1 });
  const password = el("input", { type: "password", "aria-label": "Account password" }, [], { value: "hunter2" });
  const email = el("input", { type: "email", placeholder: "you@example.com" }, [], { value: "person@private.example" });
  const country = el("select", { "aria-labelledby": "country-label" }, [el("option", {}, ["France"]), el("option", {}, ["Italy"])]);
  const countryLabel = el("span", { id: "country-label" }, ["Country"]);
  const editor = el("div", { role: "textbox" }, ["typed into a rich editor"], { isContentEditable: true });
  const long = el("div", { role: "button" }, ["A".repeat(60)]);
  const icon = el("span", {}, []);
  const iconButton = el("button", { "aria-label": "Close dialog" }, [icon]);
  const plain = el("div", {}, ["Customer Ada Lovelace, account 42"]);
  const checkbox = el("input", { type: "checkbox" }, [], { checked: true });
  const remember = el("label", {}, ["Remember me ", checkbox]);
  checkbox.labels = [remember];
  page.body.append(password, email, countryLabel, country, editor, long, iconButton, plain, remember);

  for (const element of [password, email, country, editor, long, icon, plain, checkbox]) {
    page.dispatch("click", element);
    await nextTask();
  }
  const labels = page.of(PREVIEW_INTERACTION_MESSAGE_TYPE).map(({ elementLabel }) => elementLabel);
  assert.deepEqual(labels, [
    "password field",
    "textbox \"you@example.com\"",
    "combobox \"Country\"",
    "textbox",
    `button "${"A".repeat(39)}…"`,
    "button \"Close dialog\"",
    "div",
    "checkbox \"Remember me\""
  ]);
  assert.doesNotMatch(JSON.stringify(page.messages), /hunter2|Account password|private\.example|France|Italy|rich editor|Lovelace/u);
});

test("the locator runs as its own script, cannot close the bridge's element, and a broken one leaves the bridge working", () => {
  const html = injectLaunchPreviewBridge("<head></head>", {
    locatorSource: "globalThis.__vibe64LocateElement = () => ({ file: \"</script><script>alert(1)</script>\" }); // <!-- x",
    parentOrigins: [EDITOR_ORIGIN]
  });
  assert.equal(html.match(/<\/script>/giu).length, 2, "only the bridge and locator elements close");
  assert.doesNotMatch(html, /<!--/u);
  const page = bridgePage({ locatorSource: "globalThis.__vibe64LocateElement = () => ({ file: \"</SCRIPT>\" });" });
  const button = el("button", {}, ["Go"]);
  page.body.append(button);
  page.post({ type: PREVIEW_PICK_START_MESSAGE_TYPE });
  page.dispatch("click", button);
  assert.equal(page.of(PREVIEW_PICK_RESULT_MESSAGE_TYPE)[0].componentFile, "</SCRIPT>");

  assert.throws(() => bridgePage({ locatorSource: "export default function locate() {}" }), { name: "SyntaxError" },
    "module syntax fails only in its own element");
  const broken = injectLaunchPreviewBridge("<head></head>", { locatorSource: "export default 1;", parentOrigins: [EDITOR_ORIGIN] });
  const [bridgeScript] = [...broken.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gu)].map((match) => match[1]);
  assert.doesNotThrow(() => new vm.Script(bridgeScript));
  assert.equal(injectLaunchPreviewBridge("<head></head>", { locatorSource: "  " }).match(/<script/gu).length, 1);
});
