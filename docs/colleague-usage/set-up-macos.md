# Set up a Mac for Vibe64

A step-by-step setup for running Vibe64 on your own Mac. Do the steps up to
**An AI tool** once. The project steps only matter when a project needs them, and
Vibe64 tells you when: a row with the exact command appears where the work
needs the tool.

Paste each command into **Terminal** (in Applications → Utilities) and press
Enter. A command that asks for your Mac password shows nothing while you type;
press Enter when done.

## Basic tools

Apple's command line tools give you Git, a compiler and Make:

```sh
xcode-select --install
```

A window opens; choose **Install** and wait for it to finish. Check:
`git --version` prints a version. Until they are installed, `git`, `python3`
and `cc` on a Mac only open that install window, so Vibe64 shows this one row
first and checks nothing else that depends on it.

## Homebrew

[Homebrew](https://brew.sh/) installs the programs that need more than your
home folder, such as database servers. Its first install asks for your Mac
password, so use an administrator account:

```sh
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

When it finishes, make it available in every terminal:

```sh
echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile
```

That is the folder on Apple silicon Macs; Homebrew prints the right line for
your Mac at the end of its install, so you can copy it from there. After this
first install, `brew install …` needs no password. Homebrew supports macOS 15
(Sequoia) and newer.

## Node.js and mise

Vibe64 needs **Node.js 26**. Install it with [mise](https://mise.jdx.dev/),
which installs languages into your home folder without a password:

```sh
curl -fsSL https://mise.run | sh
echo 'eval "$(~/.local/bin/mise activate zsh)"' >> ~/.zshrc
echo 'eval "$(~/.local/bin/mise activate zsh --shims)"' >> ~/.zprofile
~/.local/bin/mise use -g node@26
```

These lines are for zsh, the Mac's standard shell. If you use bash, write
`activate bash` into `~/.bashrc` and `activate bash --shims` into
`~/.bash_profile` instead.

Close Terminal and open it again. Check: `node --version` prints `v26…`. Always
keep the `-g`: without it, mise writes a `mise.toml` file into whatever folder
you are in.

## Start Vibe64

In the folder you want to work on, run `npx vibe64`. See
[Running Vibe64 on your computer](running-vibe64-on-your-computer.md) for the
options and where Vibe64 keeps its data.

## Git

Tell Git who you are, once, so your commits carry your name:

```sh
git config --global user.name "Your Name"
git config --global user.email "you@example.com"
```

Without them Vibe64 still saves your work, using a stand-in name ending in
“via Vibe64”, and **Health** reminds you. To work with GitHub, connect it in
**Account settings → GitHub**; signing in fills in your name and email only
when Git has none.

## An AI tool

Vibe64 works through one AI tool on this computer. One is enough; each installs
into your home folder:

| AI | Command |
|---|---|
| Claude Code | `curl -fsSL https://claude.ai/install.sh \| bash` |
| Codex (ChatGPT and OpenAI keys) | `curl -fsSL https://chatgpt.com/codex/install.sh \| sh` |
| opencode (providers connected through OpenCode) | `curl -fsSL https://opencode.ai/install \| bash` |

Then choose **Set up your AI** in Vibe64 and sign in. See
[AI accounts](ai-accounts.md).

## Project languages

Only when a project needs one. When **Preparing workspace** fails because a
language is missing, the panel shows its row with the command for this Mac.
These install with mise, without a password:

| Language | Command |
|---|---|
| Python | `mise use -g python@3.13` |
| Ruby | `mise use -g ruby@3.4` |
| Java | `mise use -g java@temurin-25` |
| Go | `mise use -g go` |
| Rust | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh` |
| PHP and Composer | `/bin/bash -c "$(curl -fsSL https://php.new/install/mac)"` |

After installing, choose **Check again** on the row; no restart is needed.

The Mac's own Ruby and Python are old, and `/usr/bin/java` only says that no
Java is installed. Vibe64 looks in mise's folders before the system ones, so
the versions you install with mise win; each row shows the version and folder it
found. `brew install ruby` or `brew install python` also work, if you prefer
Homebrew.

## Build tools

Some packages compile native code (Rails gems such as `psych` and `mysql2`,
Python's `mysqlclient`), so they need Apple's command line tools (step one)
and a few libraries. The row is called **Build tools**:

```sh
brew install pkg-config libyaml openssl@3 gmp
```

For MySQL drivers, also run `brew install mariadb`: the drivers build against
it. Don't install `mysql-client` for this; its newer versions can't sign in to
MariaDB users. Vibe64 adds Homebrew's PostgreSQL folder to the PATH of the commands it
runs, so PostgreSQL drivers find what they need in the server you install
below.

## Databases

Only when a project uses MySQL or PostgreSQL. SQLite needs nothing. You run the
database server yourself; one you already have is fine. Vibe64 never starts it
for you.

**Install and start it**, once:

| Database | Command |
|---|---|
| MySQL-compatible (MariaDB) | `brew install mariadb && brew services start mariadb` |
| PostgreSQL | `brew install postgresql@18 && brew services start postgresql@18` |

`brew services` starts the server now and every time you log in. To stop it:
`brew services stop mariadb` (or `postgresql@18`).

**Give the project its own login.** In the failed step's **database server**
panel, choose **Suggest a user and password**, open **Create a login and
database**, copy the command and paste it into Terminal. Then choose **Save
and check**. When the panel says connected, choose **Retry**. See
[Workspace preparation](workspace-preparation.md).

If you already run Oracle MySQL, keep it: put its host, port, user and password
in the panel or in **Env**. Don't install Homebrew's MariaDB next to it; the two
conflict.

## Extras

Nice to have; nothing depends on them.

| Tool | Command |
|---|---|
| GitHub CLI | `brew install gh` |
| ripgrep (faster search) | `brew install ripgrep` |
| Browser for automated checks | `npx playwright install chromium` |

## Check your setup

Open **Dashboard → Health**. The top line says **Vibe64 has what it needs.**
when Node.js, Git and an AI tool all run. Each missing tool shows its command
with a copy button and **Check again**. A tool counts only when it actually
starts, so a broken install shows as **didn't start**, not as ready.

If a tool works in Terminal but Vibe64 can't find it, it is probably installed
somewhere only your interactive shell knows. Check the `mise` and Homebrew
lines above, then start Vibe64 again from a new Terminal window.

## Ask Colleague

Colleague can walk you through any step here and explain what a row or message
means. It can also do the safe parts for you, when you ask:

- check whether a tool runs now (“is Ruby installed?”), or run all of
  **Health**;
- check the project's database server with the current values, and save the
  host, port, database name and user name you tell it into **Env**;
- retry the session's **Preparing workspace**, and open **Health** or **Env**.

You run the install commands yourself, in Terminal: Colleague never uses
`sudo`, never edits your shell files and never installs anything. Never type a
password into chat; enter it in the panel's password field or in **Env**.
