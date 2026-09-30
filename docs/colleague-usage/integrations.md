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

Payment and advertising operations retain separate account, environment and review
requirements. Development can still address a real provider or spending account.
Creating a paused campaign does not authorize launching it or spending money.

Colleague can explain the relevant provider's steps, inspect safe metadata and
status, open the exact integration and environment, and perform supported requested
connection/payment operations through their normal guards. It must disclose an
unavailable configuration or registration operation and hand off to the visible
controls. You complete secret entry, provider consent and any required spending
declarations. Asking how to connect does not authorize connecting or disconnecting.
