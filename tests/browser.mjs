import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdtemp, mkdir, rm, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const profile = await mkdtemp(path.join(tmpdir(), "hide-my-email-test-"));
const extension = path.join(profile, "extension");
await cp(path.join(root, "extension"), extension, { recursive: true });
const server = http.createServer((request, response) => {
  response.setHeader("Content-Type", "text/html");
  response.end('<!doctype html><html><body style="padding-top:120px"><label>Email <input type="email" id="email"></label><input type="password" id="password"><script>window.inputEvents=0;document.querySelector("#email").addEventListener("input",()=>window.inputEvents++);</script></body></html>');
});
await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
const origin = `http://127.0.0.1:${server.address().port}`;
let context;
try {
  context = await chromium.launchPersistentContext(profile, {
    channel: "chromium", headless: true,
    viewport: { width: 390, height: 600 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
  const extensionId = new URL(worker.url()).host;
  const fixture = {
      mode: "connected", count: 0, reserveDelay: 0, calls: [],
      emails: [{ hme: "quiet.river@icloud.com", label: "example.com", isActive: true, createTimestamp: 10 },
        { hme: "old.address@icloud.com", label: "Archived", isActive: false, createTimestamp: 1 },
        { hme: "safe.label@icloud.com", label: '<img src=x onerror="alert(1)">', isActive: true, createTimestamp: 9 }],
  };
  // Keep Chrome's native WorkerGlobalScope.fetch intact. Replacing it with a
  // JS mock hides illegal-receiver bugs in the extension's request handling.
  await context.route("https://**.icloud.com/**", async route => {
      const request = route.request();
      const url = request.url();
      const f = fixture;
      f.calls.push({ url, method: request.method(), worker: Boolean(request.serviceWorker()), body: request.postData() });
      const reply = data => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(data) });
      if (f.mode === "auth") return route.fulfill({ status: 421, contentType: "application/json", body: "{}" });
      if (f.mode === "offline") return route.abort("internetdisconnected");
      if (url.endsWith("/validate")) return reply({ webservices: { premiummailsettings: { url: "https://p01-maildomainws.icloud.com" } } });
      if (url.endsWith("/list")) return reply({ success: true, result: { hmeEmails: f.emails, selectedForwardTo: "owner@example.com" } });
      if (url.endsWith("/generate")) {
        f.count++;
        return reply({ success: true, result: { hme: `fresh.${f.count}@icloud.com` } });
      }
      if (url.endsWith("/reserve")) {
        if (f.reserveDelay) await new Promise(resolve => setTimeout(resolve, f.reserveDelay));
        if (f.mode === "reserve-fails") return reply({ success: false, error: { errorMessage: "Reservation rejected" } });
        const email = { ...request.postDataJSON(), isActive: true, createTimestamp: Date.now() };
        f.emails.unshift(email);
        return reply({ success: true, result: { hme: email } });
      }
      throw new Error(`Unexpected request ${url}`);
  });

  const form = await context.newPage();
  await form.goto(origin);
  const targetId = await worker.evaluate(async origin => (await chrome.tabs.query({})).find(tab => tab.url?.startsWith(origin)).id, origin);
  async function popup() {
    const page = await context.newPage();
    await page.addInitScript(({ targetId, origin }) => {
      chrome.tabs.query = async () => [{ id: targetId, url: `${origin}/` }];
    }, { targetId, origin });
    await page.goto(`chrome-extension://${extensionId}/popup.html`);
    await page.locator("#workspace").waitFor({ state: "visible", timeout: 10000 });
    return page;
  }
  let page = await popup();
  assert.equal(await page.locator("#label").inputValue(), "127.0.0.1");
  assert.equal(await page.locator("#count").textContent(), "2 active");
  assert.equal(await page.locator("#addresses img").count(), 0, "Labels must render as plain text");
  const rules = await worker.evaluate(() => chrome.declarativeNetRequest.getDynamicRules());
  assert.deepEqual(rules[0].condition.initiatorDomains, [extensionId]);
  assert.ok(fixture.calls.some(call => call.url.endsWith("/validate") && call.worker), "Native worker fetch must reach the network interceptor");
  console.log("PASS: native Chrome worker fetch reaches iCloud endpoints without replacing fetch");

  await page.locator("#search").fill("no-such-label");
  await page.getByText("No matches.", { exact: true }).waitFor();
  await page.locator("#search").fill("");
  await page.locator("#label").fill("newsletter.example");
  await page.locator("#create").click();
  await page.getByText("Created and copied.", { exact: true }).waitFor();
  assert.equal(await page.locator("#created-address").inputValue(), "fresh.1@icloud.com");
  assert.equal(await page.locator("#count").textContent(), "3 active");
  await page.locator("#fill-created").click();
  await page.getByText("Filled.", { exact: true }).waitFor();
  assert.equal(await form.locator("#email").inputValue(), "fresh.1@icloud.com");
  assert.equal(await form.locator("#password").inputValue(), "");
  assert.equal(await form.evaluate(() => window.inputEvents), 1);
  assert.ok(await page.evaluate(() => document.body.getBoundingClientRect().height <= 600));
  assert.ok(await page.evaluate(() => document.querySelector("footer").getBoundingClientRect().bottom <= 600));
  console.log("PASS: real extension load, permissions, list/search, safe labels, create/copy, fill and input events");

  await form.locator("#email").fill("existing@example.com");
  await page.bringToFront();
  await page.locator("#fill-created").click();
  await page.getByText(/That field already has a value/).waitFor();
  assert.equal(await form.locator("#email").inputValue(), "existing@example.com");
  console.log("PASS: fill preserves existing input values");

  await form.locator("#email").fill("");
  await form.evaluate(() => {
    document.activeElement?.blur();
    const second = document.createElement("input");
    second.type = "email";
    second.id = "second";
    document.body.append(second);
  });
  await page.bringToFront();
  await page.locator("#fill-created").click();
  await page.getByText(/Click the email field you want to fill/).waitFor();
  assert.equal(await form.locator("#email").inputValue(), "");
  await form.evaluate(() => document.querySelector("#second").remove());
  console.log("PASS: ambiguous email fields require explicit selection");

  fixture.mode = "reserve-fails";
  await page.locator("#create").click();
  await page.getByText(/Reservation rejected/).waitFor();
  assert.equal(await page.locator("#created-address").inputValue(), "fresh.1@icloud.com");
  assert.equal(await page.locator("#count").textContent(), "3 active");
  console.log("PASS: reservation failure never exposes an unsaved address");

  fixture.mode = "connected";
  fixture.reserveDelay = 750;
  await page.locator("#create").click();
  await page.waitForFunction(() => document.querySelector("#create").disabled);
  await new Promise(resolve => setTimeout(resolve, 100));
  await page.close();
  page = await popup();
  assert.equal(await page.locator("#created-address").inputValue(), "fresh.3@icloud.com");
  assert.equal(fixture.count, 3);
  console.log("PASS: closing and reopening popup keeps in-progress creation and recovers saved address");

  await mkdir(path.join(root, "test-results"), { recursive: true });
  await page.evaluate(() => { document.querySelector("main").scrollTop = 0; });
  await page.screenshot({ path: path.join(root, "test-results", "popup.png") });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.screenshot({ path: path.join(root, "test-results", "popup-dark.png") });

  fixture.mode = "auth";
  await page.locator("#refresh").click();
  await page.locator("#signin").waitFor({ state: "visible" });
  assert.equal(await page.locator("#workspace").isVisible(), false);
  fixture.mode = "connected";
  await page.locator("#retry").click();
  await page.locator("#workspace").waitFor({ state: "visible" });
  console.log("PASS: expired sign-in hides addresses; retry restores connected state");

  fixture.mode = "offline";
  await page.locator("#refresh").click();
  await page.getByText(/Couldn’t reach iCloud/).waitFor();
  assert.equal(await page.locator("#workspace").isVisible(), false);
  fixture.mode = "connected";
  await page.locator("#retry").click();
  await page.locator("#workspace").waitFor({ state: "visible" });
  console.log("PASS: genuine network failures remain distinct from expired sign-in and can recover");

  await page.close();
  await form.bringToFront();
  const inline = form.locator("#hme-local-assist");
  const inlineCreate = inline.getByRole("button", { name: "＋ Create a hidden email", exact: true });
  const requestsBeforeFocus = fixture.calls.length;
  await form.locator("#email").click();
  await inlineCreate.waitFor();
  await form.waitForFunction(() => !document.querySelector("#hme-local-assist").shadowRoot.querySelector(".create").disabled);
  assert.equal(await inline.locator(".label").textContent(), "Label: 127.0.0.1");
  assert.equal(fixture.count, 3, "Focusing must not create an alias");
  assert.ok(fixture.calls.slice(requestsBeforeFocus).every(call => !/\/(generate|reserve)$/.test(call.url)), "Focus may look up saved addresses but must not mutate them");
  assert.equal(await inline.getByText("quiet.river@icloud.com", { exact: true }).count(), 0, "Unrelated account addresses must never appear on this site");
  const fieldBounds = await form.locator("#email").boundingBox();
  const buttonBounds = await inlineCreate.boundingBox();
  assert.ok(Math.abs(buttonBounds.y - fieldBounds.y) < 150, "Button must appear adjacent to the email field");
  const aboveBounds = await inline.boundingBox();
  assert.equal(await inline.getAttribute("data-placement"), "above");
  assert.ok(aboveBounds.y + aboveBounds.height <= fieldBounds.y - 6, "Leave Chrome's autofill area below the field unobstructed");

  await form.setViewportSize({ width: 800, height: 600 });
  await form.locator("#email").evaluate(element => { element.style.cssText = "position:fixed;top:10px;left:50px"; });
  await form.evaluate(() => window.dispatchEvent(new Event("resize")));
  const sideField = await form.locator("#email").boundingBox();
  const sideBounds = await inline.boundingBox();
  assert.equal(await inline.getAttribute("data-placement"), "right");
  assert.ok(sideBounds.x >= sideField.x + sideField.width + 6, "Place beside a field too close to the top");

  await form.setViewportSize({ width: 390, height: 600 });
  await form.evaluate(() => window.dispatchEvent(new Event("resize")));
  const dockedBounds = await inline.boundingBox();
  assert.equal(await inline.getAttribute("data-placement"), "docked");
  assert.ok(dockedBounds.y > 400 && dockedBounds.y + dockedBounds.height <= 600, "Tight layouts dock away from the native menu");
  await form.locator("#email").evaluate(element => element.removeAttribute("style"));
  await form.evaluate(() => window.dispatchEvent(new Event("resize")));
  console.log("PASS: inline card avoids the native autofill area, with side and narrow-screen fallbacks");
  await form.screenshot({ path: path.join(root, "test-results", "inline-button.png") });
  await inlineCreate.evaluate(button => button.click());
  assert.equal(fixture.count, 3, "Scripted website clicks must not create aliases");
  await inlineCreate.click();
  await form.waitForFunction(() => document.querySelector("#email").value === "fresh.4@icloud.com");
  assert.equal(fixture.count, 4);
  const inlineReservation = fixture.calls.filter(call => call.url.endsWith("/reserve")).at(-1);
  assert.equal(JSON.parse(inlineReservation.body).label, "127.0.0.1");
  assert.equal(await inline.isVisible(), false);
  console.log("PASS: focus shows inline button, URL label is automatic, trusted click creates/saves/fills the exact field");

  const inlineUse = inline.getByRole("button", { name: "Use saved email", exact: true });
  const createAnother = inline.getByRole("button", { name: "Create another", exact: true });
  await form.locator("#email").fill("");
  await form.locator("#email").click();
  await inlineUse.waitFor();
  assert.equal(await inline.getByText("fresh.4@icloud.com", { exact: true }).count(), 0, "Do not expose saved addresses in the page before the user chooses to fill");
  await form.screenshot({ path: path.join(root, "test-results", "inline-reuse.png") });
  await inlineUse.click();
  await form.waitForFunction(() => document.querySelector("#email").value === "fresh.4@icloud.com");
  assert.equal(fixture.count, 4, "Reuse must not generate or reserve another alias");

  await form.reload();
  await form.locator("#email").click();
  await inlineUse.click();
  await form.waitForFunction(() => document.querySelector("#email").value === "fresh.4@icloud.com");
  assert.equal(fixture.count, 4, "Saved-site reuse must survive a page reload");

  fixture.emails.push({ hme: "second.saved@icloud.com", label: "https://127.0.0.1/signup", isActive: true, createTimestamp: 15 });
  await form.locator("#email").fill("");
  await form.locator("#email").click();
  await inlineUse.click();
  await inline.getByRole("button", { name: "Fill second.saved@icloud.com", exact: true }).waitFor();
  assert.equal(await form.locator("#email").inputValue(), "", "Multiple site addresses must let the user choose");
  await inline.getByRole("button", { name: "Fill fresh.4@icloud.com", exact: true }).click();
  assert.equal(await form.locator("#email").inputValue(), "fresh.4@icloud.com");
  assert.equal(fixture.count, 4);
  console.log("PASS: one saved site address fills without creating; reuse survives reload; multiple matches offer a chooser");

  await form.locator("#password").click();
  assert.equal(await inline.isVisible(), false);
  await form.locator("#email").fill("");
  await form.locator("#email").click();
  await inlineUse.waitFor();
  await form.keyboard.press("ArrowDown");
  await form.keyboard.press("Escape");
  assert.equal(await inline.isVisible(), false);
  assert.equal(await form.locator("#email").evaluate(element => element === document.activeElement), true);
  console.log("PASS: no button on password fields; keyboard navigation and dismissal preserve field focus");

  fixture.mode = "auth";
  await form.locator("#email").click();
  await inlineUse.click();
  await inline.getByText(/Sign in to iCloud in this Chrome profile/).waitFor();
  await inline.getByRole("link", { name: "Sign in to iCloud ↗" }).waitFor();
  assert.equal(await form.locator("#email").inputValue(), "");
  fixture.mode = "connected";
  fixture.reserveDelay = 500;
  await createAnother.click();
  await form.locator("#email").fill("typed-during-creation@example.com");
  await inline.getByText("Copy this address to use it.", { exact: true }).waitFor();
  assert.equal(await form.locator("#email").inputValue(), "typed-during-creation@example.com");
  assert.equal(await inline.getByRole("textbox", { name: "Saved hidden email" }).inputValue(), "fresh.5@icloud.com");
  console.log("PASS: explicit Create another is separate from reuse; sign-in errors and mid-request typing are handled");

  // Exercise a real cross-origin iframe and simultaneous requests from two
  // sites so in-flight aliases can never leak between tabs.
  await context.route("https://*.example.test/**", async route => {
    const url = new URL(route.request().url());
    await route.fulfill({ contentType: "text/html", body: url.hostname === "merchant.example.test"
      ? '<iframe title="Signup" src="https://forms.example.test/"></iframe>'
      : '<label>Email <input type="email" id="email"></label>' });
  });
  const merchant = await context.newPage();
  await merchant.goto("https://merchant.example.test/signup?private=omitted");
  const embedded = merchant.frameLocator("iframe");
  await embedded.locator("#email").click();
  const frameCreate = embedded.locator("#hme-local-assist").getByRole("button", { name: "＋ Create a hidden email", exact: true });
  await frameCreate.waitFor();
  await embedded.getByText("Label: merchant.example.test", { exact: true }).waitFor();
  const other = await context.newPage();
  await other.goto("https://other.example.test/signup");
  await other.locator("#email").click();
  const otherCreate = other.locator("#hme-local-assist").getByRole("button", { name: "＋ Create a hidden email", exact: true });
  await otherCreate.waitFor();
  await Promise.all([frameCreate.click(), otherCreate.click()]);
  await merchant.waitForFunction(() => document.querySelector("iframe") !== null);
  await embedded.locator("#email").evaluate(element => new Promise(resolve => {
    if (element.value) resolve(); else element.addEventListener("input", resolve, { once: true });
  }));
  await other.waitForFunction(() => document.querySelector("#email").value.includes("@icloud.com"));
  assert.notEqual(await embedded.locator("#email").inputValue(), await other.locator("#email").inputValue());
  const labels = fixture.calls.filter(call => call.url.endsWith("/reserve")).slice(-2).map(call => JSON.parse(call.body).label).sort();
  assert.deepEqual(labels, ["merchant.example.test", "other.example.test"]);
  console.log("PASS: embedded fields use top-level website label; concurrent tabs receive distinct aliases");

  const stale = await context.newPage();
  await stale.goto("https://stale.example.test/");
  await stale.locator("#email").click();
  const staleCreate = stale.locator("#hme-local-assist").getByRole("button", { name: "＋ Create a hidden email", exact: true });
  await staleCreate.waitFor();
  await stale.waitForFunction(() => !document.querySelector("#hme-local-assist").shadowRoot.querySelector(".create").disabled);
  const beforeStale = fixture.count;
  fixture.emails.push({ hme: "already.saved@icloud.com", label: "stale.example.test", isActive: true, createTimestamp: Date.now() });
  await staleCreate.click();
  await stale.waitForFunction(() => document.querySelector("#email").value === "already.saved@icloud.com");
  assert.equal(fixture.count, beforeStale, "Recheck Apple before creating, even when the focus-time lookup was empty");

  const sameA = await context.newPage();
  const sameB = await context.newPage();
  await Promise.all([sameA.goto("https://same.example.test/one"), sameB.goto("https://same.example.test/two")]);
  await sameA.locator("#email").click();
  await sameB.locator("#email").click();
  const beforeSame = fixture.count;
  await Promise.all([sameA.locator("#hme-local-assist").getByRole("button", { name: "＋ Create a hidden email", exact: true }).click(), sameB.locator("#hme-local-assist").getByRole("button", { name: "＋ Create a hidden email", exact: true }).click()]);
  await Promise.all([sameA.waitForFunction(() => document.querySelector("#email").value.includes("@icloud.com")), sameB.waitForFunction(() => document.querySelector("#email").value.includes("@icloud.com"))]);
  assert.equal(fixture.count, beforeSame + 1);
  assert.equal(await sameA.locator("#email").inputValue(), await sameB.locator("#email").inputValue());
  console.log("PASS: stale lookups and simultaneous requests for the same site never create duplicate aliases");
} finally {
  await context?.close();
  server.close();
  await rm(profile, { recursive: true, force: true });
}
