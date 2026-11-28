import { expect, type Locator } from "@playwright/test";

// A control on a coloured banner reads as the enabled control it is: not faded, and its words have WCAG's 4.5:1
// against what is behind them, composited up the page as the browser paints it. On 28 Nov 2026 the green "Restarted
// for an update" banner drew Reload and Dismiss in the app's primary on its green, which looked disabled.

/** A button that is enabled, not faded, and whose words have 4.5:1 against what is behind them. */
export async function expectReadableButton(button: Locator) {
  await expect(button).toBeVisible();
  await expect(button).toBeEnabled();
  const seen = await button.evaluate((element) => {
    const parse = (value: string) => {
      const numbers = /^rgba?\(([^)]+)\)$/u.exec(value)?.[1].split(/[\s,/]+/u).filter(Boolean).map(Number);
      if (!numbers || numbers.length < 3) throw new Error(`Unreadable colour ${value}`);
      return { r: numbers[0], g: numbers[1], b: numbers[2], a: numbers[3] ?? 1 };
    };
    type Colour = ReturnType<typeof parse>;
    const over = (top: Colour, bottom: Colour): Colour => ({
      r: top.r * top.a + bottom.r * (1 - top.a),
      g: top.g * top.a + bottom.g * (1 - top.a),
      b: top.b * top.a + bottom.b * (1 - top.a),
      a: 1
    });
    const luminance = ({ r, g, b }: Colour) => {
      const [red, green, blue] = [r, g, b].map((value) => {
        const channel = value / 255;
        return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    };
    const chain: Element[] = [];
    for (let node: Element | null = element; node; node = node.parentElement) chain.unshift(node);
    let behind: Colour = { r: 255, g: 255, b: 255, a: 1 };
    let opacity = 1;
    for (const node of chain) {
      const style = getComputedStyle(node);
      behind = over(parse(style.backgroundColor), behind);
      opacity *= Number(style.opacity);
    }
    const words = over(parse(getComputedStyle(element.querySelector(".v-btn__content") || element).color), behind);
    const [lighter, darker] = [luminance(words), luminance(behind)].sort((left, right) => right - left);
    return { opacity, contrast: Math.round(((lighter + 0.05) / (darker + 0.05)) * 100) / 100 };
  });
  expect(seen.opacity, "the button is not faded").toBe(1);
  expect(seen.contrast, "the button's words against what is behind them").toBeGreaterThanOrEqual(4.5);
}
