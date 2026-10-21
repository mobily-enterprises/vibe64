import { createSSRApp, h } from "vue";
import { renderToString } from "@vue/server-renderer";
import { createVuetify } from "vuetify";
import { expect, it } from "vitest";
import CliInstallNotice from "../../packages/vibe64-accounts/src/client/studio/CliInstallNotice.vue";

function render(account, slot = null) {
  const view = createSSRApp({ render: () => h(CliInstallNotice, { account }, slot ? { default: () => slot } : undefined) });
  view.use(createVuetify({ ssr: true }));
  return renderToString(view);
}

const install = { command: "curl -fsSL https://claude.ai/install.sh | bash", guideUrl: "https://code.claude.com/docs/en/setup" };

it("says plainly that the CLI is not installed and offers its install command", async () => {
  const html = await render({
    label: "Claude Code", status: "not_installed", install, title: "Claude Code isn't installed on this computer",
    detail: "Vibe64 uses it to work with Claude. Install it, then choose Check again."
  });
  expect(html).toContain("Claude Code isn&#39;t installed on this computer");
  expect(html.split("isn&#39;t installed on this computer")).toHaveLength(2);
  expect(html).toContain("Vibe64 uses it to work with Claude. Install it, then choose Check again.");
  expect(html).toContain(install.command);
  expect(html).toContain("Copy the Claude Code install command");
  expect(html).toContain(install.guideUrl);
  expect(html).toContain("Check again");
  expect(html).not.toContain("<details");
});

it("keeps raw start-up output inside a collapsed Details", async () => {
  const html = await render({
    label: "Codex", status: "unavailable", observed: "spawn /home/me/.local/bin/codex EACCES", title: "Codex didn't start",
    detail: "Codex is installed but didn't start. Choose Check again; if it keeps failing, reinstall it."
  });
  expect(html).toContain("Codex didn&#39;t start");
  expect(html).toMatch(/<details[^>]*><summary[^>]*>Details<\/summary><pre[^>]*>spawn \/home\/me\/\.local\/bin\/codex EACCES<\/pre>/u);
  expect(html).not.toMatch(/<details[^>]*open/u);
  expect(html.indexOf("EACCES")).toBeGreaterThan(html.indexOf("<details"));
  expect(html).not.toContain("curl -fsSL");
});

it("shows nothing for a signed-out or connected account", async () => {
  expect(await render({ label: "Claude Code", status: "not_connected", message: "Sign in to Claude Code." })).toBe("<!---->");
  expect(await render({ label: "Codex", status: "connected", connected: true })).toBe("<!---->");
});

it("keeps the caller's extra actions beside Check again", async () => {
  expect(await render({ label: "opencode", status: "not_installed", message: "opencode isn't installed." }, "Choose another AI"))
    .toContain("Choose another AI");
});
