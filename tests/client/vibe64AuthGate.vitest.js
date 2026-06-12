import { describe, expect, it } from "vitest";

import {
  prerequisiteAccountStatusReadQuery
} from "../../src/lib/vibe64AuthGatePrerequisites.js";

describe("Vibe64 auth gate prerequisites", () => {
  it("uses an authoritative account status read before admitting local editor mode", () => {
    expect(prerequisiteAccountStatusReadQuery({
      local: true,
      mode: "local"
    })).toEqual({
      refresh: true
    });
  });

  it("uses cached account status before admitting hosted mode", () => {
    expect(prerequisiteAccountStatusReadQuery()).toBeNull();
    expect(prerequisiteAccountStatusReadQuery({
      local: false,
      mode: "hosted"
    })).toBeNull();
  });
});
