// The two lines that give Git the person's own name and email.
const GIT_IDENTITY_COMMANDS = [
  "git config --global user.name \"Your Name\"",
  "git config --global user.email \"you@example.com\""
].join("\n");

export { GIT_IDENTITY_COMMANDS };
