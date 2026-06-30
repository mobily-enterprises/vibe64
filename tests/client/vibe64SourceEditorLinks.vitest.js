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
});
