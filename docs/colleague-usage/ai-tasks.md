# Fix a problem with AI in the AI task window

When Vibe64 offers **Fix it with AI** on an Update, Save, workspace preparation or
preview sign-in failure, the whole fix happens in one window: the problem, the
conversation with the AI, what Vibe64 is doing, and the result. You close it once the
fix is **Done** or **Not done**. It can't end any other way. These four use this
window now; other **Fix it with AI** repairs still open a temporary chat
([Choose the AI for a temporary chat](temporary-chats.md)) until they move across.

## Open it

Choose **Fix it with AI** on the Update, Save or workspace preparation notice, on the
Update error in Repository, or under a failed identity in Preview's identity menu. The button says **Opening…** while it starts, **Being fixed… →** while
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

**Review resolved conflicts** opens the same review as the Update error (see
[Apply an Update after resolving conflicts](github-work.md#apply-an-update-after-resolving-conflicts)).
When you confirm it, the window runs Update as this fix's own check.

## How a fix ends

**Done** is proved, never assumed. When the AI says it has finished, Vibe64 runs
Update, Save or workspace preparation again, or signs in as the identity, by itself,
on the server, whether or not anyone is watching. You never press another button to
finish a fix: a fixed Save pushes the work. A fixed sign-in proves the app accepts the
identity; choose it again in Preview's identity menu to sign Preview in. If the run
still fails, the fix goes back to the same conversation with what failed, up to three
attempts. Work you saved yourself meanwhile counts: when nothing is left to save,
the Save fix is Done.

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

Update, Save, workspace preparation and a sign-in can't be interrupted, so a Cancel
during the check says so and the fix ends as soon as that run finishes.

## One at a time

A session has one AI task at a time, whoever started it. Members see the same window
live, and any of them can answer, Cancel or Close. While a fix is running, Vibe64
refuses Save, Update and **Prepare workspace** with a message; try them again when it
ends. While Update is failed, workspace preparation's fix waits for Update's: Update
prepares the workspace again itself. Connecting,
disconnecting or switching an AI account never stops or waits on a running fix.

Archiving a session with a fix running warns you first, and ends the fix as **Not
done**.

Colleague can explain this window and what its state means. It doesn't start, answer
or end a fix from a notice; choose those controls yourself.
