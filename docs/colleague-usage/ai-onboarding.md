# Set up your AI (AI onboarding)

Vibe64 works best with a frontier model. AI onboarding is a short full-screen
flow that explains why and helps you connect one: Claude (recommended), Codex,
DeepSeek or GLM, or the free option, GLM-4.7 Flash with a free Z.AI account.
It uses the same sign-in, key and model steps as **AI Accounts**; it
never disconnects anything. Vibe64 includes no AI of its own: without a
connected AI, Colleague, sessions and background helpers (prompt hints, titles)
do not run, and Colleague shows **Set up your AI**.

## When it appears

- When the editor opens and no AI is connected (a Claude or Codex sign-in, a
  DeepSeek or GLM key, including the free Z.AI key, or another OpenCode key).
- It opens by itself at most once per page load, and not when AI status could
  not load, another dialog is open, you are in Learning, or you chose
  **Set up later** in this browser within the last 24 hours.
- Only someone who may connect AI sees it.

Open it again at any time from the account menu: select the account button at
the top right (**Account menu**), then **Redo onboarding**. The same menu holds
**Account settings**, whose **AI Accounts** tab is this same screen without the
**Why** step: the provider cards, **Manage** and **Advanced**, with its own
**Back** and **Done** (Done returns to the overview). While no AI is connected
(an expired sign-in or key that needs reconnecting does not count), AI Accounts
shows **Pick the AI behind Vibe64**, Colleague shows a small crowned **Set up your AI** note, and the top bar shows a gold crowned
**Set up AI** button beside the account button (smaller on a phone). While that
button shows, the account button stays neutral.
Each opens the flow at the provider choice, closing Account settings first; closing the flow returns focus to the
account button. While AI Accounts is saving, signing in or removing something,
the flow waits: these entries do nothing until it finishes.

## Screen 1: why it matters

**First, give Vibe64 a brilliant mind.** says frontier AI makes Vibe64
dramatically better and lists three things it does (plans before it codes,
fixes its own bugs, understands your whole app). Beside it is a stack of the
four providers, each with an intelligence meter, Claude crowned on the front
card (on a phone, the crowned Claude tile sits above the headline). Choose
**Choose my AI** to continue, or **Set up later**. Three dots at the top show
the step (1 of 3).

## Screen 2: choose your AI

**Pick the AI behind Vibe64** ranks the providers by how good Vibe64 feels
(**Our honest advice: Claude.**). The cards are stacked in one column, Claude
first with a wide gold crown on its tile. Every card shows three facts with a
five-segment meter (low ratings in a warning tone; hover a meter for its
rating), then the plan: its official name and price first, our budget advice
beneath where it differs from the price (Claude and Codex have none):

1. **Claude** (crown, gold **Recommended** ribbon): very high intelligence, very
   generous quota, very high speed. **Claude Pro, $20/month.** **Coding a lot?
   Max · $100/month.**
2. **Codex** (OpenAI): very good intelligence, with quota and speed issues; hits
   limits on long sessions. **ChatGPT Pro, $100/month.** **Coding a lot?
   $200/month.**
3. **DeepSeek**: cheap, pay as you go (cost grows with work), weaker on long
   coding tasks. **Prepaid API credit, pay as you go**; budget about $20 to
   start. It works, but you will notice the gap: for $20 a month, Claude Pro
   gives a far better experience.
4. **GLM** (Z.AI): a budget subscription. **GLM Coding Plan, from $18/month**;
   budget about $30/month for daily coding. It works, but there is no point in
   getting it when Claude Pro is $20/month. Below the plan the card
   shows **Free option: GLM-4.7 Flash with a free Z.AI account**: Z.AI's regular API
   serves GLM-4.7 Flash free of charge (no plan or credit). It is good for
   trying Vibe64; expect slower, simpler work than the paid plans.

Prices are set by each provider and can change. You pay the provider directly;
Vibe64 never resells AI.

Each card offers **Get [provider]**, which opens the provider's site in a new
tab and moves to Connect, and **Already subscribed? Connect** (Claude, Codex) or
**Already have a key? Connect** (DeepSeek, GLM), which goes straight to Connect.
The **Get** button's weight follows the rank: filled for Claude, tonal for
Codex, outlined for DeepSeek and GLM. The GLM card's free option has its own
**Start free** (opens Z.AI's API Keys page in a new tab and moves to Connect)
and **Already have a key? Connect**. Once the free key is connected the line
reads **Connected.**, and during a redo it offers **Use the free option as my
main AI**.

## Screen 3: connect

**Connect [provider]** shows the chosen mark with the plan name and price, in
one column with two steps. Step 1, **Get a plan**, repeats any budget advice
with the **Open [site]** button (**Already subscribed** or, for DeepSeek,
**Already have credit** if you came from the Connect link). Step 2 holds the
normal AI Accounts setup directly:

- **Claude**: **Sign in with Claude**, using the Claude account that has your
  plan, then paste the code it shows.
- **Codex**: **Sign in with ChatGPT**. In ChatGPT's Security settings turn on
  **Enable device code authorization for Codex**, then sign in and enter the
  short code.
- **DeepSeek**: **Paste your DeepSeek API key**, then **Check and connect**.
- **GLM**: **Paste your Z.AI Coding Plan key** (create it on Z.AI under Personal
  Coding Plan → Plan Overview), then **Check and connect**.
- **GLM-4.7 Flash (free)**: **Paste your Z.AI API key** (Z.AI's API Keys page),
  then **Connect**. Vibe64 checks it with one tiny free GLM-4.7 Flash request
  before saving it. This key is a regular Z.AI API key, not a Coding Plan key.

Each choice runs through a program installed on this computer: Claude through
**Claude Code**, Codex and GLM through **Codex**, DeepSeek through **Claude
Code**, and the free GLM-4.7
Flash through **opencode**. When any of these programs is missing, Vibe64 checks
each one by running it, and the cards show the result before you choose:

- A card whose program runs here says **Ready on this computer** under its buttons.
- A card whose program is missing is greyed. Its main button is **Install
  [program] first**, which opens the install row inside the card: one sentence,
  the install command with a copy button, **Check again** and **Other ways**.
  **Get [provider]** (the subscription page) and **Already subscribed? Connect**
  stay below it as links. The order is install, then subscribe, then sign in.
  Once **Check again** finds the program, the card returns to full colour. The
  free GLM option has its own **Install opencode first** button.
- When the recommended Claude card still needs installing but another card's
  program runs here, a line above the cards says **Ready on this computer:
  [program]** with **Use [provider]**, which opens that card's connect step.
- When no AI program is on this computer at all, every card is greyed with
  **Install [program] first**, and the heading adds **No AI tool is on this
  computer yet. Install the one your AI needs first.**

When every program is installed (or the computer's programs are provided for
you), the cards look as usual with no install rows. If you connect anyway while
the program is missing, Step 2 shows a warning instead of the sign-in or key form:

- **[Claude Code, Codex or opencode] isn't installed on this computer**, with its
  official one-line install command, a **Copy** button and **Other ways to install**.
  Open a terminal on this computer, paste the command and press Enter, then choose
  **Check again**. You run the command yourself.
- **[Program] didn't start**: it is installed but could not be run at all. Choose
  **Check again**; if it keeps failing, reinstall it. Its own error output is under
  **Details**, collapsed. A program that runs but reports a sign-in problem keeps
  the usual sign-in button.

Both warnings also offer **Choose another AI**. See
[AI accounts](ai-accounts.md#install-claude-code-codex-or-opencode-first)
for the install commands and where Vibe64 looks for these programs.

### While it works

Every wait in Step 2 shows a spinner on the button you pressed and a line
under it saying what is happening, for example **Starting Claude's sign-in.
This can take up to a minute.** (until **Continue to Claude** is ready),
**Checking your code with Claude.** after **Connect Claude**, **Starting the
sign-in and getting your one-time code.** for Codex, or **Checking the key with
[provider].** for a key. A wait that runs past about 20 seconds adds **Still
working. This is taking longer than usual.**; a sign-in also offers **Start
again** there. After a sign-in is accepted, Step 2 shows **Signed in to
[provider]** with **Setting up [provider] as your main AI…** until the success
screen opens (on a redo, **Checking [provider]…**). If that check fails, its
warning has **Try again**. Waiting for you (open ChatGPT and enter the code)
shows plain text, not a spinner.

DeepSeek connects inside Claude Code (other tools are under **Advanced**), the
GLM Coding Plan through Codex, and the free GLM-4.7 Flash option through
OpenCode. Use **Back** (above the header on a
desktop, the arrow at the top left on a phone) to return to the provider list.
Keys are stored privately outside your projects and never shown again.

## Success

The success screen appears, with the provider's mark arriving in a soft glow,
once the connection is saved and a Senior model is ready. On first setup
Colleague switches to the new AI and says hello: the heading reads
**[Provider] is connected** while a small Colleague card shows typing dots,
then **[Provider] is ready** with its one-line reply and a green check. The
hello is an ordinary Colleague message, so it also appears in Colleague's
conversation. If Colleague cannot reach the provider within about 15 seconds
(for example a bad key or no credit), the heading reads **Almost there** and
the card says **Colleague couldn't reach [provider]** with the reason and
**Retry**, **Check connection** (back to Connect) or **Continue anyway**; the
check appears only after a reply or **Continue anyway**. Below it **Main AI:
[provider] · [model]** (with the tool when it is not the provider's own, for
example **DeepSeek, via Claude Code**) and **Change it any time in Account settings → AI
Accounts**. Otherwise the screen shows
**Colleague: still using [model]** with **Use [provider] for Colleague**.
Choose **Start building** (the bottom bar on a phone) to close; Colleague opens
with its message box ready so you can ask it to build your first page.

The first time you set up your AI (not on a redo, and not in Learn mode) the
success screen also offers **Take a 5-minute tour** beside **Start building**.
It starts the installed course's orientation lesson, **Welcome to Vibe64**, in
Learn mode; **Start building** is the "not now". It is offered only this once;
**Take the tour** in the account menu starts the same lesson at any time.

In Learn mode Colleague's conversation is your teacher's, so setup sends no
hello there: the card says **Your teacher uses [provider] from your next
message**, the check appears at once, and the close button reads **Back to the
lesson** (or **Back to Learn** with no lesson in progress).

If the provider connected but no model is ready yet, Connect shows **[Provider]
is connected, but no model is ready for Colleague yet.** with **Review
models**; choose an available Senior there and save.

## Redo with an existing setup

**Your AI setup** starts with a strip of the connected providers' marks. Main
AI is the provider behind your Senior model. When it is one of them the strip
reads **Currently using · Main AI: [provider]**, adding the tool when it is not
the provider's own (**Main AI: DeepSeek, via Claude Code**), with the only
**Keep using [provider]** button; otherwise it reads **Connected
· [providers]** with **Choose a main AI below. We recommend Claude.** Cards you
use come first. Connected cards have a green outline with a **Connected** badge
(**Connected · in use** for the main AI), no plan or sign-up offer, and **Manage**; on a phone they
stay expanded. A card whose sign-in or key stopped working has an amber outline,
a **Reconnect required** badge and **Reconnect [provider]**, which opens its
connect step. Claude's card adds **Upgrade your experience** when you use
another AI. Choose **Use [provider] as my main AI** (on the other cards **Use as
main AI**) to switch, or **Get** another provider to add it. When switching
would replace the model Vibe64 builds with, **Build with [provider]?** offers
two choices: **Use [provider] for building** applies the suggested models in the
tool the provider is connected through and moves Colleague; **Keep [current]
for building** leaves the models as they are.
**Show details** lists each change (Building, Quick tasks) with current and
suggested models. When nothing is set for building yet, the suggestions apply
without asking. Nothing is removed from the card itself. The crown and
**Recommended** ribbon always stay on Claude's card; they never mean "in use".

Below the cards, **Models** sums up **Senior**, **Junior** and, with a team,
**Team members**; **Review models** opens Models (see
[AI model setups](ai-model-setups.md)).

### Team setup card

In a workspace with team members, once Claude is your connected main AI and the
team setup has no model yet, a card appears above the provider cards: **Let your
team use this workspace**. Your Claude plan is for you only. Add a DeepSeek key
(runs inside Claude Code) and team members get Colleague, Fix it with AI and
helpers. You still approve what they send to main chat.

- **Add a DeepSeek key** opens DeepSeek's connect step, inside Claude Code
  (titled **For team members · runs inside Claude Code**). When the key is
  connected, the team setup fills with recommended DeepSeek models.
- When DeepSeek already works in Claude Code the button reads **Use DeepSeek for
  team members** and fills the team setup at once.
- **Not now** hides the card for 7 days in this browser. **Set up team AI** (on
  the project list) shows it again.
- Afterwards it reads **Team AI is ready**, for example **Team members use
  DeepSeek V4 Pro for Colleague and Fix it with AI, and DeepSeek V4.1 Flash for
  helpers.**, with **Review team models**, which opens Models on **Team
  members**.

If filling fails the card shows the reason; choose the button again. Opening
**Set up team AI** when there is no card to offer opens Models on **Team
members** directly.

### Manage a provider

**Manage** opens a window (full screen on a phone) titled with the provider,
saying which tools it is connected through, for example **Connected through
Claude Code and Codex**, with **Billing & usage** when the provider has an
account page. Each connection is a tile naming the tool (Claude Code, Codex or
OpenCode), the account or billing, the model and the saved key's last
characters, with **Default** on the one used by default. Its buttons:

- **Manage sign-in** (Claude or Codex login) or **Replace key** (a provider
  key); **Reconnect** when it stopped working.
- **Remove**, which asks for confirmation first.

GLM's Manage lists the free Z.AI connection under **Free option**, with the
**Free-only model access** switch (**Unlock all Z.AI models**); turning it on asks
for confirmation because other Z.AI models can use API credit. Close the window
with its close button or Escape; focus returns to **Manage**.

## Closing and recovery

**Set up later** (next to **Choose my AI** on the first screen, then at the top
right; on a phone in the bottom bar of the first screen, then below the cards
and below the connect steps) closes the flow and keeps it from opening by itself in this browser for 24 hours. The
close button or Escape just closes it. While a sign-in, key check or model
save runs, closing and **Back** wait for it to finish.

- **We couldn't check your current AI connections.** Use **Try again**;
  connecting still works, but Connected badges are hidden until status loads.
- Sign-in and key errors are the same messages as in AI Accounts (for example
  Z.AI overload or insufficient balance); retry the same step.
- **Manage** stays on this screen: closing it (its close button or Escape)
  returns to the cards with focus on the **Manage** button you used. While a
  removal, key change or model save runs, Manage cannot be closed.
- Someone who may not connect AI sees **Only the Vibe64 owner can connect AI
  accounts.** with **Close**.

## Desktop and phone

On a desktop the choice screen is one column: Claude's card on top, its plan and
buttons beside its facts, then Codex, DeepSeek and GLM as full-width rows (facts,
plan, buttons), with the GLM free option across the bottom of its row. On a phone
everything is one column too: Claude is expanded, the other cards are compact rows you tap to expand, the top
bar holds only the back arrow or wordmark, the step dots and close, and
**Choose my AI**, **Set up later** and the "change it any time" note sit in a
bar at the bottom of the first screen. **Manage** opens as a centred window on a
desktop and fills the screen on a phone, with its tiles' buttons spread across
the full width. Motion (the crown's glint, the card
stack, the success glow) is turned off when your device asks for reduced
motion.

## What Colleague can do

Colleague can explain these screens, compare the providers and offer to open
the flow. Choosing a plan, paying, signing in, entering a key and approving
model changes remain your steps; never paste a key into chat.
