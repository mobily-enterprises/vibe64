import { describe, expect, it } from "vitest";

import {
  firstTerminalUrl
} from "../../src/lib/terminalOutputUrl.js";

describe("terminalOutputUrl", () => {
  it("extracts the first URL from terminal output", () => {
    expect(firstTerminalUrl("Open https://github.com/login/device and enter ABCD-1234."))
      .toBe("https://github.com/login/device");
  });

  it("ignores terminal escape sequences around URLs", () => {
    expect(firstTerminalUrl("\u001b[0;32mVisit https://github.com/login/device,\u001b[0m then continue."))
      .toBe("https://github.com/login/device");
  });

  it("returns an empty string when no URL is present", () => {
    expect(firstTerminalUrl("Authenticate Git with your GitHub credentials? (Y/n)"))
      .toBe("");
  });
});
