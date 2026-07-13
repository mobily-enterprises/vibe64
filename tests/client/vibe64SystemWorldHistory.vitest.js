import { describe, expect, it } from "vitest";

import {
  createWorldViewHistory
} from "../../packages/vibe64-system-graph/src/client/world/worldViewHistory.js";

function view(id) {
  return {
    camera: {
      position: [id, id + 1, id + 2],
      target: [0, 0, id]
    },
    selectedSubsystemId: `subsystem:${id}`,
    viewMode: "subsystems"
  };
}

describe("File City view history", () => {
  it("moves backward and forward through discrete world views", () => {
    const history = createWorldViewHistory();
    const first = view(1);
    const second = view(2);
    const third = view(3);

    history.record(first);
    history.record(second);

    expect(history.canBack).toBe(true);
    expect(history.canForward).toBe(false);
    expect(history.back(third)).toEqual(second);
    expect(history.back(second)).toEqual(first);
    expect(history.canBack).toBe(false);
    expect(history.canForward).toBe(true);
    expect(history.forward(first)).toEqual(second);
    expect(history.forward(second)).toEqual(third);
    expect(history.canForward).toBe(false);
  });

  it("clears the forward branch when a new navigation starts after going back", () => {
    const history = createWorldViewHistory();
    const first = view(1);
    const second = view(2);
    const third = view(3);
    const branch = view(4);

    history.record(first);
    history.record(second);
    expect(history.back(third)).toEqual(second);
    expect(history.canForward).toBe(true);

    history.record(second);
    expect(history.canForward).toBe(false);
    expect(history.back(branch)).toEqual(second);
    expect(history.back(second)).toEqual(first);
  });

  it("clones entries and bounds retained history", () => {
    const history = createWorldViewHistory({ limit: 2 });
    const first = view(1);

    history.record(first);
    first.camera.position[0] = 999;
    history.record(view(2));
    history.record(view(3));

    expect(history.depths).toEqual({ back: 2, forward: 0 });
    expect(history.back(view(4))).toEqual(view(3));
    expect(history.back(view(3))).toEqual(view(2));
    expect(history.back(view(2))).toBeNull();
  });
});
