# Set up Linux for Vibe64

A step-by-step setup for running Vibe64 on your own Linux computer: Ubuntu and
Debian (also inside WSL on Windows), Fedora and Arch. Do the steps up to **An AI tool**
once. The project steps only matter when a project needs them, and Vibe64 tells
you when: a row with the exact command appears where the work needs the tool.

Commands that start with `sudo` ask for your computer password. Nothing shows
while you type it; press Enter when done. Everything else installs into your
home folder and needs no password.

## Basic tools

Vibe64 needs `curl` and `git`. Most desktops already have them.

| System | Command |
|---|---|
| Ubuntu, Debian, WSL | `sudo apt install curl git` |
| Fedora | `sudo dnf install curl git` |
| Arch | `sudo pacman -S curl git` |

Check: `git --version` prints a version (2.28 or newer).

## Node.js and mise

Vibe64 needs **Node.js 26**. Distribution packages are older, so install it
with [mise](https://mise.jdx.dev/), which installs languages into your home
folder without a password. Install mise:

```sh
curl -fsSL https://mise.run | sh
```

Then add it to your shell, so every terminal (and every program Vibe64 starts)
finds the tools it installs. For **bash** on Ubuntu, Debian and WSL:

```sh
echo 'eval "$(~/.local/bin/mise activate bash)"' >> ~/.bashrc
echo 'eval "$(~/.local/bin/mise activate bash --shims)"' >> ~/.profile
```

On **Fedora and Arch**, use `~/.bash_profile` instead of `~/.profile` in the
second line (those systems read `~/.bash_profile` first). If your shell is
**zsh**, use `activate zsh` and the files `~/.zshrc` and `~/.zprofile`. Other
shells: see mise's [shell setup](https://mise.jdx.dev/dev-tools/shims.html).

Now install Node.js and close the terminal:

```sh
~/.local/bin/mise use -g node@26
```

Open a new terminal. Check: `node --version` prints `v26…`. Always keep the
`-g`: without it, mise writes a `mise.toml` file into whatever folder you are
in.

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
language is missing, the panel shows its row with the command for this
computer. These install with mise, without a password:

| Language | Command |
|---|---|
| Python | `mise use -g python@3.13` |
| Ruby | `mise use -g ruby@3.4` |
| Java | `mise use -g java@temurin-25` |
| Go | `mise use -g go` |
| Rust | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh` |
| PHP and Composer | `/bin/bash -c "$(curl -fsSL https://php.new/install/linux)"` |

After installing, choose **Check again** on the row; no restart is needed.

**Using your system's packages instead.** This works too, but needs a
password and gives older versions.

- Python on Ubuntu, Debian, WSL:
  `sudo apt install python3 python3-venv python3-pip` (without
  `python3-venv`, creating a virtual environment fails with “ensurepip is not
  available”). Fedora: `sudo dnf install python3 python3-pip`. Arch:
  `sudo pacman -S python python-pip`.
- PHP on Ubuntu, Debian, WSL:
  `sudo apt install php-cli php-mysql php-pgsql php-sqlite3 php-xml php-mbstring php-curl php-zip php-intl unzip composer`.
  Fedora:
  `sudo dnf install php-cli php-mysqlnd php-pgsql php-pdo php-xml php-mbstring php-intl php-pecl-zip composer`.
  On Arch, use the php.new line above: Arch's own PHP needs extensions turned on
  by hand.
- Ruby from the system is not recommended: installing gems then needs a password.

## Build tools

Some packages compile native code (Rails gems such as `psych`, `pg` and
`mysql2`, Python's `mysqlclient`), so they need a compiler and a few
libraries. The row is called **Build tools**.

Ubuntu, Debian, WSL:

```sh
sudo apt install build-essential pkg-config libyaml-dev libssl-dev zlib1g-dev libpq-dev default-libmysqlclient-dev libgmp-dev
```

Fedora:

```sh
sudo dnf install gcc gcc-c++ make pkgconf-pkg-config libyaml-devel openssl-devel zlib-ng-compat-devel gmp-devel libpq-devel mariadb-connector-c-devel
```

Arch:

```sh
sudo pacman -S --needed base-devel libyaml openssl zlib gmp postgresql-libs mariadb-libs
```

## Databases

Only when a project uses MySQL or PostgreSQL. SQLite needs nothing. You run the
database server yourself; one you already have is fine. Vibe64 never starts it
for you.

**Install and start it**, once. For MySQL projects, use MariaDB, the
MySQL-compatible server Linux systems ship.

| | MariaDB (for MySQL projects) | PostgreSQL |
|---|---|---|
| Ubuntu, Debian, WSL | `sudo apt install mariadb-server` | `sudo apt install postgresql` |

Fedora, MariaDB:

```sh
sudo dnf install mariadb-server
sudo systemctl enable --now mariadb
```

Fedora, PostgreSQL:

```sh
sudo dnf install postgresql-server
sudo env PGSETUP_INITDB_OPTIONS="--auth-host=scram-sha-256" postgresql-setup --initdb
sudo systemctl enable --now postgresql
```

Arch, MariaDB:

```sh
sudo pacman -S mariadb
sudo mariadb-install-db --user=mysql --basedir=/usr --datadir=/var/lib/mysql
sudo systemctl enable --now mariadb
```

Arch, PostgreSQL:

```sh
sudo pacman -S postgresql
sudo -iu postgres initdb -D /var/lib/postgres/data --auth-local=peer --auth-host=scram-sha-256
sudo systemctl enable --now postgresql
```

On Ubuntu and Debian the server starts by itself. If it is stopped later, start
it with `sudo service mariadb start` or `sudo service postgresql start`.

On Fedora, the PostgreSQL line above lets projects sign in with a password. A
server set up earlier without it refuses password sign-ins; the panel then says
the server “doesn't accept password sign-ins”. To fix it, change `ident` to
`scram-sha-256` on the `127.0.0.1` and `::1` lines of
`/var/lib/pgsql/data/pg_hba.conf`, then run `sudo systemctl reload postgresql`.

**Give the project its own login.** The administrator accounts (`root` for
MariaDB, `postgres` for PostgreSQL) only sign in from the computer's own
administrator account, so projects need a login of their own. In the failed
step's **database server** panel, choose **Suggest a user and password**, open
**Create a login and database**, copy the command and paste it into a terminal.
Then choose **Save and check**. When the panel says connected, choose
**Retry**. See [Workspace preparation](workspace-preparation.md).

If you already run Oracle MySQL, keep it: put its host, port, user and password
in the panel or in **Env**. Don't install MariaDB next to it; the two replace
each other's packages.

## Extras

Nice to have; nothing depends on them.

| Tool | Ubuntu, Debian, WSL | Fedora | Arch |
|---|---|---|---|
| GitHub CLI | `mise use -g gh` | `mise use -g gh` | `sudo pacman -S github-cli` |
| ripgrep (faster search) | `sudo apt install ripgrep` | `sudo dnf install ripgrep` | `sudo pacman -S ripgrep` |
| Browser for automated checks | `npx playwright install --with-deps chromium` | `npx playwright install chromium` | `npx playwright install chromium` |

Playwright installs the libraries its browser needs only on Ubuntu and Debian;
on Fedora and Arch, if the browser doesn't start, install the libraries it
names. Don't install the GitHub CLI with snap. GitHub's own
[install page](https://github.com/cli/cli/blob/trunk/docs/install_linux.md)
lists the official package repositories.

## Check your setup

Open **Dashboard → Health**. The top line says **Vibe64 has what it needs.**
when Node.js, Git and an AI tool all run. Each missing tool shows its command
with a copy button and **Check again**. A tool counts only when it actually
starts, so a broken install shows as **didn't start**, not as ready.

If a tool works in your terminal but Vibe64 can't find it, it is probably
installed somewhere only your interactive shell knows. Check the `mise` lines
above, then start Vibe64 again from a new terminal.

## Ask Colleague

Colleague can walk you through any step here and explain what a row or message
means. It can also do the safe parts for you, when you ask:

- check whether a tool runs now (“is Ruby installed?”), or run all of
  **Health**;
- check the project's database server with the current values, and save the
  host, port, database name and user name you tell it into **Env**;
- retry the session's **Preparing workspace**, and open **Health** or **Env**.

You run the install commands yourself, in your own terminal: Colleague never
uses `sudo`, never edits your shell files and never installs anything. Never
type a password into chat; enter it in the panel's password field or in
**Env**.
