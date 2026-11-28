# Need help

**Need help** is a session's flag that something is wrong which its AI can't fix
itself: the platform, a managed service such as the project's database server,
or access the session doesn't have. The AI raises it instead of waiting or
guessing, and keeps working on whatever it can. You can raise it too. It stays
on the session, through restarts, until someone clears it.

## Where it shows

- **The session tab**: a lifebuoy icon after the session's name, on every
  session that needs help. Click or tap it to open that session's **Need help**
  without selecting the tab. The tab's details (hover it, or its work icon)
  add a **Need help** line with the newest request.
- **The session header**: a **Need help** chip beside Save while the shown
  session has one. Click it to open **Need help**.

The chip and the icon change as it goes:

- **Need help**: asked, not answered yet.
- **Need help · no answer yet**: nobody has answered its newest request for 15
  minutes. It is still open; **Need help** then says so at the top.
- **Need help · answered**: answered; it stays until it is cleared.

## Read, answer or clear it

**Need help** lists each message in order: who wrote it (the AI, or the
person's username), whether they asked or answered, and when. When the host
forwards Need help to whoever can help, it also says where it was sent, with
the reference it got, or why it couldn't be sent.

- **Answer**: write your answer and select **Answer**. The AI is told at once
  while it works, or with your next message otherwise.
- **Add to the request**: adds what you know to the same request, without
  answering it.
- **Clear**: ends it, once it's resolved or no longer needed.
- **Close**: leaves it as it is.

A message holds up to 2,000 characters.

## Ask for help yourself

Open the session tab's details and select **Ask for help** (it reads **Open
Need help** when the session already has one). Say what's wrong, what you
tried and what you need, then select **Ask for help**. If the session already
has Need help, your message is added to it: a session has one at a time.

## What the AI does

The AI runs `vibe64-helper need-help raise` with what's wrong, what it tried
and what it needs, tells you in the chat, and carries on with what it can. A
follow-up adds to the same Need help. It reads your answer with
`vibe64-helper need-help read` and clears it with `vibe64-helper need-help
clear` once it's resolved.

## Where it is sent

On your own computer, Need help is not sent anywhere: it shows on the session,
for you. A host may forward each Need help to whoever can help it; the host's
own guide says where and what it sends. A follow-up is sent again only when
the first send failed.

## What Colleague can do

Colleague can explain Need help and point at the session tab's icon, the
header's chip and **Ask for help**. You answer, raise and clear it yourself, on
desktop and mobile alike.
