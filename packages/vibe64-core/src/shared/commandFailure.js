const VIBE64_RUNTIME_POLICY_FAILURE_KIND = "platform_runtime_policy";

function failureText(value = "") {
  return String(value || "").trim();
}

function runtimeToolLabel(tool = "") {
  const normalizedTool = failureText(tool);
  const labels = {
    gh: "GitHub CLI",
    git: "Git"
  };
  return labels[normalizedTool] || normalizedTool;
}

function vibe64RuntimePolicyFailure({
  error = "",
  message = "",
  output = ""
} = {}) {
  const diagnostic = [message, error, output]
    .map(failureText)
    .filter(Boolean)
    .join("\n");
  const runtimeError = diagnostic.match(
    /Vibe64 runtime error:\s*([^\s.]+) requires runtime ([^.\n]+)\./u
  );
  const blockedHostTool = diagnostic.match(
    /The command did not declare a runtime that provides ([^,\n]+), so host ([^\s.]+) was blocked\./u
  );
  if (!runtimeError || !blockedHostTool) {
    return null;
  }

  const tool = failureText(runtimeError[1]);
  const label = runtimeToolLabel(tool);
  return {
    kind: VIBE64_RUNTIME_POLICY_FAILURE_KIND,
    label,
    message: `Vibe64 could not start ${label}. Your work is safe. This is a Vibe64 platform configuration error, not a problem with your project.`,
    requiredRuntime: failureText(runtimeError[2]),
    title: "Vibe64 needs attention",
    tool
  };
}

function vibe64CommandFailureHelpPrompt({
  actionLabel = "",
  attemptedCommand = "",
  error = "",
  note = "",
  output = ""
} = {}) {
  const sections = [
    "Help me recover from this Vibe64 command failure. Explain what happened, inspect the project if useful, and fix what can safely be fixed. Do not discard or abandon my work.",
    failureText(actionLabel) ? `Action:\n${failureText(actionLabel)}` : "",
    failureText(attemptedCommand) ? `Command:\n${failureText(attemptedCommand)}` : "",
    failureText(error) ? `Error:\n${failureText(error)}` : "",
    failureText(output) ? `Terminal output:\n${failureText(output)}` : "",
    failureText(note) ? `My retry note:\n${failureText(note)}` : ""
  ];
  return sections.filter(Boolean).join("\n\n");
}

export {
  VIBE64_RUNTIME_POLICY_FAILURE_KIND,
  vibe64CommandFailureHelpPrompt,
  vibe64RuntimePolicyFailure
};
