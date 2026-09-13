# Application-owned Google Ads Search

## Ownership and scope

The public Vibe64 editor owns the Material 3 preparation/review screens and its
existing Integration setup command transport. The generated application owns
Google credentials, OAuth, refresh, account authorization and every Google API
request. Vibe64 Online supplies no Ads registration, credential, gateway or
billing service. The Ads account owner pays Google.

JSKIT provides reusable plan validation and Search operations in
`@jskit-ai/connectors-catalog/shared/google-ads-search` and
`@jskit-ai/connectors-catalog/server/google-ads-search`. Applications compose
`createGoogleAdsSearchService` with their existing authorized connection service,
configuration, trusted application context and integration ID. A CLI-only JSKIT
app can call this service without Vibe64 or an editor command.

Every other framework implements the same file and command contract through its
native Google client or HTTP library. It does not install JSKIT or a Node sidecar.
The selected framework's Genesis Stack contains its own executable under
`Integration setup`; Genesis does not define or execute advertising semantics.

## Portable saved plan

Read `extensions.googleAdsSearch[integrationId]` in `integrations.json`. This is
separate from connection settings: changing campaign copy must not invalidate
OAuth. The associated integration must be `google-ads`, with a project-owned
registration and an administrator/shared account connection. Derive its trusted
connection owner from application composition, never from a browser-supplied ID.

The plan has exactly these fields:

- `customerId`: ten digits, no hyphens; active client account, not a manager.
- `name`: 1–100 plain-text characters.
- `currency`: three uppercase letters; must match the live account currency.
- `dailyBudgetMicros`, `maxCpcMicros`: positive integer **strings**, at most 12
  digits. One currency unit is 1,000,000 micros; preserve integer precision.
- `finalUrl`: public HTTPS landing page, at most 2048 characters, no embedded
  credentials or fragment.
- `conversionActionId`: numeric ID of an enabled website conversion in this account.
- `locationIds`: 1–10 numeric Google geo target IDs; `languageId`: numeric Google
  language constant ID. Search results supply labels; never guess IDs from names.
- `keywords`: 1–20 nonempty plain strings, at most 80 characters each.
- `headlines`: 3–15 nonempty plain strings, at most 30 characters each.
- `descriptions`: 2–4 nonempty plain strings, at most 90 characters each.
- `nonPolitical`: exactly `true`, explicitly confirmed by the operator. This
  recipe does not support political advertising.

The fixed recipe creates one Search campaign, one non-shared standard budget,
one enabled Search ad group with manual CPC, phrase-match keywords and one
responsive Search ad. The campaign starts PAUSED. Enable only Google Search,
exclude partners/content networks, use positive location PRESENCE targeting,
and attach only the selected website conversion through a campaign custom goal.

## Existing setup command extension

Preserve the `vibe64.integration-setup.command.v1` stdin/stdout envelope and all
existing connection operations. Ads requests contain `operation`, `integrationId`
and an `ads` object plus the existing protocol/request identity. The declared
application command receives credentials through project Env. It must validate
the saved file and caller authorization before resolving credentials. These
commands manage an advertiser's account, not arbitrary app users' accounts.

| Operation | `ads` input | JSKIT service method | `data` output |
| --- | --- | --- | --- |
| `ads-discover` | optional `customerId` | `discover(customerId)` | `accounts` resource names, or `account`, `clients`, `conversions`, `campaigns` |
| `ads-targets` | `customerId`, `name` | `targets(customerId, name)` | `locations`, `languages` |
| `ads-conversion` | `customerId`, `name` | `createConversion(ads)` | Google mutation `results` resource names |
| `ads-preview` | empty | `preview()` | saved `plan`, live `account`, selected `conversion`, `reviewId` |
| `ads-create` | `reviewId` | `create(reviewId)` | numeric-string `campaignId`, `status: "PAUSED"` |
| `ads-campaign` | `campaignId` | `campaign(campaignId)` | account/campaign/budget, ads, targets, keywords, goals and `reviewId` |
| `ads-launch` | `campaignId`, `reviewId`, `trackingConfirmed: true`, `billingConfirmed: true` | `launch(ads)` | Google mutation `results` |
| `ads-pause` | `campaignId` | `pause(campaignId)` | Google mutation `results` |
| `ads-report` | empty | `report()` | `{ campaigns: [...] }` with campaign and last-30-days metrics |

Return exactly `{ protocol, requestId, status: "ads", operation, data }`, echoing
the request identity/operation, with no tokens or diagnostic dumps. Use only the
selected Google display fields returned by the service. Keep the entire response
under 32 KiB. Oversized/unknown results must fail clearly; do not silently truncate
a launch review. The executable is application code, not a public unauthenticated
endpoint. Native adapters must map the same operations and enforce the same rules.
The JSKIT pattern `google-ads-search` provides a dispatch fragment.

## Review, writes and readiness

Preview validates locally, reads the account and selected goal, then calls Google
Ads mutate with `validateOnly: true` and `partialFailure: false`. It does not create
anything. Bind a deterministic review digest to the trusted context, integration,
saved plan and live reviewed values. Before creation, repeat the validation and
compare the digest; reject changed plans/accounts. Create the full batch atomically
with unique temporary IDs and campaign status PAUSED. Do not automatically retry
a write, including a timeout or a lost response. Inspect Google Ads first.

Before launch, re-read the campaign, budget, bidding/network/location settings,
ads/landing URLs/policy status, targets, keywords and goal association. Resolve
custom goal contents as well. Reject oversized reviews, changes since approval,
non-active/manager accounts and campaigns outside this bounded manual-CPC Search
recipe. Launch is a separate explicit confirmation with real-spending wording.
The digest prevents stale review; it is not authentication or a provider-side
compare-and-swap. Another Ads administrator can change a campaign concurrently.
Do not describe provider validation as policy approval or guaranteed readiness.
Pause is separately confirmed. Disconnecting the integration does not stop ads.

The operator manually confirms billing/advertiser readiness and tracking. Install
the selected website conversion using Google's returned tag snippets or Tag setup
instructions. Render snippets as plain text in the editor; never execute them.
The app installs the tag through its existing consent/tag-manager owner and fires
the conversion only after a successful lead action. Avoid duplicate global tags
and double-counted submissions. Verify with Tag Assistant before launch; do not
send real conversions during code verification.

## Bounds and exclusions

This first path uses an existing account. It does not create advertiser accounts,
provision billing, build Performance Max/Demand Gen campaigns, automatically audit
a website, or attach live provider tools to coding-assistant hosts. Public editor
management currently uses the development application's command/Env, even when
the connected Ads account is real. Published-environment Ads management is not
provided by this screen. Reports/discovery show bounded lists; Google Ads remains
the account-wide management UI. Native app composition and actual Google account
approval remain required; fixture tests do not establish live provider acceptance.

## Authoritative references

- https://developers.google.com/google-ads/api/docs/campaigns/create-campaigns
- https://developers.google.com/google-ads/api/docs/mutating/best-practices
- https://developers.google.com/google-ads/api/docs/conversions/categories
- https://support.google.com/google-ads/answer/6095821
- https://docs.lovable.dev/integrations/google-ads
