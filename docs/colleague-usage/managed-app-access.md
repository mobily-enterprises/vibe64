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
   for the saved result.
4. Use Preview's available identity controls for the browser exchange. Merely
   saving identity configuration does not sign that browser in.

The configuration is part of the selected session's source. Use the ordinary
Save workflow when it should become saved project work. Source Save, application
account creation and browser sign-in have distinct effects. If the application
cannot resolve an identity, check that account and the declared exchange rather
than inventing another selector type. A failed save retains recoverable feedback.

Colleague can read the available identity metadata and make an explicitly requested
configuration change, including a selective removal, through the native owner.
It can open App access and delegate application-account investigation to a coding
agent. It must not claim that an identity was created in the app or that Preview
is signed in just because configuration was saved. If the browser-exchange task
has no supported Colleague operation, the person completes it using the visible UI.
