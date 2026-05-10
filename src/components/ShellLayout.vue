<script>
import { h } from "vue";
import PackageShellLayout from "@jskit-ai/shell-web/client/components/ShellLayout";

export default {
  name: "ShellLayout",
  inheritAttrs: false,
  setup(_, { attrs, slots }) {
    return () => h(PackageShellLayout, attrs, slots);
  }
};
</script>
