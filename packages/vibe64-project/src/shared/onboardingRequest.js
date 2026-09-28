function projectOnboardingRequest(kind, { purpose = "", diagnostic = "", nextAction = "" } = {}) {
  const description = String(purpose).trim();
  const requests = {
    create: {
      title: "Start this project",
      message: "Help me start this project through conversation. Ask what I want to build, use answers I have already given, and help me choose a suitable Stack. I have not selected a starter." +
        (description ? `\n\nAgreed project description: ${description}` : "")
    },
    adopt: {
      title: "Set up this project",
      message: `Set up this existing project for guided editing. What this project is and what I want to run: ${description}. Inspect its current implementation and work backwards into Genesis Blueprint, Stack, and Program, including its actual setup and run outputs. Preserve its source and Git history.`
    },
    inspect: {
      title: "Inspect project setup",
      message: "Set up this existing project for guided editing. Inspect it for me to identify what it does and its run targets. Ask me only where the evidence is ambiguous. Work backwards into Genesis Blueprint, Stack, and Program while preserving the implementation and Git history."
    },
    repair: {
      title: "Fix project setup",
      message: `Inspect and update this project's Genesis setup. The opening inspection reports: ${diagnostic}. ` +
        (nextAction === "update-genesis" ? "The project requires a newer Genesis installation; do not downgrade its source format. " : "") +
        "Use the appropriate migration or repair, preserve source and Git history, and explain the specific change."
    }
  };
  const request = requests[kind];
  if (!request || kind === "adopt" && !description) throw new Error("Choose a setup request and describe the existing project before adopting it.");
  return {
    ...request,
    displayMessage: kind === "adopt" ? `${request.title}: ${description}` : `${request.title}.`,
    nextStepMessage: "Recheck setup after the AI finishes. Project edits remain in this session for review and Save."
  };
}

export { projectOnboardingRequest };
