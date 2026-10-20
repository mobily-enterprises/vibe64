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
**Give Vibe64 a brilliant mind** with **Set up your AI**, Colleague shows a
small crowned **Set up your AI** note, and the top bar shows a gold crowned
**Set up AI** button beside the account button (just the crown on a phone).
Each opens the flow at the provider choice, closing Account settings first; closing the flow returns focus to the
account button. While AI Accounts is saving, signing in or removing something,
the flow waits: these entries do nothing until it finishes.

## Screen 1: why it matters

**First, give Vibe64 a brilliant mind.** says frontier AI makes Vibe64
dramatically better, beside a stack of the four providers with Claude crowned
on top (above the headline on a phone). Choose **Choose my AI** to continue, or
**Set up later**. Three dots at the top show the step (1 of 3).

## Screen 2: choose your AI

**Pick the AI behind Vibe64** ranks the providers by how good Vibe64 feels with
each. Every card shows three rated facts, a **Suggested budget** and the plan
with its official price:

1. **Claude** (crown, gold **Recommended** badge): very high intelligence, very
   generous quota, very high speed. Suggested budget $30/month (Claude Pro,
   $20/month, for basic coding); $100/month on Claude Max for a lot of good
   coding.
2. **Codex** (OpenAI): very good intelligence, with quota and speed issues; hits
   limits on long sessions. Suggested budget $100/month (ChatGPT Pro) for basic
   coding; $200/month for a lot of coding.
3. **DeepSeek**: cheap, pay as you go (cost grows with work), weaker on long
   coding tasks. Suggested budget: top up $20 of API credit. If you would spend
   that every month, Claude gives a far better experience for about the same.
4. **GLM** (Z.ai GLM Coding Plan, from $18/month): a budget subscription.
   Suggested budget $30/month, but there is no point in getting it if you can
   get Claude for the same price.

Prices are set by each provider and can change. You pay the provider directly;
Vibe64 never resells AI.

Each card offers **Get [provider]**, which opens the provider's site in a new
tab and moves to Connect, and **Already subscribed? Connect** (Claude, Codex) or
**Already have a key? Connect** (DeepSeek, GLM), which goes straight to Connect.

## Screen 3: connect

**Connect [provider]** keeps the chosen card's mark, plan and suggested budget
at the top. Below it a checklist (beside the form on a desktop, above it on a
phone) says how to get a plan with the **Open [site]** button (**Already
subscribed** or, for DeepSeek, **Already have credit** if you came from the
Connect link), then the sign-in steps. The form is the normal AI Accounts
setup:

- **Claude**: **Sign in to Claude** with **Sign in with Claude**, then paste the
  code it shows.
- **Codex**: in ChatGPT's Security settings turn on **Enable device code
  authorization for Codex**, then log in with ChatGPT and enter the short code.
- **DeepSeek**: **Paste your DeepSeek API key**, then **Check and connect**.
- **GLM**: create a Coding Plan API key on Z.AI (Personal Coding Plan → Plan
  Overview), then **Paste your GLM API key** and **Check and connect**.

If the sign-in tool itself cannot run on this machine, the form says **[Claude
or ChatGPT] sign-in isn't available on this machine yet. Try again or choose
another provider.**, with the technical output under **Details**.

DeepSeek and GLM connect through Codex. Use **Back** (the arrow at the top left
on a phone) to return to the provider list. Keys are stored privately outside
your projects and never shown again.

## Success

**[Provider] is ready** appears, with the provider's mark and a check, once the
connection is saved and a Senior model is ready. On first setup Colleague
switches to the new AI and says hello: a small Colleague card shows typing dots,
then its one-line reply (if it doesn't reply in time the card says **Ready when
you are. Say hi in the Colleague panel.**). The hello is an ordinary Colleague
message, so it also appears in Colleague's conversation. Below it **Main AI:
[model] · Change any time in Account settings > AI Accounts** (hosted: **your
account menu**). Otherwise the screen shows **Colleague: still using [model]**
with **Use [provider] for Colleague**. Choose **Start building** (the bottom bar
on a phone) to close. In a hosted workspace, a personal subscription (Claude, Codex, GLM)
serves only the owner; members need a Workspace-use connection such as
DeepSeek.

If the provider connected but no model is ready yet, Connect shows **[Provider]
is connected, but no model is ready for Colleague yet.** with **Review model
routing**; choose an available Senior there and save.

## Redo with an existing setup

**Your AI setup** starts with a **Currently using** strip: the connected
providers' marks, **Main AI: [provider]** and **Keep using [provider]**.
Connected cards have a green outline with a **Connected** badge on the top
border (hosted: **Connected · Workspace use** or **Personal use**); on a phone
they stay expanded. Choose **Keep using [provider]** to keep your main AI,
**Use [provider] as my main AI** to switch, or **Get** another provider to add
it. When switching would change model routing, **Make [provider] your main
AI?** asks one question: **Yes, use [provider]** applies the suggested routing
and moves Colleague; **Keep my current setup** leaves routing as it is. **Show
details** reveals the full routing choices first. Nothing is removed; remove a connection with **Manage** in
AI Accounts.

## Closing and recovery

**Set up later** (next to **Choose my AI** on the first screen, then at the top
right; in the bottom bar on a phone's first screen) closes the flow and keeps it from opening by itself in this browser for 24 hours. The
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
sit in a bar at the bottom of the first screen. Motion is reduced when your device asks for it.

## What Colleague can do

Colleague can explain these screens, compare the providers and offer to open
the flow. Choosing a plan, paying, signing in, entering a key and approving
routing remain your steps; never paste a key into chat.
