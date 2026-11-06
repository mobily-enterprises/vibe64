import { dataTransferItemEntry } from "@/lib/browser.js";

// What each Files area is called and promises, in one place for the session
// Files tool, the project Files page and the move-or-copy destinations.
const VIBE64_FILE_AREAS = Object.freeze({
  repo: { label: "Repo", icon: "$book", scope: "session",
    description: "The session's project files · Changes appear in Current changes" },
  "drop-zone": { label: "Session Dropzone", icon: "$uploadArrow", scope: "session",
    description: "This session only · Deleted when the session is archived" },
  session: { label: "Session", icon: "$folderManaged", scope: "session", readOnly: true,
    description: "Session runtime files · Read only" },
  "project-drop-zone": { label: "Project Dropzone", icon: "$driveFileMove", scope: "project",
    description: "Shared by every session in this project · Files stay until you delete them" },
  backups: { label: "Project Backups", icon: "$pendingActions", scope: "project",
    description: "Shared by every session in this project · Each file is deleted 2 weeks after its last change" }
});

function vibe64FileArea(area = "") {
  return VIBE64_FILE_AREAS[area] || { label: "Files", icon: "$folderManaged", scope: "session", description: "" };
}

// What a finished move or copy did, such as
// "Copied “a.txt” to Project Backups › 2026 as “a (1).txt”." A skipped item
// changed nothing, so it has no message.
function vibe64FileTransferMessage({ destination, item, mode, path: placed = "", skipped = false }) {
  if (skipped) return "";
  const parts = placed.split("/");
  const where = [destination.label, ...parts.slice(0, -1)].join(" › ");
  const renamed = parts.at(-1) !== item.name ? ` as “${parts.at(-1)}”` : "";
  return `${mode === "move" ? "Moved" : "Copied"} “${item.name}” to ${where}${renamed}.`;
}

// The files in a drop. Uploads take files, so a dropped folder is refused.
function vibe64DroppedFiles(dataTransfer) {
  if ([...(dataTransfer?.items || [])].some((item) => dataTransferItemEntry(item)?.isDirectory)) {
    throw new Error("Drop files rather than folders, or upload a zip of the folder.");
  }
  return [...(dataTransfer?.files || [])];
}

export { VIBE64_FILE_AREAS, vibe64DroppedFiles, vibe64FileArea, vibe64FileTransferMessage };
