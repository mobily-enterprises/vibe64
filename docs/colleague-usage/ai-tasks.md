# Fix a problem with AI in the AI task window

When Vibe64 offers **Fix it with AI** on an Update, Save, workspace preparation,
preview sign-in, incoming merge or project setup problem, the whole fix happens in
one window: the problem, the conversation with the AI, what Vibe64 is doing, and the
result. Starting, adopting or inspecting a project from its setup screen, and
creating or reviewing the Database's Data overview, use the same window, and so does
**New AI task** for anything else you want the AI to do on its own. Colleague's own
requests to the AI and its reviews open there too. You close it once the task is
**Done** or **Not done**. It can't end any other way.

## Open it

Choose **Fix it with AI** on the Update, Save or workspace preparation notice, on the
Update error in Repository, under a failed identity in Preview's identity menu, on an
incoming merge's conflicts, or on **Project setup needs attention**. On the setup
screen, **Start through conversation**, **Set up project** and **Inspect it for me**
open it too, and so do **Create with AI**, **Review with AI** and **Review N ungrouped
tables** in the Database's Overview ([Browse a project's Database](database.md)).

For a request of your own, choose **New AI task** in the session header (or in
**Session actions** when the header is narrow). Say what the AI should do and choose
**Start**. When Main chat has messages, **Include recent chat context** gives the task
a copy of up to 40 recent visible Main messages, text only; later messages stay
separate. The task uses the chat mode you would get in Main chat (Senior instead of
Auto), and a team member's task uses **Fix it with AI**. If another task is still
open, the form stays open with what you typed and a message says which task to finish first.
The button says **Opening…** while it starts, **Being fixed… →** while
a fix is running, and **See result →** when a fix has ended and waits for you. In
those last two states it opens the same window again; it never starts a second fix.

On a phone or a short screen the window fills the screen. Otherwise it is a dialog
with a fixed height, so it does not jump as its content changes. Everything works
the same at every size.

## What the window shows

The header names the fix and says, in one line, what is happening now. Below it,
the problem stays in view. Choose **Details** to read all of it.

Two views sit under the problem, and only one shows at a time:

- **Progress** lists the steps, the attempt, and an activity list. The steps are:

  | Fix | The AI's step | Vibe64's step |
  | --- | --- | --- |
  | Update | **The AI repairs the conflicts** | **Vibe64 runs Update** |
  | Save | **The AI repairs what stopped Save** | **Vibe64 runs Save** |
  | Workspace preparation | **The AI repairs the workspace** | **Vibe64 prepares the workspace** |
  | Preview sign-in | **The AI repairs the app's seed** | **Vibe64 signs in as this identity** |
  | Incoming merge | **The AI repairs the conflicting files** | **Vibe64 builds the repaired merge** |
  | Project setup | **The AI sets up the project** | **Vibe64 inspects the project** |
  | Data overview | **The AI groups the tables** | **Vibe64 reads the overview back** |
  | New AI task, Colleague's tasks | **The AI works on the request** | **You finish the task** |

  Choose **Update output**, **Save output** or **Preparation output** to read what
  the run printed.
- **Chat** is the conversation with the AI. A dot on **Chat** means the AI is waiting
  for your answer.

The window opens on **Chat** when the AI asked you something or you have to decide
how the fix ends, and on **Progress** otherwise. It never switches view by itself
after that, so what you are reading stays put.

You can write to the AI while it works. Your message joins the running fix. Chat's
**Chat mode** icon changes the model the same way it does in a temporary chat; see
[Hand a merge repair to another model](temporary-chats.md#hand-a-merge-repair-to-another-model).

## When Vibe64 needs you

A footer appears only when something is waiting for you, and it offers exactly what
can be done next.

| The window says | What to do |
| --- | --- |
| The AI needs your answer | **Answer** in Chat. |
| Your turn (New AI task or Colleague's task) | Write more in Chat, or **Finish** when it's done. |
| The AI could not finish this | **Open chat** to help it, or **End as not done**. |
| The AI stopped without saying it finished | **Check now**, or **Open chat**. |
| Stopped. Tell the AI what to do next. | **Continue**, or **Open chat**. |
| The AI account can't run this right now | **Open AI setup**, then **Continue**. Nothing is lost. |
| The AI ran into an error | **Continue**, or **Open chat**. |
| Vibe64 restarted while the AI was working | **Continue**. A lost turn never restarts by itself. |
| Vibe64 couldn't confirm the result | **Check now**. |
| The check failed. Your unsent message is waiting. | **Open chat** and send it or clear it. |
| What Update said, after three failed checks | **Check now**, **Open chat** or **Review resolved conflicts**. |
| What Save said, after three failed checks | **Check now** or **Open chat**. |
| Save needs your review of where it goes | Choose **Save** and review it, then **Check now**. |
| Preparation needs your choice | Make it on the preparation notice, then **Check now**. |
| Preview isn't running | Start Preview, then **Check now**. |
| This preview can't switch identity | Restart Preview, then **Check now**. |
| The contribution or its target changed | Refresh Incoming changes and merge again. |
| Project setup waits for Update | Fix Update first, then **Check now**. |
| The data overview could not be read | Check the database is available, then **Check now**. |

**Review resolved conflicts** opens the same review as the Update error (see
[Apply an Update after resolving conflicts](github-work.md#apply-an-update-after-resolving-conflicts)).
When you confirm it, the window runs Update as this fix's own check.

## How a fix ends

**Done** is proved, never assumed. When the AI says it has finished, Vibe64 runs
Update, Save or workspace preparation again, or signs in as the identity, by itself,
on the server, whether or not anyone is watching. You never press another button to
finish a fix: a fixed Save pushes the work. A fixed sign-in proves the app accepts the
identity; choose it again in Preview's identity menu to sign Preview in. A fixed
incoming merge shows the repaired merge on Incoming changes; merging it stays your
reviewed choice. Project setup is Done once Vibe64's own inspection needs nothing. The Data
overview is Done once Vibe64 reads it back valid against the refreshed schema, with every
table reviewed for a whole or new-tables review; Overview then reloads by itself. If the run
still fails, the fix goes back to the same conversation with what failed, up to three
attempts. Work you saved yourself meanwhile counts: when nothing is left to save,
the Save fix is Done.

Nothing in Vibe64 can prove a request of your own is done, so a **New AI task** waits for
you after each of the AI's turns: write more, or choose **Finish** to end it **Done**.
Colleague's tasks end the same way, by Colleague or by you.

**Not done** is decided by a person: you choose **Cancel** or **End as not done**, or
the session is archived while the fix is open. Vibe64 never gives up on its own.

The result replaces the views. It shows the problem, what happened, what the AI did
and, on **Not done**, what's next. **See the conversation** reads the whole chat;
**Back to the result** returns. **Close** is the only way out, and closing changes
nothing in the session. An ended fix does not get in the way: starting a new task
closes it.

## Leave and come back

**Hide** (the back arrow on a phone, **Esc** on a keyboard, or the browser's Back)
only puts the window away. The fix keeps running on the server, and a chip beside
the Colleague button shows how it is going: the fix's name, **Needs you**, **Done**
or **Not done**. On a phone the chip is an icon. Choose the chip, or the button on
the notice, to return. A reload or another device returns to the same fix, and the
address of the window can be shared with another member of the project. Clicking
outside a dialog does nothing.

If a fix ends while the window is hidden, a message offers **See result**.

## Cancel

**Cancel** asks once, in the footer: the AI stops, and anything it has changed stays
in the session. **Cancel fix** confirms; **Keep going** carries on. Cancelling always
works. The button then says **Cancelling…** until Vibe64 confirms it.

Vibe64's own checks (running Update, Save or workspace preparation, signing in,
building a repaired merge, inspecting the project, reading the overview) can't be interrupted, so a Cancel
during one says so and the task ends as soon as that run finishes.

## One at a time

A session has one AI task at a time, whoever started it. Members see the same window
live, and any of them can answer, Cancel or Close. While a fix is running, Vibe64
refuses Save, Update, **Prepare workspace** and an incoming Merge or Discard with a
message; try them again when it ends. While Update is failed, workspace preparation's fix waits for Update's: Update
prepares the workspace again itself. Connecting,
disconnecting or switching an AI account never stops or waits on a running fix.

Archiving a session with a fix running warns you first, and ends the fix as **Not
done**.

Colleague can explain this window and what its state means. It doesn't start, answer
or end a fix from a notice; choose those controls yourself.

When you ask Colleague to, it can start its own task, read how a task is going, open
it in this window, and cancel, finish or close it. A Colleague task runs Colleague's
request in its own conversation and ends when Colleague or you choose **Finish**. When
you agree a project setup request with Colleague (start, inspect, adopt or repair), it
starts that as the session's **Project setup** task, and Vibe64 inspects the project
when the AI finishes, exactly as when you start it yourself. A Colleague assignment's
review is the session's AI task while the assignment runs; it ends when the work is
ready or cancelled. Because a session has one AI task at a time, Colleague gets the same
refusal you would and tells you which task to finish first.
