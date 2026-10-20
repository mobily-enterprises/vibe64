# Set up your AI (AI onboarding)

Vibe64 works best with a frontier model. AI onboarding is a short full-screen
flow that explains why and helps you connect one: Claude (recommended), Codex,
DeepSeek or GLM. It uses the same sign-in, key and Model routing steps as
**AI Accounts**; it never disconnects anything.

## When it appears

- When the editor opens and no AI of your own is connected (a Claude or Codex
  sign-in, a DeepSeek or GLM key, or an OpenCode key). The included Big Pickle
  does not count.
- It opens by itself at most once per page load, and not when AI status could
  not load, another dialog is open, you are in Learning, or you chose
  **Set up later** in this browser within the last 24 hours.
- In a hosted workspace only the owner sees it, because only the owner can
  connect AI.

Open it again at any time from the account menu: select the account button at
the top right (**Account menu**), then **Redo onboarding**. The same menu holds
**Account settings**. **Redo onboarding** is also at the top of **Account
settings → AI Accounts**. While no AI of your own is connected (an expired
sign-in or key that needs reconnecting does not count), AI Accounts also shows
**Give Vibe64 a brilliant mind** with **Set up your AI**, and Colleague shows a
small crowned **Set up your AI** note. Each opens the flow at the provider
choice, closing Account settings first; closing the flow returns focus to the
account button. While AI Accounts is saving, signing in or removing something,
the flow waits: these entries do nothing until it finishes.

## Screen 1: why it matters

**First, give Vibe64 a brilliant mind.** explains that the connected AI does
the thinking and that frontier models make a large difference. Choose **Choose
my AI** to continue, or **Set up later**.

## Screen 2: choose your AI

**Pick the AI behind Vibe64** ranks the providers by how good Vibe64 feels with
each:

1. **Claude** (crown, **Recommended**): very high intelligence, very generous
   quota, very high speed. Recommended: $30/month for basic coding; Claude Max
   at $100/month for a lot of good coding.
2. **Codex**: very good intelligence, with quota and speed issues. Recommended:
   ChatGPT Pro, $100/month for basic coding, $200/month for a lot of coding.
3. **DeepSeek**: cheap, pay as you go, weaker on long coding tasks. Recommended:
   top up $20 of API credit. If you would spend that every month, Claude gives a
   far better experience for about the same.
4. **GLM** (Z.AI GLM Coding Plan): a budget subscription. Recommended: the
   $30/month plan, but there is no point in getting it if you can get Claude for
   the same price.

Prices are set by each provider and can change. You pay the provider directly;
Vibe64 never resells AI.

Each card offers **Get [provider]**, which opens the provider's site in a new
tab and moves to Connect, and **I already have [provider], connect**, which goes
straight to Connect.

## Screen 3: connect

**Connect [provider]** shows a checklist (beside the form on a desktop, above it
on a phone): get a plan with the **Open [site]** button, then the sign-in steps.
The form is the normal AI Accounts setup:

- **Claude**: sign in with your Claude account, then paste the code it shows.
- **Codex**: in ChatGPT's Security settings turn on **Enable device code
  authorization for Codex**, then log in with ChatGPT and enter the short code.
- **DeepSeek**: create an API key on DeepSeek, paste it and check it.
- **GLM**: create a Coding Plan API key on Z.AI (Personal Coding Plan → Plan
  Overview), paste it and check it.

DeepSeek and GLM connect through Codex. Use **Back** (the arrow at the top left
on a phone) to return to the provider list. Keys are stored privately outside
your projects and never shown again.

## Success

**[Provider] is connected** appears once the connection is saved and a Senior
model is ready. On first setup Colleague switches to the new AI and the screen
says which model it now uses; otherwise it shows **Colleague: still using
[model]** with **Use [provider] for Colleague**. Choose **Start building** to
close. In a hosted workspace, a personal subscription (Claude, Codex, GLM)
serves only the owner; members need a Workspace-use connection such as
DeepSeek.

If the provider connected but no model is ready yet, Connect shows **[Provider]
is connected, but no model is ready for Colleague yet.** with **Review model
routing**; choose an available Senior there and save.

## Redo with an existing setup

**Your AI setup** shows what is connected: such cards carry **Connected** and
**Connected through [orchestrator]**. Choose **Keep using [provider]** to keep
your main AI, **Use [provider] as my main AI** to switch (Vibe64 first shows
the routing changes for review, then moves Colleague), or **Get** another
provider to add it. Nothing is removed; remove a connection with **Manage** in
AI Accounts.

## Closing and recovery

**Set up later** (top right on a desktop, bottom bar on a phone) closes the
flow and keeps it from opening by itself in this browser for 24 hours. The
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
below. On a phone everything is one column: Claude is expanded, the other cards
are compact rows you tap to expand, and **Choose my AI** and **Set up later**
sit in a bar at the bottom. Motion is reduced when your device asks for it.

## What Colleague can do

Colleague can explain these screens, compare the providers and offer to open
the flow. Choosing a plan, paying, signing in, entering a key and approving
routing remain your steps; never paste a key into chat.
