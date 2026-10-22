import { describe, expect, it } from "vitest";
import { placeGuideCaption } from "../../packages/vibe64-training/src/client/guideCaptionPlacement.js";

// The guide caption sits beside its ring (right, then left), else below, else
// above; never over the ring and, while any other side fits, never over the
// lesson step bar the learner is reading.

const desktop = { width: 1280, height: 800 };
const phone = { width: 390, height: 844 };
const caption = { width: 220, height: 52 };
const stepBar = { top: 64, left: 0, width: 1280, height: 56 };

describe("guide caption placement", () => {
  it("puts the caption beside a top app bar control, off the step bar below it", () => {
    const lessonToggle = { top: 8, left: 600, width: 100, height: 48 };
    expect(placeGuideCaption({ ring: lessonToggle, caption, viewport: desktop, avoid: [stepBar] }))
      .toEqual({ side: "right", top: 8, left: 714, arrow: 24 });
    // A taller caption grazes the bar beside the control, but still covers far less of it than below.
    expect(placeGuideCaption({ ring: lessonToggle, caption: { width: 220, height: 62 }, viewport: desktop, avoid: [stepBar] }))
      .toMatchObject({ side: "right", top: 8 });
  });

  it("goes left of a control at the right edge", () => {
    const corner = { top: 8, left: 1180, width: 92, height: 48 };
    expect(placeGuideCaption({ ring: corner, caption, viewport: desktop, avoid: [stepBar] }))
      .toEqual({ side: "left", top: 8, left: 946, arrow: 24 });
  });

  it("goes below a control with no room beside it, or above when below would cover the step bar", () => {
    const wide = { top: 300, left: 20, width: 1240, height: 40 };
    expect(placeGuideCaption({ ring: wide, caption, viewport: desktop }))
      .toEqual({ side: "below", top: 354, left: 20, arrow: 200 });
    expect(placeGuideCaption({ ring: wide, caption, viewport: desktop, avoid: [{ top: 350, left: 0, width: 1280, height: 60 }] }))
      .toEqual({ side: "above", top: 234, left: 20, arrow: 200 });
  });

  it("keeps the pointer on the caption when the ring's centre is past its end", () => {
    const tall = { top: 0, left: 40, width: 60, height: 800 };
    expect(placeGuideCaption({ ring: tall, caption, viewport: desktop }))
      .toEqual({ side: "right", top: 374, left: 114, arrow: 26 });
  });

  it("on a phone, stacks the caption and covers the step bar only when nothing else fits", () => {
    const wideCaption = { width: 352, height: 52 };
    const phoneBar = { top: 56, left: 0, width: 390, height: 72 };
    const middle = { top: 400, left: 100, width: 120, height: 40 };
    expect(placeGuideCaption({ ring: middle, caption: wideCaption, viewport: phone, avoid: [phoneBar] }))
      .toEqual({ side: "below", top: 454, left: 30, arrow: 130 });
    const paneSwitch = { top: 8, left: 290, width: 92, height: 40 };
    expect(placeGuideCaption({ ring: paneSwitch, caption: wideCaption, viewport: phone, avoid: [phoneBar] }))
      .toEqual({ side: "below", top: 62, left: 30, arrow: 306 });
  });

  it("puts the caption inside a ring that leaves no room around it", () => {
    const pane = { top: 50, left: -6, width: 402, height: 800 };
    expect(placeGuideCaption({ ring: pane, caption, viewport: phone, avoid: [stepBar] }))
      .toEqual({ side: "inside", top: 64, left: 8, arrow: 0 });
  });
});
