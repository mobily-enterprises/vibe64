# Choose models: owner and team setups

Vibe64 chooses a model for each job from **Models**. Open it from **Account
settings → AI Accounts** (or AI onboarding's **Your AI setup**): the **Models**
summary under the provider cards lists **Senior**, **Junior** and, in a
workspace with a team, **Team members**; choose **Review models**. Connecting
an AI is explained in [AI accounts](ai-accounts.md).

Only the workspace owner changes models. Everyone else sees the team members'
models read-only.

## Jobs (roles)

**Main chat**

- **Senior**: Plans, reviews and Deslop in main chat. Your most capable model.
- **Junior**: Everyday changes in main chat.
- **Router**: Chooses Senior or Junior when main chat is on Auto.

**Helpers**

- **Colleague**: The default for Colleague. Each person can change their own.
- **Fix it with AI**: Repair chats opened from errors and conflicts. Can run in a
  different tool from the chat it fixes.
- **Explain & check**: Explain this code, the database assistant and Check my
  work.
- **Quick helper**: Titles, commit messages, prompt hints and summaries.

Main chat always runs in your Senior's tool (Claude Code, Codex or OpenCode);
Senior and Junior must run in the same tool. A chat that last ran in another
tool catches up on its next message. Helpers can each use any allowed model.

## Two setups: Owner and Team members

There are two setups. **Owner (you)** has every role and is used for main chat
and for the owner's own helpers. **Team members** has only the helpers and is
used by everyone else in the workspace for their Colleague, Fix it with AI,
Explain & check and Quick helper. Main chat always runs on the owner's setup,
and the owner approves what team members send to it.

The switch **Owner (you) | Team members** at the top of Models appears only for
the owner, and only when the team setup has a model or Models was opened for
the team (from the team card or **Set up team AI**). A solo owner never sees it.

On **Team members** the screen says: Team members' Colleague, Fix it with AI,
Explain & check and Quick helper use these models. Main chat always runs on your
setup, and you approve what team members send to it. Personal plans, like your
Claude plan, can't be used by team members. Their model lists show only
**Workspace use** models; saving a personal one is refused with **Team members
can't use personal plans. Choose a Workspace-use model.**

With nothing chosen yet it shows **No team AI yet. Team members can't open
projects until you add one.** and **Add a DeepSeek key** (see
[team AI access](team-ai-access.md)); from chat's Models it opens AI setup on
the team step. When a Workspace-use model is already connected it adds **Or
choose a Workspace-use model you already connected below.** with the Colleague
and Quick helper pickers; Fix it with AI and Explain & check show their default
**Same as** lines, saved with the first choice.

## Same as

A helper can follow another role. It shows one quiet line, for example **Same as
Senior · Opus 5.5 · High**, with **Change**. By default the owner's Colleague
follows Senior, Fix it with AI follows Junior and Explain & check follows Quick
helper; the team's Fix it with AI follows the team's Colleague and Explain &
check follows its Quick helper. A followed role changes with the role it
follows.

**Change** opens that row's model and thinking pickers with the followed
choice; saving makes it the row's own choice. A row with its own choice offers
**Use Senior's model** (or the role it would follow) to follow again.

## Model, thinking and Runs in

Each row shows its model and thinking, for example **Opus 5.5 · High**. Pick a
model from the list: each item shows the model, its provider and an amber
**Personal use** badge for a personal plan (see
[personal-use subscriptions](ai-personal-use.md)). **Recommended** marks the
suggested model; unavailable choices show their reason and cannot be chosen.
Type to search. Choose thinking in the separate thinking control beside it.

The tool a model runs in appears only when it is not the usual one, for example
**DeepSeek V4 Pro · runs in Codex**. **Advanced** under a row appears only when
there is something to see:

- A subscription model runs in its own tool, with no choice: **Runs in Claude
  Code — required by your Claude plan.** or **Runs in Codex — required by your
  ChatGPT plan.**
- A key model connected in more than one tool shows **Runs in** with one option
  per connected tool (**Claude Code**, **Codex**, **OpenCode**) and
  **Recommended** on the usual one: Claude Code for DeepSeek, Codex for an
  OpenAI key and the GLM Coding Plan, OpenCode for the free GLM option, an
  Anthropic key and other OpenCode providers.
- When the provider's key is connected in only some tools, **Connect [provider]
  in another tool** opens **Add a connection** (from chat's Models, AI setup
  on that provider).

Choosing another model keeps the row's tool when the new model runs there, and
otherwise uses the new model's usual tool.

## Recommendations and saving

Roles nobody chose get recommended models when an AI is first connected,
preferring Claude Code, then Codex/OpenAI, DeepSeek and GLM among models you may
use. The owner's gold standard is Opus 5.5 · High for Senior, Opus 5.5 · Medium
for Junior and Haiku 5.5 · Low for Router and Quick helper; the team's is
DeepSeek V4 Pro · High for Colleague and DeepSeek V4.1 Flash · Low for Quick
helper. Connecting or reconnecting never replaces saved choices.

When recommendations differ from saved choices, **Review recommendations**
lists the changes; **Apply to form** puts them in the form, then **Save**.
**No recommended changes** means the choices already match. While Vibe64 checks
the new choices it shows **Checking access…**. **Cancel** discards the draft.
If Models changed in another tab, use **Reload current choices** and review
your kept draft before saving. Changes apply to future work, not to a running
agent.

After connecting a provider, **[provider] connected** may suggest changes with
**Current** and **Suggested**: select the ones you want and choose **Apply
[number] changes**, or **Keep current models**. **Configure AI setup** opens
Models.

## Main AI

**Main AI** is the provider behind your Senior. **Your AI setup** reads
**Currently using · Main AI: [provider]**, adding the tool when it is not the
provider's own, for example **Main AI: DeepSeek, via Claude Code**. **Use as
main AI** on another card moves Senior, Junior, Router and Quick helper to that
provider in the tool it is connected through (see
[AI onboarding](ai-onboarding.md#redo-with-an-existing-setup)).

After you save a different tool or model for Senior or Junior, here or with
**Use as main AI**, an unfinished goal (except one on a Custom model) is
cancelled the next time it would continue; its chat says so, and you start the
goal again on the new main AI (see [Goals and model
changes](coding-agent-goals.md)). A thinking-level-only change does not. The crown and **Recommended** ribbon stay on Claude's card; they
never mean "in use".

## Colleague's model

Each person's Colleague starts on their setup's Colleague model: the owner's
follows Senior, team members use the team's Colleague. Anyone can change their
own Colleague's model from Colleague's model menu; that choice is theirs alone
and does not change Models. Team members see the note **Change your own
Colleague's model from Colleague's menu.** Colleague needs no setup step of its
own: if the roles were never saved, its first message saves the recommended
models. Colleague says it has **no usable AI model** only when none can serve
it; connect an AI or choose an available model in Models, then send again.

Explain & check also reviews **Check my work** on a lesson's review step on
your own account; without an available model the review says so and records
nothing.

## Desktop and phone

On a desktop each row has its label on the left and its pickers on the right. On
a phone (under 600 px) rows stack label, description, model, thinking and
Advanced, and Save/Cancel stay at the bottom.

## What Colleague can do

Colleague can explain the roles and setups, read the current choices, list the
engines, providers and models available to you, open AI
Accounts and save supported model changes when the owner explicitly asks. It
offers help without changing anything for a how-to question. Team members'
Colleague can explain the team setup but cannot change it.
