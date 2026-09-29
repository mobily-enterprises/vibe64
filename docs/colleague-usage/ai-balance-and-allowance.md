# Check AI balance and allowance

The main chat's bottom row can show a compact balance or allowance beside the
existing chat controls. The same value and details are available on desktop and
mobile; tap the value on either layout to open its details.

- **DeepSeek** or **GLM Pay-as-you-go API**, through Claude, Codex or OpenCode: a currency amount such as
  **$12.40**. The button does not add the provider name or a country prefix.
  The details identify the provider and currency. GLM reports USD;
  DeepSeek CNY balances use **¥**.
- **GLM Coding Plan**, through Claude, Codex or OpenCode: a remaining percentage,
  such as **68%**. The weekly quota is shown when supplied; otherwise the supplied
  coding quota is used. Details include shorter windows and reset times when known.
- Native **Claude** subscriptions and **Codex** ChatGPT plans retain their weekly
  percentage and existing **Refresh** control.

The selected connection must be available in **AI Accounts**, and you must have
permission to use it. To choose a model explicitly, open **Chat mode**, choose
**Custom**, select **Orchestrator**, **Model** and **Thinking**, then **Apply**.
With **Auto**, the value follows the connection selected for Senior, Junior and
review turns. Changing to another connection never transfers the previous
connection's reading to it.

DeepSeek and GLM balance or Coding Plan quota checks are attempted at the start and
end of each main chat turn. They run independently of the assistant, so a slow or
failed check does not delay a turn, stop it, or decide which model may run. There
is no periodic balance check or manual **Refresh** for these snapshots. Reloading
the page reads the latest stored snapshot; it does not query the provider again.

Tap the value to see when it was checked. **Usage details** opens the provider's
site in a new tab. The balance or quota belongs to the account associated with
that key and may be shared with other sessions or applications; it is not the
cost of the current turn or a separate per-key budget. Other usage and delayed
provider accounting can make the snapshot differ from the provider's current
value.

If no value appears, a reading may not be available yet, the provider may have
failed to answer, or the connection may not support balance checks. This does
not mean the balance is zero. Continue using the chat normally; the next turn
boundary makes another attempt. For an immediate account check, open the
provider's account site yourself. GLM's optional pay-as-you-go balance endpoint
can reject a configured key; a missing balance alone is not a reason to replace
the key. Check the provider's Billing page for the account balance. GPT API keys
do not show a balance. A confirmed zero does display as zero.

Colleague can explain these controls, help identify the session's selected model,
and offer to change the selection through its existing session actions. A change
requires the person's request or acceptance and normal access checks. Colleague
does not have a balance-reading tool or access to API keys; the person reads the
indicator, opens the provider site and handles any account payment or top-up.

Verified against `Vibe64AgentPlanUsage.vue`, `Vibe64ChatModeControls.vue`,
`Vibe64SessionAssistantMenu.vue`, provider usage normalization, and the session
action contracts. Automated browser fixtures cover the displayed values and
details; they do not verify a live provider account's balance.
