import { createSSRApp, defineComponent, h, nextTick, ref } from "vue";
import { renderToString } from "@vue/server-renderer";
import { expect, it, vi } from "vitest";

const status = ref(null);
vi.mock("../../packages/vibe64-accounts/src/client/composables/useVibe64Accounts.js", () => ({
  useVibe64Accounts: () => ({ status, isLoading: ref(false), refresh: vi.fn() })
}));
// Each child stands for the install notice it would show for its CLI account.
const notice = (prop) => defineComponent({
  props: { cliAccount: Object, accountRows: Array, modelValue: String },
  setup: (props) => () => h("i", {}, (prop === "cliAccount" ? [props.cliAccount] : props.accountRows || [])
    .filter((account) => account?.status === "not_installed").map(() => "notice"))
});
vi.mock("../../packages/vibe64-accounts/src/client/studio/NativeProviderConnections.vue", () => ({ default: notice("cliAccount") }));
vi.mock("../../packages/vibe64-accounts/src/client/studio/ProviderAccountsSetup.vue", () => ({ default: notice("accountRows") }));
const { default: AIAccountsSetup } = await import("../../packages/vibe64-accounts/src/client/studio/AIAccountsSetup.vue");

it("shows one install notice for a missing CLI, whichever provider is selected", async () => {
  status.value = { accounts: [{ id: "claude", label: "Claude Code", status: "not_installed", connected: false }] };
  for (const modelProviderId of ["", "anthropic", "deepseek"]) {
    const html = await renderToString(createSSRApp(AIAccountsSetup, { providerId: "claude", modelProviderId }));
    await nextTick();
    expect(html.match(/notice/gu) || [], modelProviderId || "default").toHaveLength(1);
  }
});
