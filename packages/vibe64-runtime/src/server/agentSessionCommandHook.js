import process from "node:process";

const INPUT_MAX_BYTES = 2 * 1024 * 1024;
const WRAPPER_ENV_NAME = "VIBE64_WRAPPER";

async function readInput() {
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > INPUT_MAX_BYTES) {
      throw new Error("Agent shell hook input is too large.");
    }
    chunks.push(chunk);
  }
  const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed
    : {};
}

function hookOutput(command = "") {
  const quoted = `'${command.replaceAll("'", `'"'"'`)}'`;
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
      updatedInput: {
        command: `"$${WRAPPER_ENV_NAME}" ${quoted}`
      }
    }
  };
}

function denyOutput(reason = "") {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason || "Vibe64 could not bind this shell command to its session."
    }
  };
}

const input = await readInput();
const command = input?.tool_input?.command;
if (input.hook_event_name === "PreToolUse" && input.tool_name === "Bash") {
  const output = typeof command === "string" && command
    ? hookOutput(command)
    : denyOutput("Vibe64 rejected a shell command without valid command text.");
  process.stdout.write(`${JSON.stringify(output)}\n`);
}
