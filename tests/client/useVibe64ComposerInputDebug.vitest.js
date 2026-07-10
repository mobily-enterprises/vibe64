import { effectScope, nextTick, ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import {
  composerInputDebugFieldValue,
  useVibe64ComposerInputDebug
} from "../../src/composables/vibe64-session/composer/useVibe64ComposerInputDebug.js";

describe("useVibe64ComposerInputDebug", () => {
  it("does not evaluate composer state when session debugging is disabled", () => {
    const state = vi.fn(() => ({
      expensive: true
    }));
    const debug = useVibe64ComposerInputDebug({
      debugEnabled: () => false,
      state
    });

    debug.logInputChanged({
      valueAfter: "next",
      valueBefore: "previous"
    });

    expect(state).not.toHaveBeenCalled();
  });

  it("tracks the diagnostic state only when debugging is enabled", async () => {
    const version = ref(1);
    const state = vi.fn(() => ({
      version: version.value
    }));
    const scope = effectScope();

    scope.run(() => useVibe64ComposerInputDebug({
      debugEnabled: () => true,
      state
    }));
    expect(state).toHaveBeenCalledTimes(1);

    version.value = 2;
    await nextTick();
    expect(state).toHaveBeenCalledTimes(2);
    scope.stop();
  });

  it("redacts private field values while retaining their length", () => {
    expect(composerInputDebugFieldValue({
      field: {
        kind: "text",
        name: "apiKey"
      },
      fieldIsPrivate: () => true,
      values: {
        apiKey: "secret-value"
      }
    })).toMatchObject({
      name: "apiKey",
      privateField: true,
      value: "[private]",
      valueLength: 12
    });
  });
});
