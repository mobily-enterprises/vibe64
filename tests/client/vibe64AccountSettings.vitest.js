import { describe, expect, it } from "vitest";

import {
  supabaseAccountControlsEnabled
} from "../../src/lib/vibe64AccountSettingsCapabilities.js";

describe("Vibe64 account settings capabilities", () => {
  it("shows Supabase account controls when hosted runtime exposes them", () => {
    expect(supabaseAccountControlsEnabled({
      capabilities: {
        supabaseAccountManagementEnabled: true
      },
      mode: "hosted"
    })).toBe(true);
  });

  it("hides Supabase account controls in local editor mode", () => {
    expect(supabaseAccountControlsEnabled({
      capabilities: {
        supabaseAccountManagementEnabled: false
      },
      local: true,
      mode: "local"
    })).toBe(false);
  });
});
