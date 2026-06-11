import { computed, proxyRefs } from "vue";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useEndpointResource } from "@jskit-ai/users-web/client/composables/useEndpointResource";
import {
  VIBE64_SURFACE_ID
} from "@/lib/vibe64RequestConfig.js";
import {
  PROJECT_SELECTION_ENDPOINT,
  projectSelectionQueryKey
} from "@/lib/studioGateApi.js";
import {
  studioApiPath
} from "@/lib/studioUrls.js";
import {
  readRefOrGetterBoolean,
  readRefOrGetterValue
} from "@/lib/vueRefOrGetterValue.js";
import {
  vibe64ProjectQueryScope
} from "@/lib/vibe64ProjectScope.js";
import {
  vibe64ApiResponseError,
  vibe64ResourceResponseError
} from "@/lib/vibe64ApiResponses.js";

const GITHUB_REPOSITORY_OWNERS_ENDPOINT = studioApiPath("vibe64/github/repository-owners");
const GITHUB_REPOSITORIES_SEARCH_ENDPOINT = studioApiPath("vibe64/github/repositories/search");

function useVibe64ProjectsResource({
  projectSlug = "",
  fallbackLoadError = "Projects could not load.",
  requestRecoveryLabel = "Projects"
} = {}) {
  const slug = computed(() => normalizeText(readRefOrGetterValue(projectSlug)));
  const resource = useEndpointResource({
    fallbackLoadError,
    path: PROJECT_SELECTION_ENDPOINT,
    queryKey: computed(() => projectSelectionQueryKey(VIBE64_SURFACE_ID, ROUTE_VISIBILITY_PUBLIC, slug.value)),
    refreshOnPull: true,
    requestRecoveryLabel: requestRecoveryLabel
  });
  const loadError = computed(() => vibe64ResourceResponseError(resource.data.value, fallbackLoadError) || resource.loadError.value);
  const projectsRoot = computed(() => String(resource.data.value?.projectsRoot || ""));
  const targetRoot = computed(() => String(resource.data.value?.targetRoot || ""));
  const projects = computed(() => Array.isArray(resource.data.value?.projects) ? resource.data.value.projects : []);

  return proxyRefs({
    data: resource.data,
    isFetching: resource.isFetching,
    isInitialLoading: resource.isInitialLoading,
    isLoading: resource.isLoading,
    isRefetching: resource.isRefetching,
    loadError,
    projects,
    projectsRoot,
    reload: resource.reload,
    resource,
    targetRoot
  });
}

function useVibe64ProjectAccessResource(projectSlug) {
  const slug = computed(() => normalizeText(readRefOrGetterValue(projectSlug)));
  const resource = useEndpointResource({
    enabled: computed(() => Boolean(slug.value)),
    fallbackLoadError: "Project access could not load.",
    path: computed(() => slug.value ? vibe64ProjectAccessPath(slug.value) : ""),
    queryKey: computed(() => vibe64ProjectAccessQueryKey(slug.value)),
    refreshOnPull: true,
    requestRecoveryLabel: "Project access"
  });
  const loadError = computed(() => vibe64ResourceResponseError(resource.data.value, "Project access could not load.") || resource.loadError.value);
  const status = computed(() => resource.data.value || null);
  const users = computed(() => Array.isArray(status.value?.users) ? status.value.users : []);
  const canManageAccess = computed(() => status.value?.currentUserCanManageAccess === true);
  const tenantCountLabel = computed(() => {
    const limit = status.value?.userLimit;
    return limit ? `${users.value.length} / ${limit}` : String(users.value.length);
  });

  return proxyRefs({
    canManageAccess,
    data: resource.data,
    isFetching: resource.isFetching,
    isInitialLoading: resource.isInitialLoading,
    isLoading: resource.isLoading,
    isRefetching: resource.isRefetching,
    loadError,
    reload: resource.reload,
    resource,
    status,
    tenantCountLabel,
    users
  });
}

function useVibe64GithubRepositoryOwnersResource() {
  const resource = useEndpointResource({
    fallbackLoadError: "GitHub owners could not load.",
    path: GITHUB_REPOSITORY_OWNERS_ENDPOINT,
    queryKey: ["vibe64", "project", "unscoped", VIBE64_SURFACE_ID, ROUTE_VISIBILITY_PUBLIC, "github", "repository-owners"],
    refreshOnPull: true,
    requestRecoveryLabel: "GitHub repository owners"
  });
  const loadError = computed(() => vibe64ResourceResponseError(resource.data.value, "GitHub owners could not load.") || resource.loadError.value);
  const owners = computed(() => Array.isArray(resource.data.value?.owners) ? resource.data.value.owners : []);

  return proxyRefs({
    data: resource.data,
    isFetching: resource.isFetching,
    isInitialLoading: resource.isInitialLoading,
    isLoading: resource.isLoading,
    isRefetching: resource.isRefetching,
    loadError,
    owners,
    reload: resource.reload,
    resource
  });
}

function useVibe64GithubRepositoriesResource(owner, {
  enabled = true
} = {}) {
  const normalizedOwner = computed(() => normalizeText(readRefOrGetterValue(owner)));
  const resource = useEndpointResource({
    enabled: computed(() => Boolean(normalizedOwner.value) && readRefOrGetterBoolean(enabled)),
    fallbackLoadError: "Repository list failed.",
    path: GITHUB_REPOSITORIES_SEARCH_ENDPOINT,
    queryKey: computed(() => [
      "vibe64",
      "project",
      "unscoped",
      VIBE64_SURFACE_ID,
      ROUTE_VISIBILITY_PUBLIC,
      "github",
      "repositories",
      normalizedOwner.value
    ]),
    readQuery: computed(() => ({
      owner: normalizedOwner.value,
      q: ""
    })),
    refreshOnPull: true,
    requestRecoveryLabel: "GitHub repositories"
  });
  const loadError = computed(() => vibe64ResourceResponseError(resource.data.value, "Repository list failed.") || resource.loadError.value);
  const repositories = computed(() => Array.isArray(resource.data.value?.repositories) ? resource.data.value.repositories : []);

  return proxyRefs({
    data: resource.data,
    isFetching: resource.isFetching,
    isInitialLoading: resource.isInitialLoading,
    isLoading: resource.isLoading,
    isRefetching: resource.isRefetching,
    loadError,
    reload: resource.reload,
    repositories,
    resource
  });
}

function vibe64ProjectAccessPath(slug = "") {
  return `${PROJECT_SELECTION_ENDPOINT}/${encodeURIComponent(String(slug || ""))}/access`;
}

function vibe64ProjectAccessInvitePath(slug = "") {
  return `${vibe64ProjectAccessPath(slug)}/invite`;
}

function vibe64ProjectRepositoryCreatePath() {
  return `${PROJECT_SELECTION_ENDPOINT}/create-repository`;
}

function vibe64ProjectRepositoryOpenPath() {
  return `${PROJECT_SELECTION_ENDPOINT}/from-repository`;
}

function vibe64ProjectAccessQueryKey(slug = "") {
  return [
    "vibe64",
    ...vibe64ProjectQueryScope(slug),
    VIBE64_SURFACE_ID,
    ROUTE_VISIBILITY_PUBLIC,
    "project-access"
  ];
}

function apiResponseError(response = {}, fallback = "Vibe64 request failed.") {
  return vibe64ApiResponseError(response, fallback);
}

function normalizeText(value = "") {
  return String(value || "").trim();
}

export {
  GITHUB_REPOSITORIES_SEARCH_ENDPOINT,
  GITHUB_REPOSITORY_OWNERS_ENDPOINT,
  apiResponseError,
  useVibe64GithubRepositoriesResource,
  useVibe64GithubRepositoryOwnersResource,
  useVibe64ProjectAccessResource,
  useVibe64ProjectsResource,
  vibe64ProjectAccessInvitePath,
  vibe64ProjectAccessPath,
  vibe64ProjectRepositoryCreatePath,
  vibe64ProjectRepositoryOpenPath
};
