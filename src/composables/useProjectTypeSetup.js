import { computed, ref, watch } from "vue";

const applicationHeadingId = "project-type-setup-application-heading";
const technologyHeadingId = "project-type-setup-technology-heading";

function useProjectTypeSetup(props, emit) {
  const currentStep = ref("application");
  const selectedApplicationTypeId = ref("");
  const showAlternatives = ref(false);
  const showRecommendedDetails = ref(false);

  const saving = computed(() => Boolean(props.savingType));
  const projectTypes = computed(() => {
    return Array.isArray(props.state?.availableProjectTypes)
      ? props.state.availableProjectTypes
          .map(normalizeProjectType)
          .filter((projectType) => projectType.enabled === true)
      : [];
  });
  const applicationTypes = computed(() => {
    return Array.isArray(props.state?.availableApplicationTypes)
      ? props.state.availableApplicationTypes
          .map(normalizeApplicationType)
          .filter((applicationType) => applicationType.adapters.length > 0)
      : [];
  });
  const hasApplicationTypes = computed(() => applicationTypes.value.length > 0);
  const selectedApplicationType = computed(() => {
    return applicationTypes.value.find((applicationType) => applicationType.id === selectedApplicationTypeId.value) ||
      applicationTypes.value[0] ||
      null;
  });
  const adapterChoices = computed(() => {
    return selectedApplicationType.value
      ? selectedApplicationType.value.adapters
      : projectTypes.value;
  });
  const recommendedAdapter = computed(() => adapterChoices.value[0] || null);
  const alternativeAdapters = computed(() => adapterChoices.value.slice(1));
  const recommendedTechnologyHeading = computed(() => {
    if (!recommendedAdapter.value) {
      return selectedApplicationType.value ? `No ready technologies for ${selectedApplicationType.value.label}` : "Choose a technology";
    }
    return `${recommendedAdapter.value.label} is the default`;
  });
  const recommendedTechnologyDescription = computed(() => {
    if (selectedApplicationType.value?.label) {
      return `Recommended for ${selectedApplicationType.value.label}.`;
    }
    return "Use the recommended adapter unless this project needs a specific framework or runtime.";
  });

  function adapterSummary(projectType = {}) {
    return projectType.explanation ||
      projectType.summary ||
      projectType.description ||
      "A configured Vibe64 adapter for this project type.";
  }

  function selectApplicationType(applicationTypeId) {
    selectedApplicationTypeId.value = String(applicationTypeId || "");
    showAlternatives.value = false;
    showRecommendedDetails.value = false;
  }

  function continueToTechnology() {
    if (!selectedApplicationType.value && hasApplicationTypes.value) {
      return;
    }
    showAlternatives.value = false;
    showRecommendedDetails.value = false;
    currentStep.value = "technology";
  }

  function returnToApplication() {
    showAlternatives.value = false;
    showRecommendedDetails.value = false;
    currentStep.value = "application";
  }

  function selectProjectType(projectTypeId = "") {
    emit("select", {
      applicationTypeId: selectedApplicationType.value?.id || "",
      projectType: String(projectTypeId || "")
    });
  }

  watch(applicationTypes, (nextApplicationTypes) => {
    if (
      nextApplicationTypes.length > 0 &&
      !nextApplicationTypes.some((applicationType) => applicationType.id === selectedApplicationTypeId.value)
    ) {
      selectedApplicationTypeId.value = nextApplicationTypes[0].id;
    }
  }, {
    immediate: true
  });

  watch(hasApplicationTypes, (nextHasApplicationTypes) => {
    if (!nextHasApplicationTypes) {
      currentStep.value = "technology";
    }
  }, {
    immediate: true
  });

  return {
    adapterSummary,
    alternativeAdapters,
    applicationHeadingId,
    applicationTypes,
    continueToTechnology,
    currentStep,
    hasApplicationTypes,
    recommendedAdapter,
    recommendedTechnologyDescription,
    recommendedTechnologyHeading,
    returnToApplication,
    saving,
    selectApplicationType,
    selectedApplicationType,
    selectedApplicationTypeId,
    selectProjectType,
    showAlternatives,
    showRecommendedDetails,
    technologyHeadingId
  };
}

function normalizeProjectType(projectType = {}) {
  return {
    ...projectType,
    applicationTypeId: String(projectType.applicationTypeId || ""),
    explanation: String(projectType.explanation || ""),
    techStack: Array.isArray(projectType.techStack) ? projectType.techStack : []
  };
}

function normalizeApplicationType(applicationType = {}) {
  return {
    ...applicationType,
    adapters: Array.isArray(applicationType.adapters)
      ? applicationType.adapters.map(normalizeProjectType)
      : [],
    iconPaths: Array.isArray(applicationType.iconPaths) ? applicationType.iconPaths : [],
    iconViewBox: String(applicationType.iconViewBox || "0 0 64 64")
  };
}

export {
  useProjectTypeSetup
};
