// An explicit final assistant block is durable in the ordinary conversation log.
// It identifies a setup request; parsing it never authorizes a connection or runs a command.
export function parseIntegrationSetupRequest(message) {
  if (message?.role !== "assistant" || typeof message.text !== "string") return null;
  const lines = message.text.replace(/\r\n/gu, "\n").split("\n");
  let fence = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (fence) {
      const closing = /^ {0,3}(`{3,}|~{3,})\s*$/u.exec(line);
      if (!closing || closing[1][0] !== fence.character || closing[1].length < fence.length) continue;
      if (fence.request) {
        if (lines.slice(index + 1).some((tail) => tail.trim())) return null;
        const payload = lines.slice(fence.start + 1, index).join("\n");
        if (payload.length > 1024) return null;
        let value;
        try { value = JSON.parse(payload); } catch { return null; }
        if (!value || Array.isArray(value) || typeof value !== "object" ||
            Object.keys(value).length !== 1 || typeof value.integrationId !== "string" ||
            !value.integrationId.trim() || value.integrationId.length > 200 ||
            /[\p{Cc}\p{Cf}]/u.test(value.integrationId)) return null;
        return { integrationId: value.integrationId, text: lines.slice(0, fence.start).join("\n").trimEnd() };
      }
      fence = null;
      continue;
    }
    const opening = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(line);
    if (opening) fence = {
      character: opening[1][0], length: opening[1].length, start: index,
      request: opening[1] === "```" && opening[2] === "vibe64-integration"
    };
  }
  return null;
}
