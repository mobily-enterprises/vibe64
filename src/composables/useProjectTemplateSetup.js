import {
  computed,
  ref,
  watch
} from "vue";
import {
  mdiAccountCircleOutline,
  mdiAccountGroupOutline,
  mdiArrowRight,
  mdiCheckCircle,
  mdiCreationOutline,
  mdiDatabaseOutline,
  mdiRocketLaunchOutline,
  mdiTuneVariant,
  mdiWeb
} from "@mdi/js";

const TEMPLATE_ICONS = Object.freeze({
  account: mdiAccountCircleOutline,
  database: mdiDatabaseOutline,
  web: mdiWeb,
  workspaces: mdiAccountGroupOutline
});

function useProjectTemplateSetup(props, emit) {
  const selectedTemplateId = ref("");
  const templates = computed(() => (
    Array.isArray(props.templates) ? props.templates : []
  ));
  const selectedTemplate = computed(() => templates.value
    .find((template) => template.id === selectedTemplateId.value) || null);
  const applying = computed(() => Boolean(props.applyingTemplateId));

  watch(templates, (availableTemplates) => {
    if (
      selectedTemplateId.value &&
      !availableTemplates.some((template) => template.id === selectedTemplateId.value)
    ) {
      selectedTemplateId.value = "";
    }
  });

  function templateIcon(template = {}) {
    return TEMPLATE_ICONS[template.icon] || mdiRocketLaunchOutline;
  }

  function selectTemplate(template = {}) {
    if (!applying.value) {
      selectedTemplateId.value = String(template.id || "");
    }
  }

  function applySelectedTemplate() {
    if (selectedTemplate.value && !applying.value) {
      emit("apply", selectedTemplate.value.id);
    }
  }

  function openAdvancedSetup() {
    if (!applying.value) {
      emit("advanced");
    }
  }

  return {
    applySelectedTemplate,
    applying,
    mdiArrowRight,
    mdiCheckCircle,
    mdiCreationOutline,
    mdiRocketLaunchOutline,
    mdiTuneVariant,
    openAdvancedSetup,
    selectedTemplate,
    selectedTemplateId,
    selectTemplate,
    templateIcon,
    templates
  };
}

export {
  TEMPLATE_ICONS,
  useProjectTemplateSetup
};
