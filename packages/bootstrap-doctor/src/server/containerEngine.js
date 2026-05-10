import { execa } from "execa";

function shellQuote(value) {
  const stringValue = String(value);
  if (/^[A-Za-z0-9_./:=@,+-]+$/.test(stringValue)) {
    return stringValue;
  }
  return `'${stringValue.replaceAll("'", "'\\''")}'`;
}

function dockerCommand(args) {
  return ["docker", ...args].map(shellQuote).join(" ");
}

function normalizeRunResult(result) {
  const stdout = String(result.stdout || "");
  const stderr = String(result.stderr || "");
  const output = String(result.all || [stdout, stderr].filter(Boolean).join("\n")).trim();

  return {
    ok: result.exitCode === 0,
    exitCode: result.exitCode,
    stdout: stdout.trim(),
    stderr: stderr.trim(),
    output
  };
}

async function runDocker(args, options = {}) {
  const {
    cwd,
    timeout = 30000,
    input
  } = options;

  try {
    const result = await execa("docker", args, {
      all: true,
      cwd,
      input,
      reject: false,
      timeout
    });

    return normalizeRunResult(result);
  } catch (error) {
    const stdout = String(error.stdout || "");
    const stderr = String(error.stderr || "");
    const output = String(error.all || error.message || "").trim();

    return {
      ok: false,
      exitCode: typeof error.exitCode === "number" ? error.exitCode : 1,
      stdout: stdout.trim(),
      stderr: stderr.trim(),
      output
    };
  }
}

export {
  dockerCommand,
  runDocker,
  shellQuote
};
