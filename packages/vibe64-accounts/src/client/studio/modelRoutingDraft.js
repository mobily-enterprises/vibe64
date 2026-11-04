import { watch } from "vue";
import { ASSISTANT_ROLE_DEFAULT_FOLLOWS, ASSISTANT_ROUTING_ROLE_DEFINITIONS, ASSISTANT_SETUP_ROLES } from "@local/vibe64-runtime/shared/assistantRouting";
import { routeKey } from "./ModelRoutingRow.vue";

// The Models form's setups, role groups and drafts. A draft holds draft[setup][role]: a selection, null (off) or
// { follows }; absent roles stay absent.
const SETUPS = [{ id: "owner", label: "Owner (you)" }, { id: "nonOwner", label: "Team members" }];
const GROUPS = [{ id: "main", label: "Main chat" }, { id: "helpers", label: "Helpers" }];
const MAIN_AI_ROLES = ["senior", "junior", "router", "quickHelper"];
const PLAIN_ROLES = { senior: "Building", junior: "Quick tasks", quickHelper: "Background helpers", router: "Request routing" };

const rolesFor = (setupId, group) => ASSISTANT_ROUTING_ROLE_DEFINITIONS.filter(({ id, group: roleGroup }) =>
  ASSISTANT_SETUP_ROLES[setupId].includes(id) && (!group || roleGroup === group));
const groupsFor = (setupId) => GROUPS.filter(({ id }) => rolesFor(setupId, id).length);

function sameValue(left, right) {
  if (left?.follows || right?.follows) return left?.follows === right?.follows;
  return routeKey(left) === routeKey(right) && left?.variantId === right?.variantId && left?.agentId === right?.agentId;
}

// An unsaved following role shows its default "Same as"; it is saved with its
// setup's first real change.
function implicitFollows(savedValues, setupId, role, value) {
  return !Object.hasOwn(savedValues[setupId], role) && Boolean(value?.follows) && value.follows === ASSISTANT_ROLE_DEFAULT_FOLLOWS[setupId][role];
}

// Each setup's roles whose draft differs from the saved value, kept only when one of them is a real change.
function routingChanges(values, savedValues) {
  return Object.fromEntries(SETUPS.map(({ id: setupId }) => {
    const changed = Object.entries(values[setupId])
      .filter(([role, value]) => !sameValue(value, savedValues[setupId][role]) || (value === null) !== (savedValues[setupId][role] === null));
    return [setupId, changed.some(([role, value]) => !implicitFollows(savedValues, setupId, role, value)) ? Object.fromEntries(changed) : {}];
  }).filter(([, roles]) => Object.keys(roles).length));
}

// A read draft starts every following role it leaves out at its default "Same as".
function addDefaultFollows(draft) {
  for (const { id: setupId } of SETUPS) for (const [role, follows] of Object.entries(ASSISTANT_ROLE_DEFAULT_FOLLOWS[setupId])) {
    if (!Object.hasOwn(draft[setupId], role)) draft[setupId][role] = { follows };
  }
}

// Resolves once ready() is true.
function until(ready) {
  return new Promise((resolve) => {
    const stop = watch(ready, (value) => { if (value) { queueMicrotask(() => stop()); resolve(); } }, { immediate: true });
  });
}

export { GROUPS, MAIN_AI_ROLES, PLAIN_ROLES, SETUPS, addDefaultFollows, groupsFor, implicitFollows, rolesFor, routingChanges, sameValue, until };
