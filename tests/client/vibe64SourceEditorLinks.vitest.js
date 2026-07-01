import { describe, expect, it } from "vitest";

import {
  parseLongTextInlineParts
} from "../../src/lib/studioLongTextBlocks.js";
import {
  sourceEditorLinkTarget
} from "../../src/lib/vibe64SourceEditorLinks.js";

describe("source editor chat links", () => {
  it("parses markdown links in long text inline parts", () => {
    expect(parseLongTextInlineParts("Open [app.js](/tmp/session/source/src/app.js:12).")).toEqual([
      {
        text: "Open ",
        type: "text"
      },
      {
        href: "/tmp/session/source/src/app.js:12",
        text: "app.js",
        type: "link"
      },
      {
        text: ".",
        type: "text"
      }
    ]);
  });

  it("maps absolute source-root links to editor relative paths with line numbers", () => {
    expect(sourceEditorLinkTarget({
      href: "/tmp/session/source/src/app.js:12:3",
      sourceRoot: "/tmp/session/source",
      text: "app.js"
    })).toEqual({
      column: 3,
      line: 12,
      path: "src/app.js"
    });
  });

  it("ignores links outside the session source", () => {
    expect(sourceEditorLinkTarget({
      href: "https://example.com/src/app.js",
      sourceRoot: "/tmp/session/source",
      text: "app.js"
    })).toBeNull();
  });

  it("maps relative source links without requiring a source root", () => {
    expect(sourceEditorLinkTarget({
      href: "src/App.vue:14:2",
      text: "src/App.vue"
    })).toEqual({
      column: 2,
      line: 14,
      path: "src/App.vue"
    });
  });

  it("maps relative range links to the first line in the range", () => {
    expect(sourceEditorLinkTarget({
      href: "config/server.js:1-16",
      text: "config/server.js:1-16"
    })).toEqual({
      column: 0,
      line: 1,
      path: "config/server.js"
    });
  });

  it("maps absolute session source links even when the source root is not known", () => {
    expect(sourceEditorLinkTarget({
      href: "/srv/vibe64/tenants/matt/projects/beepollen/sessions/active/2026-06-22_19-56-03/source/.github/workflows/verify.yml",
      text: ".github/workflows/verify.yml"
    })).toEqual({
      column: 0,
      line: 0,
      path: ".github/workflows/verify.yml"
    });
  });

  it("still rejects absolute source links without a source root", () => {
    expect(sourceEditorLinkTarget({
      href: "/tmp/session/root/src/app.js:12",
      text: "app.js"
    })).toBeNull();
  });
});
