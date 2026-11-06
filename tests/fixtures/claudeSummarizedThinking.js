// Claude Code 2.1.308 frames of two Main turns, in the shapes recorded on 2026-11-06 with
// `--thinking-display summarized` (Opus, high thinking) in beepollen at 02:25 UTC and in
// dogandgroom at 02:43 UTC; only the text is replaced. Claude writes one frame per API
// content block. Its summarized thinking joins its successive summaries into one block,
// separated by blank lines. A step's short progress summary arrives either as a second
// thinking block or as text before the step's tool call, which Vibe64 saves as commentary.

function assistantFrame(conversationId, { uuid, messageId, apiBlockIndex, block, timestamp }) {
  return {
    type: "assistant", uuid, sessionId: conversationId, apiBlockIndex, isSidechain: false, timestamp,
    version: "2.1.308", effort: "high", ...(block.type === "thinking" ? { thinkingDisplay: "summarized" } : {}),
    message: { id: messageId, type: "message", role: "assistant", model: "claude-opus-5-5",
      stop_reason: "tool_use", content: [block] }
  };
}

function recording(conversationId, request, steps) {
  const frames = [{ type: "user", uuid: `${conversationId.slice(0, 24)}000000000000`, sessionId: conversationId,
    timestamp: steps[0].at, message: { role: "user", content: [{ type: "text", text: request }] } }];
  for (const [step, { messageId, at, blocks }] of steps.entries()) {
    for (const [apiBlockIndex, block] of [...blocks, { type: "tool_use", id: `toolu_${step}`, name: "Bash", input: {} }].entries()) {
      const uuid = `${conversationId.slice(0, 24)}${String(step * 10 + apiBlockIndex + 1).padStart(12, "0")}`;
      frames.push(assistantFrame(conversationId, { uuid, messageId, apiBlockIndex, block,
        timestamp: new Date(Date.parse(at) + 20 * (apiBlockIndex + 1)).toISOString() }));
    }
  }
  return Object.freeze({ conversationId, frames: Object.freeze(frames) });
}

const thinking = (...summaries) => ({ type: "thinking", signature: "signature", thinking: summaries.join("\n\n") });

const claudeSummarizedThinkingRecordings = Object.freeze({
  // Four summaries, then the step's progress line as a second thinking block.
  beepollen: recording("3a61b9f5-ea9e-4244-8af5-d46d67666213", "Keep the development database safe.", [
    { messageId: "msg_011Cgkt6hYNmJoWyNoLt6S3f", at: "2026-11-06T02:25:44.000Z", blocks: [
      thinking("The person has stressed the development database, so I'm checking what could touch it.",
        "I'm considering which commands reach the database and which only read it.",
        "I'll take a backup before anything else runs.",
        "Fine. I'll back up the development database first."),
      thinking("Your development database is protected; I'm backing it up now.")
    ] }
  ]),
  // Three summaries and a second thinking block, then a step whose progress line is text.
  dogandgroom: recording("b782720b-1625-4594-8b99-43c3a9fb5fb1", "Check the production settings.", [
    { messageId: "msg_011CgkuTsTdagCuEnYRXYCiS", at: "2026-11-06T02:43:37.000Z", blocks: [
      thinking("I'm checking whether PUBLIC_APP_URL is set for production.",
        "I'm comparing the production list with the local one.",
        "The production site may run older code."),
      thinking("`PUBLIC_APP_URL` is missing from the production list, so I'm checking where it is read.")
    ] },
    { messageId: "msg_011CgkuVg5L2t8LHAQR4rfEJ", at: "2026-11-06T02:43:52.000Z", blocks: [
      thinking("Checking the output now."),
      { type: "text", text: "Understood. It's missing from production; reading that output now." }
    ] }
  ])
});

export { claudeSummarizedThinkingRecordings };
