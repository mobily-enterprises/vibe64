import { computed, nextTick, reactive, ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLessonPlayer, showDuration } from "../../src/lib/vibe64LessonPlayer.js";

// The lesson step bar's beat player: timing, pauses, moves across steps and
// pointing, against the controller state it shares (no HTTP, no DOM).
const STEPS = [
  { id: "intro", beats: [{ kind: "show", target: "preview", text: "This is your app." }, { kind: "show", target: "chat", text: "This is the chat." }] },
  { id: "plain" },
  { id: "ask", beats: [{ kind: "do", target: "send-message", prompt: "Hi", text: "Ask it: \"Hi\"" },
    { kind: "check", target: "done", text: "Press Done." }] }
];

function harness({ reduced = false, hidden = false } = {}) {
  const state = reactive({ stepId: "intro", beat: 0, beatPaused: false, open: false, stepBarCollapsed: false });
  const steps = ref(STEPS);
  const currentStep = computed(() => steps.value.find(step => step.id === state.stepId));
  const shown = ref(true);
  const guides = [];
  const cleared = [];
  const remember = vi.fn();
  const flags = { reduced, hidden };
  const player = createLessonPlayer({ state, steps, currentStep, active: () => shown.value, remember,
    selectStep: (stepId, beat = 0) => Object.assign(state, { stepId, beat }),
    showGuide: async (guide, options) => { guides.push({ target: guide.target, filePath: guide.filePath, navigate: guide.navigate, ...options }); return { shown: true }; },
    clearGuide: id => cleared.push(id), shownGuide: () => `ring-${guides.length}`,
    motionReduced: () => flags.reduced, hidden: () => flags.hidden });
  return { state, player, shown, guides, cleared, remember, flags };
}
const settle = async () => { for (let i = 0; i < 3; i += 1) { await Promise.resolve(); await nextTick(); } };

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe("lesson beat player", () => {
  it("times show beats by length within 5 to 12 seconds", () => {
    expect(showDuration("")).toBe(5000);
    expect(showDuration("x".repeat(40))).toBe(7000);
    expect(showDuration("x".repeat(400))).toBe(12000);
  });

  it("points at each show beat's place only, advances it by itself and ends a step one past its last beat", async () => {
    const h = harness();
    await settle();
    expect(h.guides[0]).toMatchObject({ target: "preview", navigate: false, durationMs: 5000 + 50 * "This is your app.".length });
    vi.advanceTimersByTime(5900);
    await settle();
    expect(h.state.beat).toBe(1);
    expect(h.cleared).toContain("ring-1");
    expect(h.guides[1].target).toBe("chat");
    vi.advanceTimersByTime(12000);
    await settle();
    expect([h.state.beat, h.player.final, h.player.beat.value], "after the last beat: the step's verdict state, never the next step").toEqual([2, true, null]);
    vi.advanceTimersByTime(60000);
    expect(h.state.stepId).toBe("intro");
  });

  it("holds show beats while paused, held, covered by Courses, collapsed, hidden or under reduced motion", async () => {
    const h = harness();
    await settle();
    const stays = async (change, undo) => {
      change();
      await settle();
      vi.advanceTimersByTime(20000);
      await settle();
      expect(h.state.beat).toBe(0);
      undo();
      await settle();
    };
    await stays(() => h.player.togglePause(), () => h.player.togglePause());
    expect(h.remember).toHaveBeenCalled();
    await stays(() => h.player.hold(true), () => h.player.hold(false));
    await stays(() => { h.state.open = true; }, () => { h.state.open = false; });
    await stays(() => { h.state.stepBarCollapsed = true; }, () => { h.state.stepBarCollapsed = false; });
    await stays(() => { h.flags.hidden = true; }, () => { h.flags.hidden = false; });
    await stays(() => { h.flags.reduced = true; }, () => { h.flags.reduced = false; });
    await stays(() => { h.shown.value = false; }, () => { h.shown.value = true; });
    vi.advanceTimersByTime(12000);
    await settle();
    expect(h.state.beat).toBe(1);
  });

  it("moves by beat with Back and Next, crossing into the neighbouring steps at either end", async () => {
    const h = harness();
    await settle();
    expect(h.player.atStart).toBe(true);
    h.player.next();
    h.player.next();
    expect(h.state.beat).toBe(2);
    h.player.next();
    expect([h.state.stepId, h.state.beat]).toEqual(["plain", 0]);
    h.player.next();
    expect([h.state.stepId, h.state.beat]).toEqual(["ask", 0]);
    await settle();
    expect(h.guides.at(-1)).toMatchObject({ target: "chat", durationMs: 15000 });
    vi.advanceTimersByTime(60000);
    expect(h.state.beat, "a do beat waits for the learner").toBe(0);
    h.player.next();
    expect([h.state.beat, h.player.final, h.player.beat.value.kind], "a check beat is the step's last state").toEqual([1, true, "check"]);
    expect(h.player.atEnd).toBe(true);
    h.player.next();
    expect(h.state.stepId).toBe("ask");
    h.player.back();
    h.player.back();
    expect([h.state.stepId, h.state.beat]).toEqual(["plain", 0]);
    h.player.back();
    expect([h.state.stepId, h.state.beat], "Back enters the previous step at its end").toEqual(["intro", 2]);
  });

  it("starts a step from its first beat for Show me", async () => {
    const h = harness();
    h.state.beatPaused = true;
    h.state.beat = 2;
    h.player.start("intro");
    expect([h.state.beat, h.state.beatPaused]).toEqual([0, false]);
    h.player.start("ask");
    expect([h.state.stepId, h.state.beat]).toEqual(["ask", 0]);
  });
});
