import { describe, expect, it } from "vitest";
import {
  appendPromptAttachmentReferences,
  promptAttachmentReference
} from "../../src/lib/aiStudioPromptAttachments.js";

describe("aiStudioPromptAttachments", () => {
  it("formats uploaded files as Codex-readable prompt references", () => {
    expect(promptAttachmentReference({
      containerPath: "/studio-attachments/session/file.txt",
      fileName: "file.txt",
      size: 512
    })).toBe("- file.txt (512 B): /studio-attachments/session/file.txt");
  });

  it("appends attachment references without replacing prompt text", () => {
    const prompt = appendPromptAttachmentReferences("Please inspect this.", [
      {
        containerPath: "/studio-attachments/session/a.png",
        fileName: "a.png",
        size: 2048
      }
    ]);

    expect(prompt).toBe([
      "Please inspect this.",
      "",
      "Attached files for Codex:",
      "- a.png (2.0 KB): /studio-attachments/session/a.png"
    ].join("\n"));
  });

  it("adds later uploads to the existing attachment section", () => {
    const firstPrompt = appendPromptAttachmentReferences("Review these.", [
      {
        containerPath: "/studio-attachments/session/first.txt",
        fileName: "first.txt"
      }
    ]);
    const nextPrompt = appendPromptAttachmentReferences(firstPrompt, [
      {
        containerPath: "/studio-attachments/session/second.txt",
        fileName: "second.txt"
      }
    ]);

    expect(nextPrompt).toBe([
      "Review these.",
      "",
      "Attached files for Codex:",
      "- first.txt: /studio-attachments/session/first.txt",
      "- second.txt: /studio-attachments/session/second.txt"
    ].join("\n"));
  });
});
