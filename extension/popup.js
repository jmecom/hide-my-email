import { fillEmail } from "./fill.js";

const $ = id => document.getElementById(id);
let emails = [];
let currentAddress;
let tabId;
let connected = false;
let busy = false;

function notice(message, error = false) {
  $("notice").textContent = message;
  $("notice").dataset.error = String(error);
  $("notice").hidden = !message;
}

function setBusy(value) {
  busy = value;
  $("create").disabled = value || !connected;
  $("label").disabled = value;
  $("refresh").disabled = value;
  $("retry").disabled = value;
  $("create").textContent = value ? "Working…" : "＋ Create & copy";
}

async function request(message) {
  const result = await chrome.runtime.sendMessage(message);
  if (!result?.ok) {
    const error = new Error(result?.error || "Couldn’t connect to the extension. Reload it and try again.");
    error.code = result?.code;
    throw error;
  }
  return result.data;
}

function showCreated(email) {
  currentAddress = email?.hme;
  $("created").hidden = !currentAddress;
  $("created-address").value = currentAddress || "";
}

async function copy(address, created = false) {
  try {
    await navigator.clipboard.writeText(address);
    notice(created ? "Created and copied." : "Copied.");
  } catch {
    showCreated({ hme: address });
    $("created-address").focus();
    $("created-address").select();
    notice("Address saved. Press ⌘C (or Ctrl+C) to copy the selected address.");
  }
}

async function fill(address) {
  try {
    if (!Number.isInteger(tabId)) throw new Error("Open a web page with an email field first.");
    const results = await chrome.scripting.executeScript({ target: { tabId }, func: fillEmail, args: [address] });
    const result = results[0]?.result;
    if (!result?.ok) throw new Error(result?.reason || "Couldn’t find an email field on this page.");
    notice("Filled.");
  } catch (error) {
    notice(error.message.includes("Cannot access") || error.message.includes("extensions gallery")
      ? "Chrome doesn’t allow filling this page. Use Copy, then paste instead."
      : error.message, true);
  }
}

function render() {
  const query = $("search").value.trim().toLowerCase();
  const matching = emails.filter(email => `${email.label || ""} ${email.hme}`.toLowerCase().includes(query));
  $("count").textContent = `${emails.length} active`;
  $("addresses").replaceChildren();
  for (const email of matching) {
    const row = document.createElement("li");
    const info = document.createElement("div");
    info.className = "address-info";
    const label = document.createElement("span");
    label.className = "address-label";
    label.textContent = email.label || "Untitled address";
    const address = document.createElement("span");
    address.className = "address-email";
    address.textContent = email.hme;
    info.append(label, address);
    row.append(info);
    for (const [title, action] of [["Copy", copy], ["Fill", fill]]) {
      const button = document.createElement("button");
      button.className = "row-action";
      button.textContent = title;
      button.setAttribute("aria-label", `${title} ${email.hme}`);
      button.addEventListener("click", () => action(email.hme));
      row.append(button);
    }
    $("addresses").append(row);
  }
  $("empty").hidden = matching.length > 0;
  $("empty").textContent = query ? "No matches." : "No addresses.";
}

async function load() {
  if (busy) return;
  setBusy(true);
  notice("");
  try {
    const data = await request({ type: "LOAD" });
    emails = data.emails;
    connected = true;
    $("workspace").hidden = false;
    $("signin").hidden = true;
    $("forward").textContent = data.forwardTo ? `Forwards to ${data.forwardTo}` : "";
    $("forward").hidden = !data.forwardTo;
    showCreated(data.lastCreated);
    render();
  } catch (error) {
    connected = false;
    emails = [];
    showCreated(null);
    $("workspace").hidden = true;
    $("signin").hidden = false;
    notice(error.message, true);
  } finally { setBusy(false); }
}

$("create-form").addEventListener("submit", async event => {
  event.preventDefault();
  if (busy || !connected) return;
  setBusy(true);
  notice("");
  try {
    const email = await request({ type: "CREATE", label: $("label").value });
    emails = [email, ...emails.filter(item => item.hme !== email.hme)];
    showCreated(email);
    render();
    await copy(email.hme, true);
  } catch (error) {
    if (error.code === "AUTH_REQUIRED") {
      connected = false;
      emails = [];
      showCreated(null);
      $("workspace").hidden = true;
      $("signin").hidden = false;
    }
    notice(error.message, true);
  } finally { setBusy(false); }
});

$("search").addEventListener("input", render);
$("refresh").addEventListener("click", load);
$("retry").addEventListener("click", load);
$("copy-created").addEventListener("click", () => copy(currentAddress));
$("fill-created").addEventListener("click", () => fill(currentAddress));

try {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = tab?.id;
  const url = new URL(tab?.url || "about:blank");
  $("label").value = /^https?:$/.test(url.protocol) ? url.hostname.replace(/^www\./, "") : "";
} catch { /* Manual label and copy still work on Chrome's restricted pages. */ }
await load();
