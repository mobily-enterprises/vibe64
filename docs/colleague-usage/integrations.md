# Configure and connect application integrations

Open **Integrations** in the project's Dashboard. These connections belong to the
application, separate from the AI accounts used to write its code. On mobile,
reveal the project and use **Dashboard section**; scroll the selected integration's
detail to its configuration and **Application connection** controls.

1. Select **Development**, or **Production** when the host provides a published
   application. Production uses its reviewed release and does not require a
   development session; its configuration is read-only.
2. Select a configured integration, or use **Search integrations** and **Add**
   under an available service in Development. Fill its provider-specific fields
   and scopes, then save configuration before checking or connecting.
3. Enter credentials through the indicated Env flow. Use the exact variable names
   shown by that provider; do not put secrets into a conversation.
4. Use **Check connection** or the displayed connect action. If consent is pending,
   select **Continue with provider** and finish the provider's own browser flow.
5. Return and check connection status. A callback or successful transport alone
   does not establish that the connection is ready.

**Cancel connection** cancels pending consent. **Disconnect** opens its separate
confirmation; **Remove** removes integration configuration rather than merely
disconnecting its account. Check those different effects before confirming.
Unsaved configuration must be saved or deliberately discarded before reloading.
For client-registration or OAuth-discovery controls, review the displayed provider,
callback, scopes and previous attempt before authorizing creation or retry.

For an app-user connection, **Prepare app user connection request** places the
setup request in the chat draft for review. It does not send it automatically or
connect the application's users. Once that wiring is implemented, users connect
through the application's own account screen and provider consent flow.
Saving an application connection does not automatically give the coding agent
its provider tools. Any assistant tool access requires explicit application
wiring and authorization. These connections also remain separate from Git login.

Payment and advertising operations retain separate account, environment and review
requirements. Development can still address a real provider or spending account.
Creating a paused campaign does not authorize launching it or spending money.

Colleague can explain the relevant provider's steps, inspect safe metadata and
status, open the exact integration and environment, and perform supported requested
connection/payment operations through their normal guards. It can add, edit or
remove specifically requested Development slots and saved registration fields.
For example: “Add a shared Resend integration named mail using
env:RESEND_API_KEY; save configuration only.” Supply the actual provider choices
and required fields; Colleague must ask for anything missing. For an existing
slot, it changes only requested fields and preserves other slots, registrations
and application extensions. Saved registration edits do not create a client at
the provider. Provider registration/discovery still uses its visible controls.
You complete secret entry, provider consent and any required spending
declarations. Asking how to connect does not authorize connecting or disconnecting.

Configuration changes use the current saved revision. If somebody changes the
file before the write, Colleague must read it again and review the intended change.
Its results show saved slot metadata and the revision, without returning settings
or credentials. If you have an unsaved Integrations draft, an outside change marks
the form as changed elsewhere and preserves your draft; deliberately discard and
reload or reconcile it before saving. A source operation can temporarily block
saving; retry explicitly once it finishes. Saving configuration alone does not
connect a provider, run the app, perform a session Save or publish the project.
