import { constants } from "node:fs";
import { open, readdir } from "node:fs/promises";
import path from "node:path";
import { resolveStudioAppRoot } from "@local/vibe64-core/server/studioRoots";

const topicPattern = /^[a-z][a-z0-9-]{0,63}$/u;
const maxGuideBytes = 65536;
const maxGuideCharacters = 24000;

function createColleagueUsageKnowledge({ directory = path.join(resolveStudioAppRoot(), "docs/colleague-usage") } = {}) {
  const warned = new Set();

  // measured receives the guide's size as it is read, for the topic list's warning.
  async function readGuide(topicId, measured = {}) {
    if (!topicPattern.test(topicId)) throw new Error("Choose a topic ID returned by the usage topic list.");
    let file;
    try {
      file = await open(path.join(directory, `${topicId}.md`), constants.O_RDONLY | constants.O_NOFOLLOW);
      const stat = await file.stat();
      measured.bytes = stat.size;
      if (!stat.isFile() || stat.size > maxGuideBytes) throw new Error("This usage guide is too large or is not a regular file. Ask for another topic.");
      const text = await file.readFile("utf8");
      measured.characters = Array.from(text).length;
      if (measured.characters > maxGuideCharacters) throw new Error(`The ${topicId} usage guide needs to be split into smaller topics in the application release.`);
      const title = text.match(/^# ([^\n]+)$/mu)?.[1]?.trim();
      if (!title) throw new Error("This usage guide has no title. Its release documentation needs correction.");
      const summary = text.replace(/^# [^\n]+\n/u, "").trim().split(/\n\s*\n/u)[0].replace(/\s+/gu, " ").slice(0, 400);
      return { topicId, title, summary, text };
    } finally {
      await file?.close();
    }
  }

  return {
    async topics({ query = "", offset = 0, limit = 20 } = {}) {
      let entries;
      try { entries = await readdir(directory, { withFileTypes: true }); }
      catch (error) {
        if (error.code === "ENOENT") return { ok: false, error: "Usage guides are unavailable in this application release.", topics: [], hasMore: false };
        throw error;
      }
      const terms = query.toLowerCase().split(/\s+/u).filter(Boolean);
      const topics = [];
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
        const topicId = entry.name.slice(0, -3);
        if (!topicPattern.test(topicId)) continue;
        const measured = {};
        let topic, searchable = topicId;
        try {
          const guide = await readGuide(topicId, measured);
          topic = { topicId, title: guide.title, summary: guide.summary };
          searchable = `${topicId} ${guide.text}`.toLowerCase();
        } catch (error) {
          // A refused guide is listed as unavailable; it never hides the other topics.
          topic = { topicId, error: error.code ? "This usage guide could not be read in this application release." : error.message };
          const size = measured.bytes === undefined ? "size unknown"
            : `${measured.bytes} bytes${measured.characters === undefined ? "" : `, ${measured.characters} characters`}`;
          const warning = `Colleague usage guide ${path.join(directory, entry.name)} (${size}) is unavailable: ${error.message}`;
          if (!warned.has(warning)) { warned.add(warning); console.warn(warning); }
        }
        if (terms.some(term => !searchable.includes(term))) continue;
        topics.push(topic);
      }
      const page = topics.slice(offset, offset + limit);
      const hasMore = offset + page.length < topics.length;
      return { ok: true, topics: page, total: topics.length, hasMore, ...(hasMore ? { nextOffset: offset + page.length } : {}) };
    },
    async guide({ topicId }) {
      try { return { ok: true, ...await readGuide(topicId) }; }
      catch (error) {
        if (["ENOENT", "ELOOP"].includes(error.code)) return { ok: false, topicId, error: "That usage topic is unavailable in this application release. Search the topic list for an available guide." };
        throw error;
      }
    }
  };
}

export { createColleagueUsageKnowledge, maxGuideCharacters };
