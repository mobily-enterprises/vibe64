// Agent-readable specs of the integration setup command: the guides this
// package already ships for the editor's Integrations controls.
import { readFile } from "node:fs/promises";

const guide = (file) => () => readFile(new URL(`../../docs/${file}`, import.meta.url), "utf8");

const VIBE64_SOURCE_EDITOR_AGENT_SPECS = Object.freeze([
  {
    name: "integration-setup-command",
    title: "Integration setup command protocol and integrations.json",
    text: guide("application-integration-setup.md")
  },
  {
    name: "integration-payments-laravel",
    title: "Implementing the integration setup payment operations in Laravel",
    text: guide("application-payments-laravel.md")
  }
]);

export { VIBE64_SOURCE_EDITOR_AGENT_SPECS };
