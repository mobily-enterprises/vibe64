# Check that this installation is ready (Health)

**Dashboard → Health** (the **Studio Health** page) runs this installation's readiness checks and shows each
one as pass or fail, with what was expected and what was observed. Use **Refresh**
to run them again after fixing something. On a phone, open Dashboard, then choose
**Health** from the section menu.

| Check | Group | What a failure means |
| --- | --- | --- |
| Workspace services | Studio | The Vibe64 installation or its project list cannot be read. |
| AI connection | Credentials | No AI provider is connected; open **Account settings → AI Accounts**. |
| Node.js, Git, GitHub CLI, ripgrep, Codex CLI, Genesis | Runtime | That program is missing or the wrong version on this machine; install it with the system's normal installer. |
| Playwright runtime, Pinned browser | Browser | Only automated browser tests need these; other work is unaffected. |

GitHub sign-in is not a Health check. **Account settings → GitHub** shows the
**GitHub Connection** card: **Connection ready** means Vibe64 can use GitHub.
That card also holds **Git user.name**, **Git user.email** and **Save Git identity**.

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
