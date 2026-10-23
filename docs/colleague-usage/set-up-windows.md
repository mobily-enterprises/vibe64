# Set up Windows for Vibe64 (WSL)

Vibe64 runs on Windows inside **WSL**, Windows' built-in Linux, with Ubuntu.
It doesn't run in PowerShell or Command Prompt: there, `npx vibe64` stops and
points here. Once Ubuntu is set up, everything else is the same as on Linux.

You need Windows 11, or Windows 10 version 2004 or newer.

## Install WSL and Ubuntu

1. Right-click **Start**, choose **Terminal (Admin)** or **Windows PowerShell
   (Admin)**, and run:

   ```powershell
   wsl --install
   ```

2. Restart Windows when it asks.
3. Open **Ubuntu** from the Start menu. The first start takes a minute, then
   asks for a **username and password**. They are for Ubuntu only and don't
   have to match your Windows ones. Remember the password: Ubuntu asks for it
   whenever a command starts with `sudo`. Nothing shows while you type it.

If `wsl --install` only prints help text, WSL is already there: run
`wsl --install -d Ubuntu` instead. Microsoft's
[install page](https://learn.microsoft.com/en-us/windows/wsl/install) has the
details.

## Set up Ubuntu

From now on, type every command in the **Ubuntu** window, not in PowerShell.
Follow [Set up Linux](set-up-linux.md) from the start, using the lines for
**Ubuntu, Debian, WSL**: the basic tools, Node.js with mise, Git, an AI tool,
and later whatever your projects need. Install the AI tools inside Ubuntu too;
copies installed on the Windows side don't work from Ubuntu.

Two checks after the Node.js step, in a new Ubuntu window:

- `which node npx` must print paths that start with `/home/`. A path starting
  with `/mnt/c/` is the Windows Node.js leaking in; it doesn't work with
  Vibe64. Make sure the mise lines are in `~/.bashrc` and `~/.profile`, then
  open a new Ubuntu window.
- `node --version` prints `v26…`.

## Keep projects inside Ubuntu

Put your projects in your Ubuntu home folder (for example `~/Vibe64`, where
Vibe64 creates new ones), not under `/mnt/c/`:

- **Clone inside Ubuntu.** A project cloned with Git for Windows has Windows
  line endings, and its scripts then fail with errors like
  `/usr/bin/env: 'ruby\r': No such file or directory`.
- **Speed.** Files under `/mnt/c/` are much slower for Linux programs.

To see a project's files in Windows, run `explorer.exe .` in its folder.

## Start Vibe64

In the Ubuntu window, go to your project folder and run `npx vibe64`. Open the
address it shows in your normal Windows browser: WSL passes `localhost` through
to Windows. See [Running Vibe64 on your computer](running-vibe64-on-your-computer.md).

## Databases

Install and start them inside Ubuntu, with the Ubuntu lines in
[Set up Linux](set-up-linux.md#databases). A database server installed on the
Windows side also works: put its address in the project's **Env** (from inside
WSL, Windows is not always reachable at `localhost`, so this is the harder
route).

## Ask Colleague

Colleague can explain each step and check what is installed inside Ubuntu (it
runs **Health** and checks single tools when you ask). Installing WSL, Ubuntu
and the tools happens in your own terminal; Colleague never runs commands with
`sudo` or in PowerShell. Never type a password into chat.
