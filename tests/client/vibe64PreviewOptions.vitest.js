import { describe, expect, it } from "vitest";

import {
  normalizePreviewInput,
  previewInputFromFormValues,
  previewInputHasValues,
  previewOptionFormValue,
  previewOptionsForTarget
} from "../../src/lib/vibe64PreviewOptions.js";

describe("Vibe64 preview options", () => {
  const launchTarget = {
    id: "dev",
    previewOptions: [
      {
        defaultValue: ["."],
        id: "startupArgs",
        label: "Startup arguments",
        type: "string-list"
      },
      {
        defaultValue: "development",
        id: "profile",
        label: "Profile",
        type: "text"
      }
    ]
  };

  it("uses only adapter-declared preview options", () => {
    expect(previewOptionsForTarget({
      previewOptions: [
        { id: "startupArgs", label: "Startup arguments" },
        { label: "Broken option" }
      ]
    })).toEqual([
      { id: "startupArgs", label: "Startup arguments" }
    ]);

    expect(normalizePreviewInput(launchTarget, {
      values: {
        ignored: "yes",
        profile: " local ",
        startupArgs: [
          " . ",
          "",
          "--profile local editor"
        ]
      }
    })).toEqual({
      values: {
        profile: "local",
        startupArgs: [
          ".",
          "--profile local editor"
        ]
      }
    });
  });

  it("normalizes form values for storage and launch input", () => {
    const input = previewInputFromFormValues(launchTarget, {
      profile: " local ",
      startupArgs: ".\n\n--debug\n"
    });

    expect(input).toEqual({
      values: {
        profile: "local",
        startupArgs: [
          ".",
          "--debug"
        ]
      }
    });
    expect(previewInputHasValues(input)).toBe(true);
    expect(previewOptionFormValue(launchTarget.previewOptions[0], input)).toBe(".\n--debug");
  });

  it("uses adapter defaults for missing values", () => {
    expect(normalizePreviewInput(launchTarget, {})).toEqual({
      values: {
        profile: "development",
        startupArgs: ["."]
      }
    });
    expect(previewInputHasValues({
      values: {
        profile: "",
        startupArgs: []
      }
    })).toBe(false);
  });
});
