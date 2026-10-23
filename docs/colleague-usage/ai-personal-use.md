# Personal-use AI subscriptions

Some AI connections are personal plans: a Claude subscription (Pro or Max)
signed in to Claude Code, a ChatGPT subscription signed in to Codex, and the GLM
Coding Plan. Each provider's terms (Anthropic's, OpenAI's and Z.AI's) allow only
the person who subscribed to use the plan. Vibe64 therefore lets only the
workspace owner work with a personal connection. Other people in the workspace
cannot use it, even in the owner's projects. API-key connections (for example
DeepSeek, an OpenAI API key or the free Z.AI key) are **Workspace use** instead.

## Where personal use is marked

Personal connections carry an amber **Personal use** chip with a lock icon:

- **Model routing**: each personal model choice in a role's dropdown shows the
  chip; the selected field adds **Personal use** after its provider. While any
  role uses a personal model, a highlighted note above the roles says
  **Personal use: only the workspace owner can use this [plan]**.
- **AI Accounts**: a provider key editor whose route is personal shows the chip;
  the GLM Coding Plan form ends with the same note.
- A host may add the marking on AI setup cards, connection tiles and the success
  screen after connecting.

## What does this mean?

Select **What does this mean?** beside the chip or note to open **Personal use:
only the owner can use it**. It names the plan and provider, says that only the
workspace owner can work with it, and that other people need a Workspace-use
connection such as an API key billed by use. In Model routing, **Fallback for
personal models** chooses the Workspace-use model that serves them wherever
routing names a personal one. Select **Got it** to close it. The explanation is
the same on desktop and mobile.

## What Colleague can do

Colleague can explain which connections are personal and what members need, and
can open AI Accounts. Subscribing, signing in and entering keys remain the
owner's steps in the browser.
