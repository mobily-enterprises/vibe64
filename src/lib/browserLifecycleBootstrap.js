import {
  connectBrowserLifecycleSocket
} from "@/lib/browserLifecycle.js";

function bootBrowserLifecycle(options = {}) {
  return connectBrowserLifecycleSocket(options);
}

export {
  bootBrowserLifecycle
};
