import { describe, expect, it } from "vitest";

import {
  prerequisiteAccountStatusReadQuery
} from "../../src/lib/vibe64AuthGatePrerequisites.js";

describe("Vibe64 auth gate prerequisites", () => {
  it("uses an authoritative account status read before admitting the app", () => {
    expect(prerequisiteAccountStatusReadQuery()).toEqual({
      refresh: true
    });
  });
});
