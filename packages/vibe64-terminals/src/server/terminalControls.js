import {
  terminalKeyInput,
  terminalSessionContainsText,
  terminalSessionControlSnapshot
} from "@local/vibe64-execution/server/terminalSessions";

/**
 * The control projection of a session's agent terminal and of the global
 * Codex terminal, a check for text on screen, and exact text or key input.
 * HTTP and direct callers share them. Input written through a control is
 * attributed to the person's Git actor.
 * @param {object} dependencies
 * @param {(sessionId: string, terminalSessionId: string, options: object) => Promise<object>} dependencies.readAgentScreen
 * @param {(sessionId: string, terminalSessionId: string, data: string, input: object) => Promise<object>} dependencies.writeAgentInput
 * @param {(terminalSessionId: string) => Promise<object>} dependencies.readGlobalScreen
 * @param {(terminalSessionId: string, data: string, options: object) => Promise<object>} dependencies.writeGlobalInput
 */
function createTerminalControls({
  readAgentScreen,
  writeAgentInput,
  readGlobalScreen,
  writeGlobalInput
}) {
  async function readAgentTerminalControl(sessionId, terminalSessionId, input) {
    return terminalSessionControlSnapshot(await readAgentScreen(sessionId, terminalSessionId, input));
  }

  async function checkAgentTerminalText(sessionId, terminalSessionId, input) {
    return terminalSessionContainsText(await readAgentScreen(sessionId, terminalSessionId, input), input.text);
  }

  async function writeAgentTerminalText(sessionId, terminalSessionId, { text, ...input }) {
    return terminalSessionControlSnapshot(await writeAgentInput(sessionId, terminalSessionId, text, { ...input, trackGitActor: true }));
  }

  async function writeAgentTerminalKey(sessionId, terminalSessionId, { key, ...input }) {
    return terminalSessionControlSnapshot(await writeAgentInput(sessionId, terminalSessionId, terminalKeyInput(key),
      { ...input, trackGitActor: true }));
  }

  async function readGlobalCodexTerminalControl(terminalSessionId) {
    return terminalSessionControlSnapshot(await readGlobalScreen(terminalSessionId));
  }

  async function checkGlobalCodexTerminalText(terminalSessionId, input) {
    return terminalSessionContainsText(await readGlobalScreen(terminalSessionId), input.text);
  }

  async function writeGlobalCodexTerminalText(terminalSessionId, { text, ...input }) {
    return terminalSessionControlSnapshot(await writeGlobalInput(terminalSessionId, text, { ...input, trackGitActor: true }));
  }

  async function writeGlobalCodexTerminalKey(terminalSessionId, { key, ...input }) {
    return terminalSessionControlSnapshot(await writeGlobalInput(terminalSessionId, terminalKeyInput(key),
      { ...input, trackGitActor: true }));
  }

  return Object.freeze({
    checkAgentTerminalText,
    checkGlobalCodexTerminalText,
    readAgentTerminalControl,
    readGlobalCodexTerminalControl,
    writeAgentTerminalKey,
    writeAgentTerminalText,
    writeGlobalCodexTerminalKey,
    writeGlobalCodexTerminalText
  });
}

export { createTerminalControls };
