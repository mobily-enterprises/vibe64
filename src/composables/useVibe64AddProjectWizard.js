import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useCommand } from "@jskit-ai/users-web/client/composables/useCommand";
import {
  mdiAlertCircle,
  mdiArrowLeft,
  mdiCheckCircle,
  mdiClose,
  mdiEarth,
  mdiFolderOpen,
  mdiLock,
  mdiMagnify,
  mdiPlus,
  mdiSourceRepository
} from "@mdi/js";
import {
  VIBE64_SURFACE_ID
} from "@/lib/vibe64RequestConfig.js";
import {
  apiResponseError,
  useVibe64GithubRepositoriesResource,
  useVibe64GithubRepositoryOwnersResource,
  vibe64ProjectRepositoryCreatePath,
  vibe64ProjectRepositoryOpenPath
} from "@/composables/useVibe64ProjectManagement.js";

function useVibe64AddProjectWizard({
  onCreated = () => null
} = {}) {
  const step = ref("project");
  const repositoryMode = ref("existing");
  const autocompleteRoot = ref(null);
  const projectSlug = ref("");
  const openOwner = ref("");
  const openName = ref("");
  const openResultsExpanded = ref(false);
  const openSelectedRepository = ref(null);
  const createOwner = ref("");
  const createName = ref("");
  const createDescription = ref("");
  const createNameEdited = ref(false);
  const createVisibility = ref("private");
  const formError = ref("");
  const success = ref(null);
  const repositoryOwners = useVibe64GithubRepositoryOwnersResource();
  const repositorySearchEnabled = computed(() => (
    step.value === "repository" &&
    repositoryMode.value === "existing" &&
    Boolean(openOwner.value)
  ));
  const ownerRepositories = useVibe64GithubRepositoriesResource(openOwner, {
    enabled: repositorySearchEnabled
  });
  const addExistingProjectCommand = useCommand({
    access: "never",
    apiSuffix: "/vibe64/projects",
    buildCommandOptions: () => ({
      method: "POST",
      path: vibe64ProjectRepositoryOpenPath()
    }),
    buildRawPayload: (_model, { context }) => ({
      repository: context.repository || "",
      slug: context.slug || ""
    }),
    fallbackRunError: "Project could not be added.",
    messages: {
      error: "Project could not be added.",
      success: "Project added."
    },
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: "vibe64.projects.open-repository",
    suppressSuccessMessage: true,
    surfaceId: VIBE64_SURFACE_ID,
    writeMethod: "POST"
  });
  const createRepositoryProjectCommand = useCommand({
    access: "never",
    apiSuffix: "/vibe64/projects",
    buildCommandOptions: () => ({
      method: "POST",
      path: vibe64ProjectRepositoryCreatePath()
    }),
    buildRawPayload: (_model, { context }) => ({
      description: context.description || "",
      name: context.name || "",
      owner: context.owner || "",
      slug: context.slug || "",
      visibility: context.visibility || "private"
    }),
    fallbackRunError: "Project could not be added.",
    messages: {
      error: "Project could not be added.",
      success: "Project added."
    },
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: "vibe64.projects.create-repository",
    suppressSuccessMessage: true,
    surfaceId: VIBE64_SURFACE_ID,
    writeMethod: "POST"
  });

  const normalizedProjectSlug = computed(() => normalizeProjectSlug(projectSlug.value));
  const projectSlugValid = computed(() => projectSlugIsValid(normalizedProjectSlug.value));
  const stepLabel = computed(() => step.value === "project" ? "Step 1 of 2" : "Step 2 of 2");
  const sourceHeading = computed(() => repositoryMode.value === "create"
    ? "Create new GitHub repository"
    : "Use existing GitHub repository");
  const owners = computed(() => repositoryOwners.owners);
  const ownersLoading = computed(() => repositoryOwners.isInitialLoading);
  const ownersError = computed(() => repositoryOwners.loadError);
  const saving = computed(() => addExistingProjectCommand.isRunning || createRepositoryProjectCommand.isRunning);
  const canContinueToRepository = computed(() => projectSlugValid.value && !saving.value);
  const ownerSelectItems = computed(() => owners.value.map((owner) => ({
    ...owner,
    title: owner.login,
    value: owner.login
  })));
  const createOwnerSelectItems = computed(() => ownerSelectItems.value.filter((owner) => owner.canCreateRepository !== false));
  const selectedCreateOwner = computed(() => owners.value.find((owner) => owner.login === createOwner.value) || null);
  const createAllowed = computed(() => selectedCreateOwner.value?.canCreateRepository !== false);
  const openOwnerRepositories = computed(() => ownerRepositories.repositories);
  const openResults = computed(() => matchingRepositories(openOwnerRepositories.value, openOwner.value, openName.value));
  const openSearching = computed(() => ownerRepositories.isFetching);
  const showOpenResultsPanel = computed(() => {
    return step.value === "repository" &&
      repositoryMode.value === "existing" &&
      openResultsExpanded.value &&
      Boolean(openOwner.value) &&
      (openSearching.value || openOwnerRepositories.value.length > 0 || openName.value.trim());
  });
  const selectedRepositoryFullName = computed(() => {
    return openSelectedRepository.value?.fullName || "";
  });
  const canAddExistingProject = computed(() => {
    return Boolean(projectSlugValid.value && selectedRepositoryFullName.value && !saving.value);
  });
  const canCreateRepositoryProject = computed(() => {
    return Boolean(projectSlugValid.value && createOwner.value && createName.value.trim() && createAllowed.value && !saving.value);
  });
  const commandError = computed(() => {
    if (addExistingProjectCommand.messageType === "error") {
      return String(addExistingProjectCommand.message || "");
    }
    if (createRepositoryProjectCommand.messageType === "error") {
      return String(createRepositoryProjectCommand.message || "");
    }
    return "";
  });
  const visibleFormError = computed(() => String(
    formError.value ||
    (repositoryMode.value === "existing" ? ownerRepositories.loadError : "") ||
    commandError.value ||
    ""
  ));

  onMounted(() => {
    document.addEventListener("pointerdown", handleDocumentPointerDown);
  });

  onBeforeUnmount(() => {
    document.removeEventListener("pointerdown", handleDocumentPointerDown);
  });

  watch(projectSlug, (value) => {
    if (!createNameEdited.value) {
      createName.value = normalizeProjectSlug(value);
    }
  });

  watch(
    owners,
    (value) => {
      if (!openOwner.value && value.length > 0) {
        openOwner.value = value[0].login;
      }
      if (!createOwner.value && value.length > 0) {
        createOwner.value = value.find((owner) => owner.canCreateRepository !== false)?.login || value[0].login;
      }
    },
    {
      immediate: true
    }
  );

  watch(repositoryMode, () => {
    formError.value = "";
    success.value = null;
    closeOpenResults();
  });

  watch([step, openOwner], ([currentStep, owner]) => {
    formError.value = "";
    success.value = null;
    openSelectedRepository.value = null;
    openName.value = "";
    closeOpenResults();
    if (currentStep === "repository" && repositoryMode.value === "existing" && owner) {
      void ownerRepositories.reload();
    }
  });

  watch(openName, (value) => {
    formError.value = "";
    success.value = null;
    const repositoryName = String(value || "").trim();
    if (openSelectedRepository.value?.fullName !== repositoryFullName(openOwner.value, repositoryName)) {
      openSelectedRepository.value = null;
      if (repositoryName) {
        openResultsExpanded.value = true;
      }
    }
  });

  function editProjectSlug(value) {
    projectSlug.value = normalizeProjectSlug(value);
  }

  function editCreateName(value) {
    createNameEdited.value = true;
    createName.value = normalizeGithubRepositoryName(value);
  }

  function continueToRepository() {
    if (!canContinueToRepository.value) {
      return;
    }
    step.value = "repository";
    if (repositoryMode.value === "existing" && openOwner.value) {
      void ownerRepositories.reload();
    }
  }

  function selectRepositoryMode(value) {
    repositoryMode.value = value === "create" ? "create" : "existing";
  }

  function selectRepository(repository = {}) {
    openSelectedRepository.value = repository;
    openOwner.value = repository.owner || repository.fullName?.split("/")[0] || openOwner.value;
    openName.value = repository.name || repository.fullName?.split("/")[1] || "";
    closeOpenResults();
  }

  function showOpenResults() {
    if (step.value === "repository" && repositoryMode.value === "existing" && openOwner.value) {
      openResultsExpanded.value = true;
      void ownerRepositories.reload();
    }
  }

  function closeOpenResults() {
    openResultsExpanded.value = false;
  }

  function handleDocumentPointerDown(event) {
    if (!openResultsExpanded.value || !autocompleteRoot.value) {
      return;
    }
    if (!autocompleteRoot.value.contains(event.target)) {
      closeOpenResults();
    }
  }

  async function submitExistingRepositoryProject() {
    formError.value = "";
    success.value = null;
    try {
      const response = await addExistingProjectCommand.run({
        repository: selectedRepositoryFullName.value,
        slug: normalizedProjectSlug.value
      });
      if (response) {
        handleProjectResponse(response);
      }
    } catch (error) {
      formError.value = String(error?.message || error || "Project could not be added.");
    }
  }

  async function submitNewRepositoryProject() {
    formError.value = "";
    success.value = null;
    try {
      const response = await createRepositoryProjectCommand.run({
        description: createDescription.value,
        name: createName.value.trim(),
        owner: createOwner.value,
        slug: normalizedProjectSlug.value,
        visibility: createVisibility.value
      });
      if (response) {
        handleProjectResponse(response);
      }
    } catch (error) {
      formError.value = String(error?.message || error || "Project could not be added.");
    }
  }

  function handleProjectResponse(response = {}) {
    if (response.ok === false) {
      formError.value = apiResponseError(response);
      return;
    }
    success.value = {
      project: response.project || null,
      repository: response.repository || response.project?.githubRepository || null
    };
    onCreated(response);
  }

  return {
    autocompleteRoot,
    canAddExistingProject,
    canContinueToRepository,
    canCreateRepositoryProject,
    createAllowed,
    createDescription,
    createName,
    createOwner,
    createOwnerSelectItems,
    createVisibility,
    editCreateName,
    editProjectSlug,
    closeOpenResults,
    continueToRepository,
    mdiAlertCircle,
    mdiArrowLeft,
    mdiCheckCircle,
    mdiClose,
    mdiEarth,
    mdiFolderOpen,
    mdiLock,
    mdiMagnify,
    mdiPlus,
    mdiSourceRepository,
    normalizedProjectSlug,
    openName,
    openOwner,
    openResults,
    openSearching,
    openSelectedRepository,
    ownerSelectItems,
    ownersError,
    ownersLoading,
    permissionLabel,
    projectSlug,
    projectSlugValid,
    repositoryMode,
    repositoryVisibilityIcon,
    saving,
    selectRepository,
    selectRepositoryMode,
    selectedCreateOwner,
    showOpenResults,
    showOpenResultsPanel,
    sourceHeading,
    step,
    stepLabel,
    submitExistingRepositoryProject,
    submitNewRepositoryProject,
    success,
    visibleFormError
  };
}

function matchingRepositories(repositories = [], owner = "", query = "") {
  const normalizedQuery = String(query || "").trim().toLowerCase();
  if (!normalizedQuery) {
    return repositories.slice(0, 12);
  }
  const normalizedOwner = String(owner || "").trim().toLowerCase();
  const ownerPrefix = normalizedOwner ? `${normalizedOwner}/` : "";
  const repositoryQuery = normalizedQuery.startsWith(ownerPrefix)
    ? normalizedQuery.slice(ownerPrefix.length)
    : normalizedQuery;
  return repositories
    .filter((repository) => repositoryMatchesQuery(repository, normalizedQuery, repositoryQuery))
    .sort((left, right) => repositoryMatchRank(left, normalizedQuery, repositoryQuery) - repositoryMatchRank(right, normalizedQuery, repositoryQuery))
    .slice(0, 12);
}

function repositoryMatchesQuery(repository = {}, normalizedQuery = "", repositoryQuery = "") {
  return (
    String(repository.name || "").toLowerCase().includes(repositoryQuery) ||
    String(repository.fullName || "").toLowerCase().includes(normalizedQuery)
  );
}

function repositoryMatchRank(repository = {}, normalizedQuery = "", repositoryQuery = "") {
  const name = String(repository.name || "").toLowerCase();
  const fullName = String(repository.fullName || "").toLowerCase();
  if (name === repositoryQuery || fullName === normalizedQuery) {
    return 0;
  }
  if (name.startsWith(repositoryQuery)) {
    return 1;
  }
  if (fullName.startsWith(normalizedQuery)) {
    return 2;
  }
  return 10;
}

function repositoryVisibilityIcon(repository = {}) {
  return repository.isPrivate || repository.visibility === "private" ? mdiLock : mdiEarth;
}

function permissionLabel(repository = {}) {
  if (repository.canPush === true) {
    return "Can push";
  }
  if (repository.canPush === false) {
    return "Read only";
  }
  return "Visible to you";
}

function normalizeProjectSlug(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}

function normalizeGithubRepositoryName(value = "") {
  return String(value || "")
    .trim()
    .replace(/[^A-Za-z0-9_.-]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}

function projectSlugIsValid(value = "") {
  return /^[a-z0-9][a-z0-9_-]*$/u.test(String(value || ""));
}

function repositoryFullName(owner = "", name = "") {
  return `${String(owner || "").trim()}/${String(name || "").trim()}`;
}

export {
  useVibe64AddProjectWizard
};
