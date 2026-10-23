# Check that this installation is ready (Health)

**Dashboard → Health** (the **Studio Health** page) shows what this computer has
and what Vibe64 needs from it. Use **Refresh** to run the checks again after fixing
something. On a phone, open Dashboard, then choose **Health** from the section menu.

The top line says **Vibe64 has what it needs.** or how many needed things are
missing, and how many optional extras aren't set up. Only **Needed** checks count.

**Needed** (Vibe64 can't work without these):

| Check | What a failure means |
| --- | --- |
| Node.js | Node.js is missing or not the major version Vibe64 needs (shown in the row). The row shows the install command. |
| Git | Git is missing or didn't start. |
| An AI tool | None of Claude Code, Codex or opencode runs on this computer. One is enough. **Set up your AI** opens AI setup. |
| AI connection | No AI is connected yet. **Set up your AI** opens AI setup (shown on the first AI row that needs it). |
| Vibe64, Genesis | Vibe64's own parts can't be read. This is not something a project setting fixes. |

**Optional** (nice to have; nothing depends on them): GitHub CLI, ripgrep, the AI
tools you don't use, **Your name in Git** and the Playwright browser for automated
browser checks. **Your name in Git** comes first when it needs you; an extra that
simply isn't installed folds to one line, "Not installed", with **How to install**
to open its install command.

A tool counts as there only when it actually runs: Vibe64 starts it and asks for
its version (a few seconds at most), using the same `PATH` your projects use. A file
that exists but doesn't start shows as **didn't start**. A ready tool shows its
version and where it was found, so a wrong pick is easy to spot.

A missing tool shows one sentence, the install command for this computer (Debian,
Ubuntu or WSL; macOS with Homebrew; otherwise mise) with a copy button, **Check
again** and **Other ways**. For Node.js, Git, GitHub CLI, ripgrep, languages and
build tools, **Other ways** opens this computer's setup guide
([Linux](set-up-linux.md), with Fedora and Arch lines, or [macOS](set-up-macos.md));
for AI tools and the Playwright browser it opens the tool's own page. Commands that need `sudo` say: "You'll be asked for
your computer password. Nothing shows while you type." **Check again** spins, then
either turns the row green or says "Still not found. Did the command finish
without errors?" No restart is needed.

**Your name in Git** is a warning, never a failure: Git has no name and email for
you yet, so commits are saved with a stand-in name ending in “via Vibe64”. The row
shows the two `git config --global` lines, with a copy button.

Where the host provides pinned versions, every check is needed and the rows keep
the host's own wording; no install commands appear.

GitHub sign-in is not a Health check. **Account settings → GitHub** shows the
**GitHub Connection** card: **Connection ready** means Vibe64 can use GitHub.
That card also holds **Git user.name**, **Git user.email** and **Save Git identity**.
Connecting GitHub fills in your Git name and email only when Git has none; it
never replaces ones you already set.

When Vibe64 starts in a terminal with no AI tool at all, it prints one plain
message there with the Claude Code install command. It says nothing when one AI
tool is installed.

Health only reads. It never installs software, signs in or repairs anything, and
a pass is not proof that a particular project builds.

## Ask Colleague

Ask Colleague "check my setup" (or similar). Colleague runs the same Health checks
and tells you which ones fail and what to do next for your system. It can also
check single tools on request (“is Ruby installed?”), explain each step of the
setup guides, and open **Account settings** for you. Installing programs, signing in to GitHub or an AI
provider, and entering keys are things you do yourself; never paste a key or
password into chat. Long command output stays on the Health page; Colleague sees a
short summary of each check.

A lesson in Learning may walk through some of these checks one step at a time;
the installed lesson's steps say which.
