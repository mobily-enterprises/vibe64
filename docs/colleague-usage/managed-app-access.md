# Configure Managed app access

**App access** opens **Managed app access** for the selected project's session.
These are named identities for your application, separate from Vibe64 login and
coding-agent accounts. The application must support the declared identity exchange.
Adding a name here does not create an application account.

1. Open App access in Dashboard. On mobile, reveal the project and use its
   **Dashboard section** selector.
2. Configure each identity's **Name**, supported **App identifier** and
   **Application value** to refer to an existing account in the application.
3. Review the default and any requested removal, then choose **Save** and wait
   for the saved result. The page then shows the list as it was stored, with
   names trimmed and lowercased.
   If the saved list changes elsewhere (another tab, Colleague or the coding
   agent) while you have unsaved edits, the page keeps your edits, says the saved
   identities changed and disables Save: choose **Reload saved identities**,
   then reapply and review your changes.
4. Use Preview's available identity controls for the browser exchange. Merely
   saving identity configuration does not sign that browser in.

After switching identity, open the intended application page in Preview and check
the rendered account and access. An application can leave its login page visible
after the exchange succeeds; the selected identity name alone is not proof of
access. If a protected page still returns to login, ask the coding agent to inspect
the exchange and subsequent application requests without exposing cookie values.

The configuration is part of the selected session's source. Use the ordinary
Save workflow when it should become saved project work. Source Save, application
account creation and browser sign-in have distinct effects. If the application
cannot resolve an identity, check that account and the declared exchange rather
than inventing another selector type. A failed save retains recoverable feedback.

The coding agent can also save this list for you in its session. Tell it which
existing accounts to use, or confirm the names and accounts it proposes from the
application's existing accounts. It saves only what you asked for or confirmed,
never creates application accounts or changes roles, and then signs in as each
name in Preview to verify access. The saved list appears here and in Preview's
identity menu; use the session's normal Save to keep it.

Colleague can read the available identity metadata and make an explicitly requested
configuration change, including a selective removal, through the native owner.
It can open App access and delegate application-account investigation to a coding
agent. It must not claim that an identity was created in the app or that Preview
is signed in just because configuration was saved. If the browser-exchange task
has no supported Colleague operation, the person completes it using the visible UI.
