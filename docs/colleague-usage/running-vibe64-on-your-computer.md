# Running Vibe64 on your computer

Start Vibe64 from a terminal in the folder you want to work on:

```sh
npx vibe64
```

Vibe64 opens in your browser. To start it for a different folder, run
`npx vibe64 --project /path/to/folder`. To start it without opening a browser,
run `PORT=3001 npx vibe64 --no-open` and open `http://127.0.0.1:3001` yourself.

Nothing needs configuring. Vibe64 runs as you, with your own tools and folders.

Setting up a computer for the first time? Follow the step-by-step guide for
yours: [Linux](set-up-linux.md) (Ubuntu, Debian, Fedora, Arch),
[macOS](set-up-macos.md) or [Windows](set-up-windows.md) (through WSL). Each
covers Node.js, Git, an AI tool, project languages, build tools and database
servers, and the **Other ways** links on tool rows open the matching section.

## Tools Vibe64 uses

Vibe64 runs the tools already installed on your computer: the ones your
terminal finds on its `PATH`, plus Homebrew's `/opt/homebrew/bin` on macOS.
That includes Node.js, npm, Git and any language tools your projects need.
Your own installs come first: `~/.local/bin`, mise's shims folder
(`~/.local/share/mise/shims`) and the Claude Code, opencode, rustup and Bun
folders are searched before the system folders, so `mise use -g python@3.13`
beats an older system Python even before your shell profile is reloaded. On
Debian and Ubuntu the newest `/usr/lib/postgresql/<version>/bin` is added, and on
macOS Homebrew's PostgreSQL and MariaDB folders, so their programs are found.
Install or upgrade tools the way you normally would; Vibe64 uses the new version
the next time it runs a command.

Vibe64 needs Node.js (the version it declares), Git and one AI tool. Everything
else depends on the project: a tool row appears only where a step needs it, for
example after **Preparing workspace** fails (see
[Project language tools](project-language-tools.md)).

On native Windows, `npx vibe64` stops and explains that Vibe64 runs on Windows
inside WSL2 (Ubuntu), with a link to [Set up Windows](set-up-windows.md). With
the wrong Node.js version it stops and shows the mise command that installs the
right one, with a link to the guide's Node.js step: mise must also be added to
your shell before a new terminal finds the new Node.js.

- **AI agents.** Claude Code, Codex and opencode are used through their own
  commands, so each must be installed on this computer before you can use it.
  See [AI accounts](ai-accounts.md) for what to install and how to
  check again.
- **npm global installs** go wherever your own npm configuration puts them.
- **Playwright** uses its own browser cache. If **Health** reports that
  Playwright or its Chromium is missing, install Playwright, then run
  `playwright install chromium`. The coding agent's Preview browser checks use
  the project's own Playwright when it has one, otherwise the `playwright`
  command installed on this computer (for example `npm install -g playwright`).
  A Django, Rails or Spring Boot project therefore needs no Node.js packages
  for these checks.

## Git

Vibe64 keeps each project's history with Git (2.28 or newer).

- **Git missing or too old.** The repository button at the top of a project
  says **Git needed** (or **Update Git**). Open it for the install command for
  this computer, with a copy button; after installing, press **Check again**.
- **A folder without Git.** The button says **No Git yet**. Open it and choose
  **Start version control here** to start Git in that folder. Vibe64 never does
  this by itself, and nothing is uploaded.
- **Your name on commits.** Commits use the name and email from your own Git
  settings. If Git has none, they are saved with a stand-in name ending in
  “via Vibe64”, and **Health** and the Save result show the two
  `git config --global` lines to set yours. Those lines take effect on the
  next command; a name set some other way (an included file, or one
  repository's own settings) can take up to 30 seconds to be used.
- **Signed commits.** If your Git signs every commit (`commit.gpgsign`) and the
  key needs a passphrase, Vibe64 can't type it. Make one signed commit in a
  terminal to unlock the key, then try again. Vibe64 doesn't change the setting.

## Where Vibe64 keeps things

| What | Linux | macOS |
|---|---|---|
| Projects Vibe64 creates for you | `~/Vibe64` | `~/Vibe64` |
| Vibe64's own data (sessions, settings, history) | `~/.local/state/vibe64` (or `$XDG_STATE_HOME/vibe64`) | `~/Library/Application Support/Vibe64` |

Vibe64 creates its data folder (private to you) when it starts, unless you
set `VIBE64_SYSTEM_ROOT` to a folder of your own, which must already exist.
A folder you open with `npx vibe64` stays where it is; Vibe64 does not move it.

### Moving data from an earlier version on macOS

Earlier versions kept data in `~/.local/state/vibe64` on macOS too. If that
folder exists and the new one does not, Vibe64 stops at startup and prints the
exact command to move it, for example:

```sh
mv ~/.local/state/vibe64 ~/Library/Application\ Support/Vibe64
```

Run the printed command, then start Vibe64 again. Vibe64 never moves the folder
itself. To keep using the old location instead, start Vibe64 with
`VIBE64_SYSTEM_ROOT` set to it.

## Colleague

Colleague can explain where Vibe64 keeps things, which tools it uses and every
step of the setup guides. It can run **Health**, check whether a named tool runs
now, check a project's database server and save non-secret connection values
in **Env** when you ask. Installing tools, editing shell files, moving folders
and restarting Vibe64 happen in your own terminal; Colleague cannot run them for
you and never uses `sudo`.
