import path from "node:path";
import { createWatchSources } from "./watchSources.js";
import { createColleagueServiceState } from "./colleagueServiceState.js";
import { createColleagueRecords } from "./colleagueRecords.js";
import { createColleagueThreads } from "./colleagueThreads.js";
import { createColleagueConversations } from "./colleagueConversations.js";
import { createColleagueWorker } from "./colleagueWorker.js";
import { createColleagueWatches } from "./colleagueWatches.js";
import { createColleagueHistory } from "./colleagueHistory.js";
import { createColleagueFocusAndNavigation } from "./focusAndNavigation.js";
import { createColleagueBrowserConversations } from "./browserConversations.js";
import { createColleagueTurns } from "./colleagueTurns.js";

/** @typedef {import("@jskit-ai/kernel/server/types").ActionCatalogue} ActionCatalogue */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEvents} RuntimeEvents */
/** @typedef {import("@local/vibe64-accounts/server/types").AccountsService} AccountsService */
/** @typedef {import("@local/vibe64-terminals/server/types").TerminalsService} TerminalsService */
/** @typedef {import("./types.js").ColleagueNameResolver} ColleagueNameResolver */

/**
 * One Colleague service: its concerns share one service state and are built
 * once, each from the concerns it calls.
 * @param {object} dependencies
 * @param {ActionCatalogue} dependencies.actions
 * @param {AccountsService} dependencies.accounts
 * @param {TerminalsService} dependencies.terminals
 * @param {string} dependencies.systemRoot
 * @param {RuntimeEvents} dependencies.events
 * @param {ColleagueNameResolver} dependencies.resolveName
 * @param {number} [dependencies.watchPollMs]
 * @param {number} [dependencies.watchDebounceMs]
 */
function createColleagueService({ actions, accounts, terminals, systemRoot, events, resolveName, watchPollMs = 30000, watchDebounceMs = 250 }) {
  if (!path.isAbsolute(systemRoot || "")) throw new TypeError("Colleague needs the private application system root.");
  const serviceState = createColleagueServiceState();
  const records = createColleagueRecords({ actions, terminals, events, serviceState });
  const threads = createColleagueThreads({ systemRoot, serviceState, records });
  const conversations = createColleagueConversations({ actions, accounts, terminals, serviceState, records, threads });
  const watchSources = createWatchSources();
  const worker = createColleagueWorker({
    actions, terminals, watchSources, watchPollMs, watchDebounceMs, serviceState, records, threads, conversations, resolveName
  });
  const watches = createColleagueWatches({ events, watchSources, watchDebounceMs, serviceState, records, threads, worker });
  const history = createColleagueHistory({ serviceState, records, threads, worker, watches });
  const navigation = createColleagueFocusAndNavigation({ threads });
  const browserConversations = createColleagueBrowserConversations({ actions, serviceState, records, threads, conversations });
  const turns = createColleagueTurns({ terminals, serviceState, records, threads, conversations, worker });

  return Object.freeze({
    browserConversations,
    registerConversationSource: watches.registerConversationSource,
    registerWatchSource: watches.registerWatchSource,
    listWatchSources: watches.listWatchSources,
    watchState: watches.watchState,
    read: turns.read,
    startFresh: history.startFresh,
    readHistory: history.readHistory,
    readHistoryPage: history.readHistoryPage,
    listWatches: watches.listWatches,
    assignment: watches.assignment,
    summarize: turns.summarize,
    watch: watches.watch,
    cancelWatch: watches.cancelWatch,
    pauseWatch: watches.pauseWatch,
    resumeWatch: watches.resumeWatch,
    selectModel: turns.selectModel,
    context: navigation.context,
    focus: navigation.focus,
    navigate: navigation.navigate,
    guide: navigation.guide,
    acknowledgeNavigation: navigation.acknowledgeNavigation,
    send: turns.send,
    stop: turns.stop,
    wait: turns.wait,
    close: turns.close
  });
}

export { createColleagueService };
