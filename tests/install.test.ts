import assert from "node:assert/strict";
import { describe, test } from "node:test";
import manifest from "@/app/manifest";
import { installStateFrom } from "@/components/install/install";
import { INSTALL_CAPTURE_SCRIPT, INSTALL_CHANGE_EVENT } from "@/lib/install-script";

describe("installing the app", () => {
  test("offers the browser prompt, iPhone steps, or nothing", () => {
    assert.equal(installStateFrom({ standalone: true, hasPrompt: true, ios: false }), "installed");
    assert.equal(installStateFrom({ standalone: false, hasPrompt: true, ios: false }), "available");
    assert.equal(installStateFrom({ standalone: false, hasPrompt: false, ios: true }), "ios");
    assert.equal(installStateFrom({ standalone: true, hasPrompt: false, ios: true }), "installed");
    assert.equal(installStateFrom({ standalone: false, hasPrompt: false, ios: false }), "unavailable");
  });

  test("the early script keeps the prompt and announces changes", () => {
    assert.match(INSTALL_CAPTURE_SCRIPT, /beforeinstallprompt/);
    assert.match(INSTALL_CAPTURE_SCRIPT, /preventDefault\(\)/);
    assert.match(INSTALL_CAPTURE_SCRIPT, /appinstalled/);
    assert.ok(INSTALL_CAPTURE_SCRIPT.includes(INSTALL_CHANGE_EVENT));
  });

  test("the manifest makes the app installable", () => {
    const m = manifest();
    assert.equal(m.display, "standalone");
    assert.equal(m.start_url, "/");
    assert.ok(m.name && m.short_name);
    const sizes = (m.icons ?? []).map((icon) => `${icon.sizes}:${icon.purpose}`);
    assert.ok(sizes.includes("192x192:any") && sizes.includes("512x512:any") && sizes.includes("512x512:maskable"));
  });
});
