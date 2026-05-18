import assert from "node:assert/strict";
import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  PromptRenderer,
  renderPromptTemplate
} from "../../server/lib/aiStudio/index.js";
import { withTemporaryRoot } from "./aiStudioTestHelpers.js";

test("ai-studio prompt renderer renders explicit session context into prompt templates", async () => {
  await withTemporaryRoot(async (promptPackRoot) => {
    await writeFile(
      path.join(promptPackRoot, "make_plan.txt"),
      [
        "Action {{action.id}} for {{session.id}}.",
        "Target: {{session.targetRoot}}",
        "Metadata: {{session.metadata.json}}",
        "Input: {{input.json}}"
      ].join("\n"),
      "utf8"
    );
    const renderer = new PromptRenderer({
      promptPackRoot
    });

    const rendered = await renderer.renderPrompt({
      action: {
        id: "make_plan",
        label: "Make plan",
        type: "prompt"
      },
      input: {
        dryRun: true
      },
      session: {
        currentStep: "plan_made",
        metadata: {
          z_last: "last",
          a_first: "first",
          issue_url: "https://github.test/example/issues/1"
        },
        sessionId: "prompt_session",
        status: "active",
        targetRoot: "/workspace/example"
      }
    });

    assert.equal(rendered.promptId, "make_plan");
    assert.match(rendered.prompt, /Action make_plan for prompt_session/u);
    assert.match(rendered.prompt, /Target: \/workspace\/example/u);
    assert.match(rendered.prompt, /"a_first": "first",\n {2}"issue_url": "https:\/\/github\.test\/example\/issues\/1",\n {2}"z_last": "last"/u);
    assert.match(rendered.prompt, /"dryRun": true/u);
  });
});

test("ai-studio prompt renderer falls back to the generic prompt", async () => {
  await withTemporaryRoot(async (promptPackRoot) => {
    await writeFile(path.join(promptPackRoot, "generic.txt"), "Generic {{action.label}} for {{session.currentStep}}.", "utf8");
    const renderer = new PromptRenderer({
      promptPackRoot
    });

    const rendered = await renderer.renderPrompt({
      action: {
        id: "missing_specific_prompt",
        label: "Missing specific prompt",
        type: "prompt"
      },
      session: {
        currentStep: "example_step"
      }
    });

    assert.equal(rendered.prompt, "Generic Missing specific prompt for example_step.");
  });
});

test("ai-studio prompt renderer applies target overrides with the rendered original prompt", async () => {
  await withTemporaryRoot(async (promptPackRoot) => {
    await withTemporaryRoot(async (targetRoot) => {
      await writeFile(
        path.join(promptPackRoot, "make_plan.txt"),
        "Built-in {{action.label}} for {{session.id}} in {{session.targetRoot}}.",
        "utf8"
      );
      const overrideRoot = path.join(targetRoot, ".ai-studio", "prompts", "jskit");
      await mkdir(overrideRoot, {
        recursive: true
      });
      await writeFile(
        path.join(overrideRoot, "make_plan.txt"),
        [
          "Custom wrapper.",
          "{{originalPrompt}}",
          "Also use {{prompt.original}}"
        ].join("\n"),
        "utf8"
      );
      const renderer = new PromptRenderer({
        promptPackRoot
      });

      const rendered = await renderer.renderPrompt({
        action: {
          id: "make_plan",
          label: "Make plan",
          type: "prompt"
        },
        session: {
          adapter: {
            id: "jskit",
            label: "JSKIT"
          },
          sessionId: "prompt_session",
          targetRoot
        }
      });

      assert.equal(rendered.originalPrompt, `Built-in Make plan for prompt_session in ${targetRoot}.`);
      assert.equal(
        rendered.prompt,
        [
          "Custom wrapper.",
          `Built-in Make plan for prompt_session in ${targetRoot}.`,
          `Also use Built-in Make plan for prompt_session in ${targetRoot}.`
        ].join("\n")
      );
      assert.equal(rendered.promptOverridePath, path.join(overrideRoot, "make_plan.txt"));
      await assert.rejects(
        access(path.join(targetRoot, ".ai-studio", "prompts", "README.md")),
        /ENOENT/u
      );
    });
  });
});

test("ai-studio prompt renderer does not create target files when no override exists", async () => {
  await withTemporaryRoot(async (promptPackRoot) => {
    await withTemporaryRoot(async (targetRoot) => {
      await writeFile(
        path.join(promptPackRoot, "make_plan.txt"),
        "Built-in {{action.label}} for {{session.id}}.",
        "utf8"
      );
      const renderer = new PromptRenderer({
        promptPackRoot
      });

      const rendered = await renderer.renderPrompt({
        action: {
          id: "make_plan",
          label: "Make plan",
          type: "prompt"
        },
        session: {
          adapter: {
            id: "jskit",
            label: "JSKIT"
          },
          sessionId: "prompt_session",
          targetRoot
        }
      });

      assert.equal(rendered.prompt, "Built-in Make plan for prompt_session.");
      await assert.rejects(
        access(path.join(targetRoot, ".ai-studio", "prompts")),
        /ENOENT/u
      );
    });
  });
});

test("ai-studio prompt templates reject unknown tokens", () => {
  assert.throws(
    () => renderPromptTemplate("{{unknown.token}}", {
      action: {},
      input: {},
      product: "ai-studio",
      session: {}
    }),
    /Unknown AI Studio prompt token/u
  );
});

test("ai-studio prompt templates can render scalar adapter prompt context tokens", () => {
  assert.equal(
    renderPromptTemplate("Blueprint:\n{{adapter.promptContext.blueprint}}", {
      adapter: {
        promptContext: {
          blueprint: "Use Prisma server-side."
        }
      },
      action: {},
      input: {},
      product: "ai-studio",
      session: {}
    }),
    "Blueprint:\nUse Prisma server-side."
  );
});
