import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parse } from "@vue/compiler-sfc";
import { effectScope, nextTick, reactive, watch } from "vue";

const { descriptor } = parse(await readFile(new URL("../../src/components/StudioAppShellLayout.vue", import.meta.url), "utf8"));
const setup = new Function("defineProps", "defineEmits", "watch", "window",
  descriptor.scriptSetup.content.replace(/^import .*;$/gmu, "")
  + "\nreturn { startPaneSwipe, movePaneSwipe, endPaneSwipe, cancelPaneSwipe };");

function fixture(t, overrides = {}) {
  const props = reactive({ mobilePaneSwipeEnabled: true, chatCollapsed: false, ...overrides });
  const changes = [];
  const window = {
    innerWidth: 390,
    getSelection: () => ({ isCollapsed: true }),
    getComputedStyle: (node) => ({ overflowX: node.overflowX || "visible", touchAction: node.touchAction || "auto" })
  };
  const surface = { closest: () => null, scrollWidth: 390, clientWidth: 390 };
  const scope = effectScope();
  const handlers = scope.run(() => setup(() => props, () => (name, value) => {
    assert.equal(name, "update:chatCollapsed");
    changes.push(value);
  }, watch, window));
  t.after(() => scope.stop());

  function event(x, y = 100, options = {}) {
    const touch = { identifier: 1, clientX: x, clientY: y };
    return {
      target: surface, currentTarget: surface, touches: [touch], changedTouches: [touch],
      timeStamp: 100, cancelable: true, defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; },
      ...options
    };
  }
  function swipe(from, to, options = {}) {
    handlers.startPaneSwipe(event(from, 100, options));
    const move = event(to, 104, { timeStamp: 250, ...options });
    handlers.movePaneSwipe(move);
    const end = event(to, 104, { timeStamp: 300, ...options, touches: [] });
    handlers.endPaneSwipe(end);
    return { move, end };
  }
  return { props, changes, window, surface, event, swipe, ...handlers };
}

test("horizontal swipes reveal project or chat and suppress the resulting tap", (t) => {
  const f = fixture(t);
  const left = f.swipe(280, 100);
  assert.deepEqual(f.changes, [true]);
  assert.equal(left.move.defaultPrevented, true);
  assert.equal(left.end.defaultPrevented, true);
  f.props.chatCollapsed = true;
  f.swipe(100, 280);
  assert.deepEqual(f.changes, [true, false]);
});

test("desktop, unavailable panes, screen edges, taps and small drags do not switch", (t) => {
  const f = fixture(t, { mobilePaneSwipeEnabled: false });
  assert.equal(f.swipe(280, 100).move.defaultPrevented, false);
  f.props.mobilePaneSwipeEnabled = true;
  for (const [from, to] of [[5, 150], [385, 150], [100, 100], [100, 130]]) f.swipe(from, to);
  assert.deepEqual(f.changes, []);
});

test("vertical or diagonal scrolling cannot become a pane swipe later", (t) => {
  const f = fixture(t);
  for (const [x, y] of [[105, 170], [140, 140]]) {
    f.startPaneSwipe(f.event(100));
    const move = f.event(x, y);
    f.movePaneSwipe(move);
    assert.equal(move.defaultPrevented, false);
    f.endPaneSwipe(f.event(280, 104, { touches: [] }));
  }
  assert.deepEqual(f.changes, []);
});

test("long holds, cancellation and multi-touch preserve the pane", (t) => {
  const f = fixture(t);
  f.startPaneSwipe(f.event(280));
  f.endPaneSwipe(f.event(100, 100, { timeStamp: 1000, touches: [] }));
  f.startPaneSwipe(f.event(280));
  f.cancelPaneSwipe();
  f.endPaneSwipe(f.event(100, 100, { touches: [] }));
  f.startPaneSwipe(f.event(280));
  f.startPaneSwipe(f.event(280, 100, { touches: [{ identifier: 1 }, { identifier: 2 }] }));
  f.endPaneSwipe(f.event(100, 100, { touches: [] }));
  f.startPaneSwipe(f.event(280));
  f.movePaneSwipe(f.event(100, 100, { cancelable: false }));
  f.endPaneSwipe(f.event(100, 100, { touches: [] }));
  assert.deepEqual(f.changes, []);
});

test("selected text, controls and horizontal scroll containers retain their gestures", (t) => {
  const f = fixture(t);
  f.window.getSelection = () => ({ isCollapsed: false });
  f.swipe(280, 100);
  f.window.getSelection = () => ({ isCollapsed: true });
  f.surface.closest = () => ({});
  f.swipe(280, 100);
  f.surface.closest = () => null;
  f.surface.scrollWidth = 800;
  f.surface.overflowX = "auto";
  assert.equal(f.swipe(280, 100).move.defaultPrevented, false);
  f.surface.scrollWidth = 390;
  for (const touchAction of ["none", "pan-x", "pan-y"]) {
    f.surface.touchAction = touchAction;
    assert.equal(f.swipe(280, 100).move.defaultPrevented, false);
  }
  assert.deepEqual(f.changes, []);
});

test("a layout or pane change during a gesture cancels the pending switch", async (t) => {
  const f = fixture(t);
  f.startPaneSwipe(f.event(280));
  f.props.mobilePaneSwipeEnabled = false;
  await nextTick();
  f.props.mobilePaneSwipeEnabled = true;
  await nextTick();
  f.endPaneSwipe(f.event(100, 100, { touches: [] }));
  f.startPaneSwipe(f.event(100));
  f.props.chatCollapsed = true;
  await nextTick();
  f.endPaneSwipe(f.event(280, 100, { touches: [] }));
  assert.deepEqual(f.changes, []);
});
