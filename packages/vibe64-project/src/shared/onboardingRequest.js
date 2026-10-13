function projectOnboardingRequest(kind, { purpose = "", diagnostic = "", nextAction = "" } = {}) {
  const description = String(purpose).trim();
  const previewIdentitySetup = " If this application has authenticated web pages, inspect its existing authentication and Preview identity support, then start a conversation about managed preview access. Ask which existing development users should represent administrator and other relevant roles, using their email, login or user ID, and which should be the default. Reuse answers already supplied; do not ask for passwords or infer privileges from an account name. Offer to configure the existing Vibe64 Preview identity protocol and named identities, and wait for the user's choices before doing so. Do not create users, change roles or weaken production authentication as part of import. If the user defers, leave this explicitly pending; public or non-web projects do not need identity setup.";
  const requests = {
    create: {
      title: "Start this project",
      message: "Help me start this project through conversation. Ask what I want to build, use answers I have already given, and help me choose a suitable Stack. I have not selected a starter." +
        (description ? `\n\nAgreed project description: ${description}` : "")
    },
    adopt: {
      title: "Set up this project",
      message: `Set up this existing project for guided editing. What this project is and what I want to run: ${description}. Inspect its current implementation and work backwards into Genesis Blueprint, Stack, and Program, including its actual setup and run outputs. Preserve its source and Git history.` + previewIdentitySetup
    },
    inspect: {
      title: "Inspect project setup",
      message: "Set up this existing project for guided editing. Inspect it for me to identify what it does and its run targets. Ask me only where the evidence is ambiguous. Work backwards into Genesis Blueprint, Stack, and Program while preserving the implementation and Git history." + previewIdentitySetup
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
