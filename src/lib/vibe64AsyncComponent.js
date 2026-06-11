import {
  dynamicImportErrorMessage,
  isDynamicImportError
} from "@jskit-ai/kernel/client/asyncModuleRecovery";
import {
  useShellAsyncModuleRecoveryRuntime
} from "@jskit-ai/shell-web/client/asyncModuleRecovery";
import { defineComponent, h, markRaw, onBeforeUnmount, ref, shallowRef } from "vue";
import Vibe64AsyncModuleState from "@/components/common/Vibe64AsyncModuleState.vue";

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
      const asyncModuleRecoveryRuntime = useShellAsyncModuleRecoveryRuntime();
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
          asyncModuleRecoveryRuntime?.notify?.(loadError, {
            label,
            stale: isDynamicImportError(loadError)
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
        const stale = isDynamicImportError(errorValue);
        return h(Vibe64AsyncModuleState, {
          class: context.attrs.class,
          style: context.attrs.style,
          label,
          loading: loading.value,
          message: errorValue
            ? dynamicImportErrorMessage(errorValue, {
                label,
                stale
              })
            : `Loading ${label}.`,
          minHeight,
          stale,
          onReload: () => asyncModuleRecoveryRuntime?.reload?.(),
          onRetry: load
        });
      };
    }
  });
}

export {
  defineVibe64AsyncComponent
};
