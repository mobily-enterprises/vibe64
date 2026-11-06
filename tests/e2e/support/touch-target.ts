import type { Locator } from "@playwright/test";

/**
 * A control's touch target in CSS pixels: its own box, or the larger target JSKIT's Material 3 buttons draw around
 * it (a 40dp button's 48dp ::before). A button that follows another one stops its target at its own edge on that
 * side, where the earlier button's target reaches, so its width counts the reach on its other side on both. Sizes are
 * whole pixels, as the browser keeps a sub-pixel button's insets in its own layout units.
 */
export function touchTarget(control: Locator) {
  return control.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const target = getComputedStyle(element, "::before");
    if (target.content === "none" || target.content === "normal" || target.position !== "absolute") {
      return { height: Math.round(box.height), width: Math.round(box.width) };
    }
    const reach = Math.max(0, -parseFloat(target.left) || 0, -parseFloat(target.right) || 0);
    return {
      height: Math.round(Math.max(box.height, parseFloat(target.height) || 0)),
      width: Math.round(Math.max(box.width, parseFloat(target.width) || 0, box.width + 2 * reach))
    };
  });
}
