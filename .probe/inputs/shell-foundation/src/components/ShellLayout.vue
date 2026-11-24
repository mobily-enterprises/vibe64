<script>
import { h } from "vue";
import PackageShellLayout from "@jskit-ai/shell-web/client/components/ShellLayout";

export default {
  name: "ShellLayout",
  inheritAttrs: false,
  setup(_, { attrs, slots }) {
    // Keep drawerWidth, railWidth, navigationItemSpacing, and future shell props package-owned.
    return () => h(PackageShellLayout, attrs, slots);
  }
};
</script>
