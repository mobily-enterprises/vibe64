# Team AI access: when team members can open projects

A workspace can have one owner and other people (team members). Team members
never use the owner's AI directly: main chat runs on the owner's setup (a team
member's messages wait for approval), and everything else a team member does
with AI (their Colleague, Fix it with AI, Explain & check and the quick
helpers) runs on the **team setup**, the second setup in AI setup. A team
member's own lesson is the one place where main chat runs on the team setup
too; see **Lessons** below. The team setup may use only **Workspace-use** models,
never a personal plan such as the owner's Claude or ChatGPT subscription (see
[Personal-use AI subscriptions](ai-personal-use.md)).

So that a team member is never dropped into a project whose AI cannot work for
them, Vibe64 checks one thing when they open a project: **does the team setup
have at least one Workspace-use model?** Until it does, team members cannot
open any project in the workspace.

## Who is checked

- **Team members** are checked every time they open a project, including
  practice (Learning) projects.
- **The workspace owner is never checked.** The owner can always open every
  project, whatever the team setup holds.
- On Vibe64 running on your own computer there is only you, the owner, so the
  check never applies.
- Work that runs without a person (an AI turn already running, scheduled
  checks) is not checked.

## What counts as ready

The team setup is ready when at least one of its roles (Colleague, Fix it with
AI, Explain & check, Quick helper) uses a model whose connection is Workspace
use and currently connected, for example DeepSeek through an API key. A role set
to **Same as** another role counts as the model of the role it follows. A role
that is off, a role that follows an empty role, a personal plan, or a
disconnected connection does not count.

The fastest way to get there is the team card in AI setup: **Let your team use
this workspace: add a DeepSeek key (runs inside Claude Code)**. One key fills
the team setup with the recommended DeepSeek models.

## What a team member sees

Opening a project before the team setup is ready shows **Team AI isn't set up
yet** instead of the project:

- "*Owner* needs to set up AI for team members before you can open projects
  here." (*Owner* is the owner's name, or "The workspace owner" when the
  workspace has no name for them.)
- A highlighted line to pass on: **Ask *owner* to set up AI for team members.**
- **Check again** re-reads the project once the owner says it is done. It opens
  the project as soon as the team setup is ready.
- **Back to projects** returns to the project list, where the workspace has one.

The screen is the same on a phone, with the buttons full width and stacked.
Nothing about the project changes while a team member waits, and their Account
and AI Accounts pages stay open to them.

## What the owner sees

While the workspace has team members and the team setup is not ready, the
owner's project list (where the workspace has one) shows **Team members can't
open projects yet — Set up AI for team members so they can work here.** with
**Set up team AI**, which opens AI setup at the team setup. The prompt disappears once the team setup has a
Workspace-use model, or when the workspace has no team members.

Project rows in the list can also show **N waiting**: messages team members
sent to main chat that wait for the owner's approval.

## Inside a project

Once a team member is in, their AI work uses the team setup, and their messages
to main chat wait for the owner's approval before they are sent (see
[Main chat messages that wait for the owner's approval](main-chat-approvals.md)). If the owner
later removes the last Workspace-use model, the team member's next project
open shows the waiting screen again.

## Lessons

A lesson's practice project is private to its learner, so a team member's
lesson does not wait for the owner. In their own practice project, a team
member's main chat runs on the team setup and their messages go straight to it:

- **Senior** and **Junior** use the team **Colleague** model, and Auto's Router
  uses the team **Quick helper** model. **Custom** in **Chat mode** lists only
  Workspace-use models, so the member may choose any of them for the lesson.
- The composer says which AI it is: the placeholder "Message your lesson's AI —
  *model* (team AI)" and, in **Chat mode**, "This lesson runs on the team AI:
  *model*. Only you see this chat."
- **Do it for me** (which sends a line's prompt to the lesson's main chat),
  Check my work reviews and the lesson's Colleague use the same team setup.
- A personal plan, such as the owner's Claude or ChatGPT subscription, is never
  used, even when the team setup has no Colleague model. Then main chat says
  "The workspace owner hasn't chosen a Colleague model for team members yet."
  and the owner adds one in AI setup.
- The owner's own lessons run on the owner's setup as before. Main chat in
  every ordinary project still waits for the owner's approval.

## What Colleague can do

Colleague can explain this screen and the team setup. It cannot change the team
setup for a team member: only the owner edits AI setup. A team member's Colleague
itself needs the team setup, so Colleague can answer only once the team setup is
ready; until then, ask the owner directly.

Related topics: [AI model setups](ai-model-setups.md),
[Personal-use AI subscriptions](ai-personal-use.md),
[AI onboarding](ai-onboarding.md) and [Colleague](colleague.md).
