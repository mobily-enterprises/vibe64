import { defineComponent, h, markRaw, onBeforeUnmount, ref, shallowRef } from "vue";
import Vibe64AsyncModuleState from "@/components/common/Vibe64AsyncModuleState.vue";
import {
  isVibe64AsyncImportError,
  notifyVibe64AsyncModuleError,
  reloadVibe64App,
  vibe64AsyncModuleErrorMessage
} from "@/lib/vibe64AsyncModuleCore.js";

function resolvedModuleComponent(moduleValue) {
  return moduleValue?.default || moduleValue;
}

function defineVibe64AsyncComponent({
  label = "Vibe64 module",
  loader,
  minHeight = ""
} = {}) {
  if (typeof loader !== "function") {
    throw new TypeError("defineVibe64AsyncComponent requires a loader function.");
  }

  return defineComponent({
    name: "Vibe64AsyncComponent",
    inheritAttrs: false,
    setup(_props, context) {
      const component = shallowRef(null);
      const error = ref(null);
      const loading = ref(false);
      let disposed = false;
      let requestId = 0;

      async function load() {
        const activeRequestId = requestId + 1;
        requestId = activeRequestId;
        loading.value = true;
        error.value = null;
        try {
          const loaded = resolvedModuleComponent(await loader());
          if (disposed || activeRequestId !== requestId) {
            return false;
          }
          component.value = markRaw(loaded);
          return true;
        } catch (loadError) {
          if (disposed || activeRequestId !== requestId) {
            return false;
          }
          component.value = null;
          error.value = loadError;
          notifyVibe64AsyncModuleError(loadError, {
            label,
            retry: load,
            stale: isVibe64AsyncImportError(loadError)
          });
          return false;
        } finally {
          if (!disposed && activeRequestId === requestId) {
            loading.value = false;
          }
        }
      }

      onBeforeUnmount(() => {
        disposed = true;
        requestId += 1;
      });

      void load();

      return () => {
        if (component.value) {
          return h(component.value, context.attrs, context.slots);
        }
        const errorValue = error.value;
        const stale = isVibe64AsyncImportError(errorValue);
        return h(Vibe64AsyncModuleState, {
          class: context.attrs.class,
          style: context.attrs.style,
          label,
          loading: loading.value,
          message: errorValue
            ? vibe64AsyncModuleErrorMessage(errorValue, {
                label,
                stale
              })
            : `Loading ${label}.`,
          minHeight,
          stale,
          onReload: reloadVibe64App,
          onRetry: load
        });
      };
    }
  });
}

export {
  defineVibe64AsyncComponent
};
