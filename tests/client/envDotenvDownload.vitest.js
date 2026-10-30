import { readFileSync } from "node:fs";
import { parse } from "@vue/compiler-sfc";
import { ref } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useRuntimeConfigDotenvDownload } from "../../src/composables/useRuntimeConfigDotenvDownload.js";

function stubBrowser() {
  const saved = [];
  vi.stubGlobal("URL", {
    createObjectURL: vi.fn((blob) => {
      saved.push({ blob });
      return "blob:env";
    }),
    revokeObjectURL: vi.fn()
  });
  vi.stubGlobal("document", {
    body: { append: vi.fn() },
    createElement: () => {
      const anchor = { click: vi.fn(() => Object.assign(saved.at(-1), { fileName: anchor.download })), remove: vi.fn() };
      return anchor;
    }
  });
  return saved;
}

function template(file) {
  const source = readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
  const { descriptor, errors } = parse(source, { filename: file });
  expect(errors).toEqual([]);
  return { script: descriptor.scriptSetup.content, template: descriptor.template.content };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Env .env download", () => {
  it("saves the owner's .env text as a plain file named after the project and environment", async () => {
    const saved = stubBrowser();
    const slug = ref("books");
    let finish;
    const download = useRuntimeConfigDotenvDownload({
      fileName: () => `${slug.value}-development.env`,
      readContent: () => new Promise((resolve) => { finish = resolve; })
    });

    const pending = download.downloadDotenv();
    expect(download.downloadBusy.value).toBe(true);
    expect(await download.downloadDotenv()).toBe(false);
    finish("# Project: books\nAPI_KEY=secret\n");
    expect(await pending).toBe(true);

    expect(download.downloadBusy.value).toBe(false);
    expect(download.downloadError.value).toBe("");
    expect(saved).toHaveLength(1);
    expect(saved[0].fileName).toBe("books-development.env");
    expect(saved[0].blob.type).toBe("text/plain;charset=utf-8");
    expect(await saved[0].blob.text()).toBe("# Project: books\nAPI_KEY=secret\n");
  });

  it("keeps a refused download's error for the panel and saves nothing", async () => {
    const saved = stubBrowser();
    const download = useRuntimeConfigDotenvDownload({
      fileName: "books-production.env",
      async readContent() {
        throw new Error("Only the workspace owner can perform this operation.");
      }
    });

    expect(await download.downloadDotenv()).toBe(false);
    expect(download.downloadError.value).toBe("Only the workspace owner can perform this operation.");
    expect(download.downloadBusy.value).toBe(false);
    expect(saved).toEqual([]);

    const stale = useRuntimeConfigDotenvDownload({ fileName: "x.env", readContent: async () => null });
    expect(await stale.downloadDotenv()).toBe(false);
    expect(stale.downloadError.value).toBe("");
    expect(saved).toEqual([]);
  });

  it("puts one tonal Download .env button beside Refresh, with its busy state and an inline error", () => {
    const { script, template: markup } = template("src/components/studio/EnvPanel.vue");

    expect(markup).toMatch(/<template v-if="projectEnvTabActive">\s+<v-btn\s+:disabled="envInitialLoading"\s+:loading="downloadBusy"\s+:prepend-icon="mdiDownload"\s+rounded="pill"\s+type="button"\s+variant="tonal"\s+@click="downloadDotenv"\s+>\s+Download \.env\s+<\/v-btn>\s+<v-btn\s+:loading="[a-zA-Z]+"\s+:prepend-icon="mdiRefresh"/u);
    expect(markup).toMatch(/<v-alert\s+v-if="downloadError"\s+class="env-panel__alert"\s+closable[\s\S]*?type="error"[\s\S]*?\{\{ downloadError \}\}/u);
    expect(script).toContain("apiSuffix: VIBE64_ENV_DOWNLOAD_API_SUFFIX");
    expect(script).toMatch(/method: "POST",\s+path: ENV_DOWNLOAD_ENDPOINT/u);
    expect(script).toContain("fileName: () => `${projectSlug.value}-${PROJECT_ENVIRONMENT_LABEL}.env`");
    expect(script).toContain("return (await downloadCommand.run())?.content;");
  });
});
