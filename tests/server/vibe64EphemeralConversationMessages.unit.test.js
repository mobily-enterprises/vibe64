import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  parseLongTextInlineParts,
  parseLongTextReviewBlocks
} from "@jskit-ai/assistant-core/shared/conversation";

test("temporary conversations use the same element and retain app-owned attachment and system slots", async () => {
  const source = await readFile(new URL(
    "../../src/components/studio/vibe64-session/Vibe64EphemeralConversationMessages.vue", import.meta.url
  ), "utf8");
  assert.match(source, /<AssistantConversationElement :adapter="adapter">/u);
  assert.match(source, /conversationTurnsFromMessages\(props.messages\)/u);
  assert.match(source, /#system-message/u);
  assert.match(source, /#attachments/u);
  assert.doesNotMatch(source, /v-html/u);
});

test("the reported repair reply renders its list, bold labels, and inline code as structured blocks", () => {
  const blocks = parseLongTextReviewBlocks([
    "The Vibe64 service itself is healthy based on the snapshot:", "",
    "- **Service**: `vibe64@merc.service` is `active` and `running`",
    "- **Release**: current release `20260906062523-0069a2f` is valid", "",
    "1. **Memory pressure**: more evidence is needed.", "",
    "```sh", "echo '<script>not executable</script>'", "```"
  ].join("\n"));
  assert.deepEqual(blocks.map(block => block.type), ["paragraph", "ul", "ol", "code"]);
  assert.equal(blocks[1].items.length, 2);
  const inline = parseLongTextInlineParts(blocks[1].items[0].text);
  assert.deepEqual(inline[0], { type: "strong", text: "Service" });
  assert.deepEqual(inline.filter(part => part.type === "code").map(part => part.text), [
    "vibe64@merc.service", "active", "running"
  ]);
  assert.equal(blocks[3].text, "echo '<script>not executable</script>'");
});

test("chat links retain ordinary destinations but never activate script or data URLs", () => {
  for (const href of ["https://example.test/help", "mailto:help@example.test", "/src/app.js:10", "./README.md"]) {
    assert.deepEqual(parseLongTextInlineParts(`[Help](${href})`), [{ type: "link", text: "Help", href }]);
  }
  for (const href of ["javascript:alert", "JavaScript:alert", "java\nscript:alert", "java\tscript:alert", "vbscript:msgbox", "data:text/html,unsafe"]) {
    const text = `[Unsafe](${href})`;
    const parts = parseLongTextInlineParts(text);
    assert.equal(parts.some(part => part.type === "link"), false, href);
    assert.equal(parts.map(part => part.text).join(""), text);
  }
  for (const codePoint of [...Array(33).keys(), 127]) {
    const text = `[Unsafe](java${String.fromCodePoint(codePoint)}script:alert)`;
    const parts = parseLongTextInlineParts(text);
    assert.equal(parts.some(part => part.type === "link"), false, `ASCII ${codePoint}`);
    assert.equal(parts.map(part => part.text).join(""), text);
  }
  assert.deepEqual(parseLongTextInlineParts('<img src=x onerror="alert(1)">'), [
    { type: "text", text: '<img src=x onerror="alert(1)">' }
  ]);
});
