import { describe, expect, it } from "vitest";

import {
  PREVIEW_DIAGNOSTICS_MAX_TEXT_CHARACTERS,
  previewDiagnosticsFile,
  previewDiagnosticsFileName,
  previewDiagnosticsText
} from "../../src/lib/vibe64PreviewDiagnostics.js";

class TestFile {
  constructor(parts, name, options = {}) {
    this.lastModified = options.lastModified;
    this.name = name;
    this.parts = parts;
    this.size = parts.reduce((total, part) => total + String(part).length, 0);
    this.type = options.type;
  }
}

function diagnosticsFixture() {
  return {
    capturedAt: "2026-07-15T01:02:03.456Z",
    console: {
      droppedEntryCount: 2,
      entries: [{
        level: "error",
        source: "exception",
        text: "ReferenceError: missingValue is not defined",
        timestamp: "2026-07-15T01:02:02.000Z"
      }]
    },
    href: "http://127.0.0.1:4103/home?vibe64_preview_token=secret",
    network: {
      droppedEntryCount: 3,
      suppressedResourceCount: 275,
      entries: [{
        durationMs: 12.5,
        kind: "fetch",
        method: "POST",
        phase: "complete",
        requestBody: "{\"name\":\"Ada\"}",
        requestHeaders: {
          "content-type": "application/json"
        },
        responseBody: "{\"error\":\"invalid\"}",
        responseHeaders: {
          "content-type": "application/json"
        },
        status: 422,
        statusText: "Unprocessable Content",
        timestamp: "2026-07-15T01:02:02.500Z",
        url: "http://127.0.0.1:4103/api/users?vibe64_preview_token=secret"
      }]
    },
    title: "Accounts"
  };
}

describe("Vibe64 preview diagnostics attachments", () => {
  it("formats isolated console and network details without preview bearer tokens", () => {
    const text = previewDiagnosticsText(diagnosticsFixture());

    expect(text).toContain("collected inside the proxied app iframe only");
    expect(text).toContain("## Console (1)");
    expect(text).toContain("[ERROR] [exception] ReferenceError");
    expect(text).toContain("## Network (1)");
    expect(text).toContain("[fetch] POST http://127.0.0.1:4103/api/users");
    expect(text).toContain("422 Unprocessable Content");
    expect(text).toContain("{\"error\":\"invalid\"}");
    expect(text).toContain("Dropped console entries before capture: 2");
    expect(text).toContain("Dropped network entries before capture: 3");
    expect(text).toContain("Routine passive resource entries omitted: 275");
    expect(text).toContain("retain fetch, XHR, WebSocket activity, and passive resource failures");
    expect(text).not.toContain("secret");
    expect(text).not.toContain("vibe64_preview_token");
  });

  it("creates unique plain-text log files", () => {
    const now = new Date("2026-07-15T01:02:03.456Z");
    const file = previewDiagnosticsFile(diagnosticsFixture(), {
      fileConstructor: TestFile,
      now,
      sequence: 4
    });

    expect(file.name).toBe("vibe64-preview-diagnostics-2026-07-15T01-02-03-456Z-04.log");
    expect(file.type).toBe("text/plain");
    expect(file.lastModified).toBe(now.getTime());
    expect(file.parts.join("")).toContain("# Vibe64 proxied app diagnostics");
    expect(previewDiagnosticsFileName(now, 5))
      .toBe("vibe64-preview-diagnostics-2026-07-15T01-02-03-456Z-05.log");
  });

  it("caps the final attachment even when the bridge payload is hostile", () => {
    const text = previewDiagnosticsText({
      console: {
        entries: Array.from({ length: 100 }, (_, index) => ({
          text: `${index}:${"x".repeat(30000)}`
        }))
      }
    });

    expect(text.length).toBeLessThanOrEqual(PREVIEW_DIAGNOSTICS_MAX_TEXT_CHARACTERS);
    expect(text).toContain("[attachment truncated by Vibe64]");
  });
});
