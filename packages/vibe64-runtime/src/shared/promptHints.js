const VIBE64_PROMPT_HINT_LABEL_MAX_CHARACTERS = 24;
const VIBE64_PROMPT_HINT_PROMPT_MAX_CHARACTERS = 108;
const VIBE64_PROMPT_HINT_DRAFT_MAX_CHARACTERS = 4_000;

function normalizedPromptHintDraft(value = "") {
  return Array.from(String(value ?? "").replace(/\r\n?/gu, "\n").trim())
    .slice(-VIBE64_PROMPT_HINT_DRAFT_MAX_CHARACTERS).join("");
}

const VIBE64_PROMPT_HINT_OUTPUT_SCHEMA = Object.freeze({
  additionalProperties: false,
  properties: Object.freeze({
    suggestions: Object.freeze({
      items: Object.freeze({
        additionalProperties: false,
        properties: Object.freeze({
          label: Object.freeze({
            maxLength: VIBE64_PROMPT_HINT_LABEL_MAX_CHARACTERS,
            minLength: 1,
            type: "string"
          }),
          prompt: Object.freeze({
            maxLength: VIBE64_PROMPT_HINT_PROMPT_MAX_CHARACTERS,
            minLength: 1,
            type: "string"
          })
        }),
        required: Object.freeze(["label", "prompt"]),
        type: "object"
      }),
      maxItems: 3,
      minItems: 3,
      type: "array"
    })
  }),
  required: Object.freeze(["suggestions"]),
  type: "object"
});

const VIBE64_PROMPT_HINT_STATIC_STARTERS = Object.freeze({
  existingProject: Object.freeze([
    Object.freeze({
      label: "Tour this project",
      prompt: "Give me a quick tour of this project"
    }),
    Object.freeze({
      label: "Find first improvement",
      prompt: "What should I improve first?"
    }),
    Object.freeze({
      label: "Plan safe change",
      prompt: "Help me plan a small safe change"
    })
  ]),
  greenfield: Object.freeze([
    Object.freeze({
      label: "Shape app idea",
      prompt: "Help me shape my app idea"
    }),
    Object.freeze({
      label: "Plan first version",
      prompt: "Show me the simplest useful first version"
    }),
    Object.freeze({
      label: "Decide first steps",
      prompt: "What should we decide first?"
    })
  ])
});

function normalizedPromptHintSuggestion(suggestion = {}) {
  if (
    !suggestion ||
    typeof suggestion !== "object" ||
    Array.isArray(suggestion) ||
    Object.keys(suggestion).length !== 2 ||
    !Object.hasOwn(suggestion, "label") ||
    !Object.hasOwn(suggestion, "prompt") ||
    typeof suggestion.label !== "string" ||
    typeof suggestion.prompt !== "string" ||
    [suggestion.label, suggestion.prompt].some((text) => (
      Array.from(text).some((character) => {
        const codePoint = character.codePointAt(0);
        return codePoint <= 0x1f || codePoint === 0x7f;
      })
    ))
  ) {
    return null;
  }
  const label = suggestion.label.trim().replace(/[\t ]+/gu, " ");
  const prompt = suggestion.prompt.trim().replace(/[\t ]+/gu, " ");
  const labelWordCount = label ? label.split(/\s+/u).length : 0;
  return (
    label &&
    prompt &&
    Array.from(label).length <= VIBE64_PROMPT_HINT_LABEL_MAX_CHARACTERS &&
    Array.from(prompt).length <= VIBE64_PROMPT_HINT_PROMPT_MAX_CHARACTERS &&
    labelWordCount >= 2 &&
    labelWordCount <= 4
  )
    ? { label, prompt }
    : null;
}

function normalizedPromptHintSuggestions(value = []) {
  if (!Array.isArray(value) || value.length !== 3) {
    return [];
  }
  const suggestions = value.map(normalizedPromptHintSuggestion).filter(Boolean);
  return (
    suggestions.length === 3 &&
    new Set(suggestions.map(({ label }) => label.toLocaleLowerCase())).size === 3 &&
    new Set(suggestions.map(({ prompt }) => prompt.toLocaleLowerCase())).size === 3
  )
    ? suggestions
    : [];
}

export {
  VIBE64_PROMPT_HINT_DRAFT_MAX_CHARACTERS,
  normalizedPromptHintDraft,
  VIBE64_PROMPT_HINT_LABEL_MAX_CHARACTERS,
  VIBE64_PROMPT_HINT_OUTPUT_SCHEMA,
  VIBE64_PROMPT_HINT_PROMPT_MAX_CHARACTERS,
  VIBE64_PROMPT_HINT_STATIC_STARTERS,
  normalizedPromptHintSuggestion,
  normalizedPromptHintSuggestions
};
