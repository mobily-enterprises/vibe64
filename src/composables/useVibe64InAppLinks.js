import { onMounted, onUnmounted } from "vue";
import { useRouter } from "vue-router";

export function useVibe64InAppLinks() {
  const router = useRouter();

  function navigateAppLink(event) {
    if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) {
      return;
    }
    const anchor = event.target?.closest?.("a[href]");
    if (!anchor || anchor.hasAttribute("download") || anchor.relList.contains("external")) {
      return;
    }
    const target = anchor.getAttribute("target");
    if (target && target.toLowerCase() !== "_self") {
      return;
    }
    const href = anchor.getAttribute("href");
    if (!href || href.startsWith("#")) {
      return;
    }

    let url;
    try {
      url = new URL(anchor.href);
    } catch {
      return;
    }
    if (
      url.origin !== window.location.origin ||
      !["http:", "https:"].includes(url.protocol) ||
      url.username || url.password
    ) {
      return;
    }
    const path = `${url.pathname}${url.search}${url.hash}`;
    const route = router.resolve(path);
    // The shell's catch-all also matches API, download and unknown paths.
    if (!route.matched.length || route.name === "not-found") {
      return;
    }

    event.preventDefault();
    void router.push(path);
  }

  // Bubble after component-owned actions (including source links and RouterLink).
  // Listen on the document so links in teleported dialogs use the same routing.
  onMounted(() => document.addEventListener("click", navigateAppLink));
  onUnmounted(() => document.removeEventListener("click", navigateAppLink));
}
