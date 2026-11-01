# Saved Env values (`vibe64.saved-env-values.v1`)

A host may keep values of its own (keys, tokens, settings) and let the person
fill an ordinary project Env variable with one. Public Vibe64 never stores such
values, never fills a variable the person did not link, and never names the
host: everything it shows comes from the host's `label` and each value's
provenance line.

Without the capabilities below, Env, the helper and every setup check behave
exactly as they do in a workspace with no saved values.

## Capabilities

The host provides saved values through two optional capabilities, one per
consumer, so each providing feature requires only what its own side needs:

- **Values** (`vibe64.project.saved-env-values`, `PROJECT_SAVED_ENV_VALUES_TOKEN`
  from `@local/vibe64-project/server/savedEnvValues`): the project
  (`vibe64.project`) reads the values the person linked into its Development
  Env. The providing feature must not require `vibe64.project`.
- **Links** (`vibe64.terminals.saved-env-value-links`,
  `TERMINALS_SAVED_ENV_VALUE_LINKS_TOKEN` from
  `@local/vibe64-terminals/server/savedEnvValueLinks`): the helper
  (`vibe64.terminals`) lists what the person may link, and links or unlinks a
  variable. The providing feature may require the project, since linking
  usually replaces the project's own value, but must not require
  `vibe64.terminals`.

```js
defineFeature({
  id: "host.saved-env-values",
  provides: { savedEnvValues: PROJECT_SAVED_ENV_VALUES_TOKEN },
  setup: () => ({
    savedEnvValues: {
      label: "Example vault",            // the host's own noun, shown verbatim
      async valuesForProject({ projectSlug, projectContextRoot, projectRuntimeRoot }) {
        return {
          contract: "vibe64.saved-env-values.v1",
          values: [{ key: "PAYMENTS_KEY", value: "…", secret: true, label: "From Example vault: Payments" }]
        };
      }
    }
  })
});

defineFeature({
  id: "host.saved-env-value-links",
  requires: { project: "vibe64.project" },
  provides: { savedEnvValueLinks: TERMINALS_SAVED_ENV_VALUE_LINKS_TOKEN },
  setup: ({ project }) => ({
    savedEnvValueLinks: {
      label: "Example vault",
      async list({ projectSlug, sessionId, actor }) {
        return { entries: [{ id, label, description, fields: [{ id, label, secret }], environments: ["development"] }] };
      },
      async link({ projectSlug, sessionId, actor, environment, key, entryId, fieldId }) { return { ok: true }; },
      async unlink({ projectSlug, sessionId, actor, environment, key }) { return { ok: true }; }
    }
  })
});
```

Each feature validates its capability's shape when it is set up; without one it
uses its named default, `NO_SAVED_ENV_VALUES` (nothing to fill) or
`NO_SAVED_ENV_VALUE_LINKS` (nothing to list or link). `actor` is the signed-in
person whose request prepared the coding agent (`null` when unknown); the host
applies that person's permissions. `list`, `link` and `unlink` may answer
`{ ok: false, code, error }` with a sentence for the person. The
`vibe64.saved-env-values.v1` marker versions the result of `valuesForProject`.

## Development values

`valuesForProject` supplies **Development** values only; Production delivery
belongs to the host's own deployment environment.

- Each value becomes a non-editable record: `owner: "system"`,
  `source: "vibe64-host:saved-value"`, its `secret` flag (default `true`) and
  its one-line `label` (at most 200 characters; the values capability's
  `label` when absent). `label` is a display field in Env views; it is never
  stored.
- `VIBE64_`-reserved names and `NODE_OPTIONS` are dropped.
- Layering is `{ ...Stack defaults, ...user values, ...saved values, ...managed resources }`:
  a linked value replaces a Stack default and any stale value typed for the
  project, and a managed resource binding always replaces a linked value.
- Saving a user value for a linked variable fails with
  `vibe64_env_value_linked`: "`KEY` is linked to a saved value. Unlink it
  before entering a value here."
- A values capability that throws, answers `ok: false`, or returns another
  contract, a bad name, a non-string value or a duplicate fails the read with
  `vibe64_saved_env_values_unavailable`. Values are never silently dropped.
- Secret linked values stay out of the resource configuration fingerprint,
  like other secret Development values.

## Helper

```
vibe64-helper env saved [--json]
vibe64-helper env link <development|production> <KEY> <saved-id> <field-id> [--json]
vibe64-helper env unlink <development|production> <KEY> [--json]
```

`saved` prints one line per entry (`id label — description (fields: apiKey*)`,
`*` marks a secret) and never a value; without the links capability it prints
"This workspace offers no saved values." and exits 0. `env status` shows a linked row
as `KEY — linked — <provenance>`. `env set` and `env remove` on a linked
variable fail with `vibe64_env_value_linked`. A host that delivers linked
Production values gives those records the same source and a `label`, so the
helper and Env present them the same way.

## UI

The Env view and the Integrations credential step mount the host's picker
component through `VIBE64_SAVED_ENV_VALUES_KEY` (`src/lib/vibe64SavedEnvValues.js`).
