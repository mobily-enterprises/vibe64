# Choose a starter with ready tests

In an empty project's onboarding, starters are grouped by technology. Choose
the JSKIT starter that matches the app:

- **Basic app**: responsive shell, server/client/browser tests, no database or login.
- **Database app**: the same shell plus MySQL migrations and isolated database
  tests, without accounts.
- **Accounts app**: sign-up, login, private pages and persisted profiles, plus
  account-persistence and browser tests.

For another framework, each of Django, Rails, Spring Boot, Express and Next.js
offers one **Basic app**: a home page whose notes form saves to SQLite
(MySQL/MariaDB for Spring Boot), with unit and HTTP tests and the starter's own
`docs/colleague-usage/starting-app.md`. Only Rails has sign-in, with the seeded
development account `developer@example.com` / `developer`; for the others, ask
the coding agent to add accounts. These starters do not declare **Browser test
app**.

The same choices appear on desktop and mobile. Applying a starter imports its
source. Finish **Prepare workspace** to install dependencies and provision its
declared resources and migrations; a failed preparation offers **Retry**.
The coding agent can then follow the first feature request using the existing
test commands documented in the starter's `docs/colleague-usage/testing.md`.

Each starter declares **Browser test app**. Ask the coding agent to run
`vibe64-helper playwright --target browser-tests test`; the two database starters
select an exact browser-test database separate from the normal and integration
databases. The amber **Test Preview** bar identifies test configuration. Vibe64
restores the previous target after managed tests and shows a red notice if that
recovery fails. Basic has no database to isolate. Starters pin Playwright 1.61.1;
managed projects use the provided browser rather than installing another one.

Colleague can explain the choices and offer coding-agent help. A how-to question
alone does not authorize starter import, resource preparation or fixture reset.
Applying to an existing application is unavailable; it does not replace authored
source. These are complete starters; optional packs are not part of this flow.
OpenCode's generated, ignored plugin-install files alone do not make a blank
project an existing application. Custom OpenCode files still prevent import.
