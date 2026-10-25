import { describe, expect, it } from "vitest";

import {
  parseLongTextInlineParts
} from "@jskit-ai/assistant-core/shared/conversation";
import {
  markdownDocumentLinkTarget,
  normalizeSourceEditorDirectoryPaths,
  normalizeSourceEditorPath,
  sourceEditorLinkTarget,
  sourcePathReferenceAtLineColumn
} from "../../src/lib/vibe64SourceEditorLinks.js";

describe("source editor paths", () => {
  it("spells a project-relative path one way", () => {
    expect(normalizeSourceEditorPath("  .\\src\\app.js ")).toBe("src/app.js");
    expect(normalizeSourceEditorPath(".//src/app.js")).toBe("src/app.js");
    expect(normalizeSourceEditorPath(null)).toBe("");
  });

  it("lists distinct sorted directories without trailing slashes", () => {
    expect(normalizeSourceEditorDirectoryPaths(["src/", "./docs", "src", "", "a\\b/"]))
      .toEqual(["a/b", "docs", "src"]);
    expect(normalizeSourceEditorDirectoryPaths("src")).toEqual([]);
  });
});

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

  it("parses source links whose visible route path contains brackets", () => {
    expect(parseLongTextInlineParts(
      "See [src/pages/home/receivals/[recordId]/edit.vue](</home/merc/.local/state/vibe64/managed-sources/matt/projects/beepollen/sessions/active/2026-06-22_19-56-03/source/src/pages/home/receivals/[recordId]/edit.vue:1>)."
    )).toEqual([
      {
        text: "See ",
        type: "text"
      },
      {
        href: "/home/merc/.local/state/vibe64/managed-sources/matt/projects/beepollen/sessions/active/2026-06-22_19-56-03/source/src/pages/home/receivals/[recordId]/edit.vue:1",
        text: "src/pages/home/receivals/[recordId]/edit.vue",
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
      href: "/home/merc/.local/state/vibe64/managed-sources/matt/projects/beepollen/sessions/active/2026-06-22_19-56-03/source/.github/workflows/verify.yml",
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

describe("links inside a rendered Markdown file", () => {
  it("opens files relative to the document or the source root, never outside the tree", () => {
    expect(markdownDocumentLinkTarget("docs/guide/intro.md", "setup.md")).toBe("docs/guide/setup.md");
    expect(markdownDocumentLinkTarget("docs/guide/intro.md", "./setup.md#install")).toBe("docs/guide/setup.md");
    expect(markdownDocumentLinkTarget("docs/guide/intro.md", "../../README.md")).toBe("README.md");
    expect(markdownDocumentLinkTarget("docs/guide/intro.md", "/src/app%20main.js")).toBe("src/app main.js");
    expect(markdownDocumentLinkTarget("README.md", "../secret.txt")).toBe("");
    for (const href of ["#install", "https://example.test/", "mailto:a@example.test", "javascript:alert(1)", ""]) {
      expect(markdownDocumentLinkTarget("README.md", href)).toBe("");
    }
  });

  it("finds relative source path references in quoted strings and CSS url()", () => {
    const line = 'import x from "./app.js"; a { background: url(../img/bg.png); } "https://example.test/"';
    expect(sourcePathReferenceAtLineColumn(line, line.indexOf("./app.js") + 2)).toEqual({
      from: line.indexOf("./app.js"),
      target: "./app.js",
      to: line.indexOf("./app.js") + "./app.js".length
    });
    expect(sourcePathReferenceAtLineColumn(line, line.indexOf("../img") + 3)?.target).toBe("../img/bg.png");
    expect(sourcePathReferenceAtLineColumn(line, line.indexOf("https") + 2)).toBeNull();
    expect(sourcePathReferenceAtLineColumn('"a\\"b"', 1)).toBeNull();
  });
});
