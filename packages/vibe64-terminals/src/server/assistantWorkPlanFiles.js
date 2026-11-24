// A plan's files on disk: reading one safely (no links, bounded size) and naming any Vibe64 cannot use, with what is
// wrong and what to do, so one such file never stops the plan.
import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import path from "node:path";
import { AppError } from "@jskit-ai/kernel/server/runtime";
import { parseWorkPlanLines } from "../shared/assistantWorkPlan.js";
import { sha256Hex } from "@local/vibe64-core/server/sha256Hex";

const PLAN_LIMIT = 256 * 1024;
const INVALID_FILE = "The plan must be a regular Markdown file smaller than 256 KiB.";

function planError(message, code, params) {
  return new AppError(409, message, { code, params });
}

// What is wrong with a plan file Vibe64 cannot use, in a few words: its permissions, or the plan refusal's own message.
function planFileProblem(error) {
  if (error?.params?.problem) return error.params.problem;
  if (["EACCES", "EPERM"].includes(error?.code)) {
    return "Vibe64 is not allowed to read it: it belongs to another account or its permissions changed";
  }
  if (error instanceof AppError) return error.message;
  return `Vibe64 could not read it (${error?.code || error?.message || "unknown error"})`;
}

/**
 * The refusal for a plan file the plan cannot do without (the current plan's record or documents): the file,
 * what is wrong with it and what to do. A plan refusal of its own keeps its code and message and gains the file.
 * @param {string} file
 * @param {Error} error
 */
function planFileError(file, error) {
  if (error instanceof AppError && error.params?.path) return error;
  const problem = planFileProblem(error);
  if (error instanceof AppError) {
    return planError(`${error.message} The file is ${file}.`, error.code, { ...error.params, path: file, problem });
  }
  const permission = ["EACCES", "EPERM"].includes(error?.code);
  return planError(
    `${problem}, so Vibe64 cannot use the plan file ${file}. ` + (permission
      ? "Give that file back to the account Vibe64 runs as (its owner and permissions), then run the plan command again."
      : "Check the disk and that file, then run the plan command again."),
    "vibe64_work_plan_file_unreadable",
    { path: file, problem }
  );
}

// One sentence naming each plan file a read or cleanup skipped and what was skipped, for the AI and the person.
function planFileWarning(problems) {
  if (!problems.length) return "";
  const named = problems.map(({ path: file, problem }) => `${file} (${problem})`).join("; ");
  return `Vibe64 skipped ${problems.length === 1 ? "a plan file" : `${problems.length} plan files`} it cannot use: ${named}. ` +
    "The current plan and the rest of Plan history still work; an archived plan in such a file is not listed, and " +
    "nothing it may still need is cleaned up. To bring it back, give the file back to the account Vibe64 runs as, " +
    "or restore it from a backup.";
}

function withPlanFileProblems(result, problems) {
  return problems.length ? { ...result, planFileProblems: problems, warning: planFileWarning(problems) } : result;
}

async function readPlanFile(file, options = {}) {
  const { plainText = false, limit = PLAN_LIMIT } = options;
  let handle;
  try {
    if (!(await lstat(path.dirname(file))).isDirectory()) throw planError("The plan directory must not be a link.", "vibe64_work_plan_directory_link");
    handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const info = await handle.stat();
    if (!info.isFile() || info.size > limit) throw planError(INVALID_FILE, "vibe64_work_plan_file_invalid");
    const text = await handle.readFile("utf8");
    if (Buffer.byteLength(text) > limit) throw planError("The plan is too large.", "vibe64_work_plan_too_large");
    if (plainText) return text;
    const status = /^Status: (active|completed)\r?$/mu.exec(text)?.[1];
    if (!status) throw planError("This plan needs the stopped-service state upgrade before it can be used.", "vibe64_work_plan_upgrade_required");
    const items = parseWorkPlanLines(text).filter((item) => item.checked !== undefined);
    return {
      text,
      status,
      revision: sha256Hex(text),
      title: /^# (.+)$/mu.exec(text)?.[1]?.trim() || "Untitled plan",
      // Built counts built and proven items ([~] or [x]); checked counts proven ones ([x]).
      built: items.filter((item) => item.built).length,
      checked: items.filter((item) => item.checked).length,
      total: items.length
    };
  } catch (error) {
    if (error.code === "ENOENT") return null;
    // A link in a plan file's place (O_NOFOLLOW's ELOOP) is not a regular file.
    if (error.code === "ELOOP") throw planFileError(file, planError(INVALID_FILE, "vibe64_work_plan_file_invalid"));
    throw planFileError(file, error);
  } finally {
    await handle?.close();
  }
}

export { PLAN_LIMIT, planError, planFileError, planFileProblem, planFileWarning, readPlanFile, withPlanFileProblems };
