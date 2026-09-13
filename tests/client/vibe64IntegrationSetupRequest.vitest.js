import { describe, expect, it } from "vitest";
import { parseIntegrationSetupRequest } from "@local/vibe64-runtime/shared";

const block = (payload) => `\`\`\`vibe64-integration\n${JSON.stringify(payload)}\n\`\`\``;
const message = (text) => ({ role: "assistant", text });

describe("explicit integration setup requests", () => {
  it("recovers the same slot from a saved assistant reply without changing its prose", () => {
    const saved = JSON.parse(JSON.stringify(message(`Connect your business mailbox.\n\n${block({ integrationId: "gmail-business" })}`)));
    expect(parseIntegrationSetupRequest(saved)).toEqual({ integrationId: "gmail-business", text: "Connect your business mailbox." });
    expect(parseIntegrationSetupRequest({ ...saved, text: saved.text.replaceAll("\n", "\r\n") })).toEqual(parseIntegrationSetupRequest(saved));
  });
  it("never treats user messages, commentary, quoted examples or unfinished fences as requests", () => {
    const text = block({ integrationId: "gmail" });
    for (const role of ["user", "commentary", "thinking", "system", undefined]) {
      expect(parseIntegrationSetupRequest({ role, text })).toBeNull();
    }
    for (const example of [
      `\`\`\`\`markdown\n${text}\n\`\`\`\``,
      `~~~markdown\n${text}\n~~~`,
      text.split("\n").map((line) => `> ${line}`).join("\n"),
      text.slice(0, -3), `${text}\nMore prose`, "Please configure Gmail."
    ]) expect(parseIntegrationSetupRequest(message(example))).toBeNull();
  });
  it("rejects extra fields, invalid shapes and unbounded identifiers", () => {
    for (const payload of [null, [], "gmail", {}, { integrationId: "" },
      { integrationId: "gmail", token: "secret" }, { integrationId: "gmail", url: "https://example.com" },
      { integrationId: "gmail\nother" }, { integrationId: "gmail\u202e" }, { integrationId: "x".repeat(201) }
    ]) expect(parseIntegrationSetupRequest(message(block(payload)))).toBeNull();
    expect(parseIntegrationSetupRequest(message("```vibe64-integration\n{\n```"))).toBeNull();
  });
  it("allows ordinary code before the request and preserves the exact slot key", () => {
    const prefix = "```js\nconst count = 1;\n```";
    expect(parseIntegrationSetupRequest(message(`${prefix}\n${block({ integrationId: "Business mailbox" })}`)))
      .toEqual({ integrationId: "Business mailbox", text: prefix });
  });
});
