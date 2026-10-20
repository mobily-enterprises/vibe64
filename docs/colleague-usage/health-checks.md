# Check that this installation is ready (Health)

**Dashboard → Health** (the **Studio Health** page) runs this installation's readiness checks and shows each
one as passing or needing attention, with what was expected and what was observed. Use **Refresh**
to run them again after fixing something. On a phone, open Dashboard, then choose
**Health** from the section menu.

| Check | Group | What a failure means |
| --- | --- | --- |
| Workspace services | Studio | The Vibe64 installation or its project list cannot be read. |
| Tools | Runtime | Always passes. It says where Vibe64's tools come from: **Using your installed tools** (the programs installed on this computer) or **Pinned runtime packs** (versions the host provides). |
| AI connection | Credentials | No AI provider is connected; open **Account settings → AI Accounts**. |
| Node.js, Git, GitHub CLI, ripgrep, Genesis | Runtime | That program is missing or the wrong version on this machine; install it with the system's normal installer. With your installed tools, Node.js must match the major version Vibe64 declares (shown in the check). |
| Claude Code, Codex, opencode | AI tools | That AI tool isn't installed on this computer, or it didn't start. A missing tool shows its official install command; each is needed only for the AI that uses it. |
| Playwright runtime, Pinned browser | Browser | Only automated browser tests need these; other work is unaffected. |

GitHub sign-in is not a Health check. **Account settings → GitHub** shows the
**GitHub Connection** card: **Connection ready** means Vibe64 can use GitHub.
That card also holds **Git user.name**, **Git user.email** and **Save Git identity**.

A missing AI tool also appears in **Account settings → AI Accounts** and in AI onboarding,
with a **Copy** button for the install command and **Check again**. When Vibe64 starts, it
also prints one line for each AI tool it can't find.

Health only reads. It never installs software, signs in or repairs anything, and
a pass is not proof that a particular project builds.

## Ask Colleague

Ask Colleague "check my setup" (or similar). Colleague runs the same Health checks
and tells you which ones fail and what to do next for your system. It can open
**Account settings** for you. Installing programs, signing in to GitHub or an AI
provider, and entering keys are things you do yourself; never paste a key or
password into chat. Long command output stays on the Health page; Colleague sees a
short summary of each check.

A setup lesson in Learning may walk through some of these checks one step at a
time; the installed lesson's steps say which.
