import { describe, expect, it } from "vitest";

import {
  expandedComposerPromptSubmissionOptions,
  promptTemplateDisplayText,
  promptTemplateRefForItem,
  promptTemplateToken
} from "../../src/lib/vibe64ComposerPromptRefs.js";

describe("vibe64ComposerPromptRefs", () => {
  it("creates compact display and inline tokens from prompt labels", () => {
    const item = {
      id: "deslop",
      label: "Deslop",
      text: "Full prompt."
    };

    expect(promptTemplateDisplayText(item)).toBe("Prompt: Deslop");
    expect(promptTemplateToken(item)).toBe("[Deslop]");
    expect(promptTemplateRefForItem(item)).toEqual({
      displayText: "Prompt: Deslop",
      id: "deslop",
      label: "Deslop",
      text: "Full prompt.",
      token: "[Deslop]"
    });
  });

  it("expands structured prompt display text while preserving compact display fields", () => {
    const ref = promptTemplateRefForItem({
      id: "deslop",
      label: "Deslop",
      text: "Full prompt."
    });

    expect(expandedComposerPromptSubmissionOptions({
      displayFields: {
        conversationRequest: "Prompt: Deslop"
      },
      fields: {
        conversationRequest: "Prompt: Deslop"
      }
    }, {
      promptRefs: [ref]
    })).toEqual({
      displayFields: {
        conversationRequest: "Prompt: Deslop"
      },
      fields: {
        conversationRequest: "[Prompt: Deslop]\nFull prompt."
      }
    });
  });

  it("expands known inline prompt tokens from menu items", () => {
    expect(expandedComposerPromptSubmissionOptions({
      fields: {
        conversationRequest: "Please review this.\n\n[Deslop]"
      }
    }, {
      menuItems: [
        {
          id: "deslop",
          label: "Deslop",
          text: "Full prompt."
        }
      ]
    })).toEqual({
      displayFields: {
        conversationRequest: "Please review this.\n\n[Deslop]"
      },
      fields: {
        conversationRequest: "Please review this.\n\n[Prompt: Deslop]\nFull prompt."
      }
    });
  });

  it("expands known compact prompt display text after draft reloads", () => {
    expect(expandedComposerPromptSubmissionOptions({
      fields: {
        conversationRequest: "Prompt: Deslop"
      }
    }, {
      menuItems: [
        {
          id: "deslop",
          label: "Deslop",
          text: "Full prompt."
        }
      ]
    })).toEqual({
      displayFields: {
        conversationRequest: "Prompt: Deslop"
      },
      fields: {
        conversationRequest: "[Prompt: Deslop]\nFull prompt."
      }
    });
  });

  it("keeps an explicitly selected prompt ref ahead of menu token inference", () => {
    const selectedRef = promptTemplateRefForItem({
      id: "selected-deslop",
      label: "Deslop",
      text: "Selected prompt."
    });

    expect(expandedComposerPromptSubmissionOptions({
      fields: {
        conversationRequest: "Please review this.\n\n[Deslop]"
      }
    }, {
      menuItems: [
        {
          id: "other-deslop",
          label: "Deslop",
          text: "Other prompt."
        }
      ],
      promptRefs: [selectedRef]
    })).toEqual({
      displayFields: {
        conversationRequest: "Please review this.\n\n[Deslop]"
      },
      fields: {
        conversationRequest: "Please review this.\n\n[Prompt: Deslop]\nSelected prompt."
      }
    });
  });
});
