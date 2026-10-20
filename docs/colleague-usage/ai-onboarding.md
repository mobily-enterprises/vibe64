# Set up your AI (AI onboarding)

Vibe64 works best with a frontier model. AI onboarding is a short full-screen
flow that explains why and helps you connect one: Claude (recommended), Codex,
DeepSeek or GLM, or the free option, GLM-4.7 Flash with a free Z.AI account.
It uses the same sign-in, key and Model routing steps as **AI Accounts**; it
never disconnects anything. Vibe64 includes no AI of its own: without a
connected AI, Colleague, sessions and background helpers (prompt hints, titles)
do not run, and Colleague shows **Set up your AI**.

## When it appears

- When the editor opens and no AI is connected (a Claude or Codex sign-in, a
  DeepSeek or GLM key, including the free Z.AI key, or another OpenCode key).
- It opens by itself at most once per page load, and not when AI status could
  not load, another dialog is open, you are in Learning, or you chose
  **Set up later** in this browser within the last 24 hours.
- In a hosted workspace only the owner sees it, because only the owner can
  connect AI.

Open it again at any time from the account menu: select the account button at
the top right (**Account menu**), then **Redo onboarding**. The same menu holds
**Account settings**. **Redo onboarding** is also at the top of **Account
settings → AI Accounts**. While no AI is connected (an expired
sign-in or key that needs reconnecting does not count), AI Accounts also shows
**Give Vibe64 a brilliant mind** with **Set up your AI**, Colleague shows a
small crowned **Set up your AI** note, and the top bar shows a gold crowned
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
(**Our honest advice: Claude.**). Every card shows three facts with a
five-segment meter (low ratings in a warning tone; hover a meter for its
rating), then the plan: its official name and price first, our budget advice
beneath:

1. **Claude** (crown, gold **Recommended** ribbon): very high intelligence, very
   generous quota, very high speed. **Claude Pro, $20/month**; budget about
   $30/month: Pro plus extra usage when you need it. **Coding a lot? Max ·
   $100/month.**
2. **Codex** (OpenAI): very good intelligence, with quota and speed issues; hits
   limits on long sessions. **ChatGPT Pro, $100/month**; budget about $100/month
   for basic coding. **Heavy use: $200/month.**
3. **DeepSeek**: cheap, pay as you go (cost grows with work), weaker on long
   coding tasks. **Prepaid API credit, pay as you go**; budget about $20 to
   start. It works, but you will notice the gap: spending $20 a month, Claude
   gives a far better experience for about the same.
4. **GLM** (Z.ai): a budget subscription. **GLM Coding Plan, from $18/month**;
   budget about $30/month for daily coding. It works, but there is no point in
   getting it if you can get Claude for the same price. Below the plan the card
   shows **Free option: GLM-4.7 with a free Z.AI account**: Z.AI's regular API
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
one column with two steps. Step 1, **Get a plan**, repeats the budget advice
with the **Open [site]** button (**Already subscribed** or, for DeepSeek,
**Already have credit** if you came from the Connect link). Step 2 holds the
normal AI Accounts setup directly:

- **Claude**: **Sign in with Claude**, using the Claude account that has your
  plan, then paste the code it shows.
- **Codex**: **Sign in with ChatGPT**. In ChatGPT's Security settings turn on
  **Enable device code authorization for Codex**, then sign in and enter the
  short code.
- **DeepSeek**: **Paste your DeepSeek API key**, then **Check and connect**.
- **GLM**: **Paste your Z.ai Coding Plan key** (create it on Z.ai under Personal
  Coding Plan → Plan Overview), then **Check and connect**.
- **GLM-4.7 Flash (free)**: **Paste your Z.AI API key** (Z.AI's API Keys page),
  then **Connect**. Vibe64 checks it with one tiny free GLM-4.7 Flash request
  before saving it. This key is a regular Z.AI API key, not a Coding Plan key.

Each choice runs through a program installed on this computer: Claude through
**Claude Code**, Codex, DeepSeek and GLM through **Codex**, and the free GLM-4.7
Flash through **opencode**. If that program is missing, Step 2 shows a warning
instead of the sign-in or key form:

- **[Claude Code, Codex or opencode] isn't installed on this computer**, with its
  official one-line install command, a **Copy** button and **Other ways to install**.
  Open a terminal on this computer, paste the command and press Enter, then choose
  **Check again**. You run the command yourself.
- **[Program] didn't start**: it is installed but failed to run. Choose **Check
  again**; if it keeps failing, reinstall it. Its own error output is under
  **Details**, collapsed.

Both warnings also offer **Choose another AI**. See
[AI accounts](ai-accounts-and-routing.md#install-claude-code-codex-or-opencode-first)
for the install commands and where Vibe64 looks for these programs.

DeepSeek and the GLM Coding Plan connect through Codex; the free GLM-4.7 Flash
option connects through OpenCode and serves the whole workspace. Use **Back** (above the header on a
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
[provider] · [model]** and **Change it any time in Account settings → AI
Accounts** (hosted: **your account menu**). Otherwise the screen shows
**Colleague: still using [model]** with **Use [provider] for Colleague**.
Choose **Start building** (the bottom bar on a phone) to close; Colleague opens
with its message box ready so you can ask it to build your first page. In a hosted workspace, a personal subscription (Claude, Codex, GLM)
serves only the owner; members need a Workspace-use connection such as
DeepSeek.

If the provider connected but no model is ready yet, Connect shows **[Provider]
is connected, but no model is ready for Colleague yet.** with **Review model
routing**; choose an available Senior there and save.

## Redo with an existing setup

**Your AI setup** starts with a strip of the connected providers' marks. When
Colleague uses one of them it reads **Currently using · Main AI: [provider]**
with the only **Keep using [provider]** button; otherwise it reads **Connected
· [providers]** with **Choose a main AI below. We recommend Claude.** Connected
cards have a green outline with a **Connected** badge (**Connected · in use**
for the main AI; hosted adds **Workspace use** or **Personal use**), no plan or
sign-up offer, and **Manage in AI Accounts**, which closes the flow and opens
AI Accounts; on a phone they stay expanded. Claude's card adds **Upgrade your
experience** when you use another AI. Choose **Use [provider] as my main AI**
to switch, or **Get** another provider to add it. When switching would replace
the model Vibe64 builds with, **Build with [provider]?** offers two choices:
**Use [provider] for building** applies the suggested routing and moves
Colleague; **Keep [current] for building** leaves routing as it is. **Show
details** lists each change (Building, Quick tasks) with current and suggested
models. When nothing is set for building yet, the suggestions apply without
asking. Nothing is removed; remove a connection with **Manage** in AI
Accounts.

## Closing and recovery

**Set up later** (next to **Choose my AI** on the first screen, then at the top
right; on a phone in the bottom bar of the first screen, then below the cards
and below the connect steps) closes the flow and keeps it from opening by itself in this browser for 24 hours. The
close button or Escape just closes it. While a sign-in, key check or routing
save runs, closing and **Back** wait for it to finish.

- **We couldn't check your current AI connections.** Use **Try again**;
  connecting still works, but Connected badges are hidden until status loads.
- Sign-in and key errors are the same messages as in AI Accounts (for example
  Z.AI overload or insufficient balance); retry the same step.
- A hosted member who reaches the flow sees **Only the workspace owner can
  connect AI accounts.** with **Close**.

## Desktop and phone

On a desktop Claude spans the top of the choice screen with the others in a row
below, their plans and buttons lined up. On a phone everything is one column:
Claude is expanded, the other cards are compact rows you tap to expand, the top
bar holds only the back arrow or wordmark, the step dots and close, and
**Choose my AI**, **Set up later** and the "change it any time" note sit in a
bar at the bottom of the first screen. Motion (the crown's glint, the card
stack, the success glow) is turned off when your device asks for reduced
motion.

## What Colleague can do

Colleague can explain these screens, compare the providers and offer to open
the flow. Choosing a plan, paying, signing in, entering a key and approving
routing remain your steps; never paste a key into chat.
