import {
  stripStudioContextBlocksForDisplay
} from "@/lib/codexOutput.js";

function promptEchoCandidates(prompt) {
  const source = String(prompt || "");
  return [...new Set([
    source,
    source.replace(/\r?\n/gu, "\r\n"),
    source.replace(/\r?\n/gu, "\n"),
    source.replace(/\r?\n/gu, "\r")
  ])].filter(Boolean);
}

function promptEchoReplacement(prompt) {
  const compactPrompt = stripStudioContextBlocksForDisplay(prompt).replace(/\s+/gu, " ").trim();
  if (!compactPrompt || compactPrompt.length > 220) {
    return "Prompt sent.";
  }
  return compactPrompt;
}

function promptEchoMatch(output, filter) {
  const start = Math.max(0, filter.outputStart);
  if (start > output.length) {
    return null;
  }

  const tail = output.slice(start);
  for (const candidate of filter.candidates) {
    if (output.startsWith(candidate, start)) {
      return {
        end: start + candidate.length,
        partial: false,
        start
      };
    }
    if (candidate.startsWith(tail)) {
      return {
        end: output.length,
        partial: true,
        start
      };
    }
  }

  for (const candidate of filter.candidates) {
    const matchStart = output.indexOf(candidate, start);
    if (matchStart >= start && matchStart - start <= 1024) {
      return {
        end: matchStart + candidate.length,
        partial: false,
        start: matchStart
      };
    }
  }
  return null;
}

function createCodexPromptEchoFilters() {
  let filters = [];
  let nextFilterId = 0;

  function add({
    outputStart = 0,
    prompt = ""
  } = {}) {
    const candidates = promptEchoCandidates(prompt);
    if (!candidates.length) {
      return 0;
    }

    const replacement = promptEchoReplacement(prompt);
    nextFilterId += 1;
    filters = [
      ...filters.filter((filter) => (
        filter.outputStart !== outputStart ||
        filter.replacement !== replacement
      )),
      {
        candidates,
        id: nextFilterId,
        outputStart,
        replacement
      }
    ].sort((left, right) => left.outputStart - right.outputStart);
    return nextFilterId;
  }

  function remove(filterId) {
    if (!filterId) {
      return;
    }
    filters = filters.filter((filter) => filter.id !== filterId);
  }

  function clear() {
    filters = [];
  }

  function apply(output) {
    const source = String(output || "");
    if (!filters.length) {
      return source;
    }

    let displayOutput = "";
    let cursor = 0;
    for (const filter of filters) {
      const match = promptEchoMatch(source, filter);
      if (!match || match.start < cursor) {
        continue;
      }
      displayOutput += source.slice(cursor, match.start);
      if (!match.partial) {
        displayOutput += filter.replacement;
      }
      cursor = match.end;
    }
    displayOutput += source.slice(cursor);
    return displayOutput;
  }

  return Object.freeze({
    add,
    apply,
    clear,
    remove
  });
}

export {
  createCodexPromptEchoFilters
};
