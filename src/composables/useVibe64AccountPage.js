import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useStudioShellDrawer } from "@/composables/useStudioShellDrawer.js";

function useVibe64AccountPage() {
  const route = useRoute();
  const router = useRouter();

  useStudioShellDrawer({
    hidden: true
  });

  const returnPath = computed(() => safeReturnPath(route.query.returnTo));

  async function goBack() {
    await router.push(returnPath.value);
  }

  return {
    goBack,
    returnPath
  };
}

function firstQueryValue(value) {
  return Array.isArray(value) ? value[0] : value;
}

function safeReturnPath(value) {
  const target = String(firstQueryValue(value) || "").trim();
  if (!target || !target.startsWith("/") || target.startsWith("//")) {
    return "/app/manage/projects";
  }
  if (target === "/account" || target.startsWith("/account?")) {
    return "/app/manage/projects";
  }
  if (
    target === "/app/manage" ||
    target.startsWith("/app/manage/") ||
    target.startsWith("/app/manage?")
  ) {
    return target;
  }
  const match = /^\/app\/([^/?#]+)(?:[/?#]|$)/u.exec(target);
  if (match && match[1] !== "manage") {
    return target;
  }
  return "/app/manage/projects";
}

export {
  useVibe64AccountPage
};
