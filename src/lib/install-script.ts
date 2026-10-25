// Shared by the root layout (a server component) and the client install code, so it lives
// outside any "use client" module: a constant imported from one would reach the server as a
// client reference, not as the string.

/** Fired by the layout script (and the install code) whenever installability changes. */
export const INSTALL_CHANGE_EVENT = "gd-install-change";

/**
 * Runs before hydration, inline in <head>: keeps Chromium's install prompt for the app's own
 * Install button (which also stops Chrome's mini-infobar) and notes an install in this tab.
 */
export const INSTALL_CAPTURE_SCRIPT = [
  "window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();window.__gdInstallPrompt=e;",
  `window.dispatchEvent(new Event('${INSTALL_CHANGE_EVENT}'))});`,
  "window.addEventListener('appinstalled',function(){window.__gdInstallPrompt=null;window.__gdInstalled=true;",
  `window.dispatchEvent(new Event('${INSTALL_CHANGE_EVENT}'))});`,
].join("");
