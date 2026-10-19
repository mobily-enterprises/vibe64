# Open the coding agent's terminal

This continues [Create and switch sessions](sessions.md).

Open **Dashboard → AI Terminal**, then select **Start Codex**, **Start Claude
Code** or **Start OpenCode**, depending on the session's agent. The terminal
continues that session's native conversation. **Close terminal** stops its
interactive terminal; starting it again resumes the saved conversation.

Claude opens a new interactive process for the current saved conversation. Finish
or stop an active chat turn before selecting **Start Claude Code**. The idle chat
process stops first, and chat is unavailable while the terminal is open. Use
**Close terminal** to return to chat. With a saved Claude connection the
terminal opens the conversation directly, skipping Claude's first-run setup.
It asks you to sign in only when the connection is missing or has expired.
Complete sign-in yourself; Colleague can explain it but cannot sign in for you.

Click inside the terminal before typing or pasting. Text and Enter are delivered
in the order you entered them, even while the server checks terminal access.
If an input error appears, inspect the terminal before entering the command again;
the error does not mean that earlier input was discarded or rolled back.
Colleague can explain the error, but terminal commands remain your interaction.

A resumed Codex terminal keeps the shared server's saved permissions. Codex may
still show its own OpenAI sign-in screen when Main chat uses an external model:
its terminal checks the shared server's account before opening the conversation.
An external model connection alone does not satisfy that native sign-in. Complete
the offered account sign-in yourself, or close the terminal and continue in Main
chat. Colleague can explain the steps, but cannot complete your sign-in.

## Leave a terminal on mobile

AI Terminal fills small screens. Use **Exit full screen** in its header to
restore the page and its **Dashboard section** selector. This keeps the terminal
running. Use **Full screen** to enlarge it again. **Close terminal** stops that
terminal; it is a separate control.

The same full-screen controls appear on other non-collapsible terminal views.
Task output with a **Collapse** control keeps that existing way back. Colleague
can explain these controls or open another view through its navigation action;
leaving a view does not authorize stopping its work.
