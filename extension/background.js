import { ICloudClient, ICloudError } from "./api.js";
import { isInlineSender, labelForSender, addressesForSite } from "./messaging.js";

let rulesReady;
const creating = new Map();
const using = new Map();
let lookup;
let lookupExpires = 0;

async function siteCount(label) {
  if (!lookup || Date.now() >= lookupExpires) {
    const operation = (async () => {
      const api = await client();
      return (await api.list()).emails;
    })();
    lookup = operation;
    lookupExpires = Date.now() + 15000;
    operation.catch(() => { if (lookup === operation) { lookup = null; lookupExpires = 0; } });
  }
  return addressesForSite(await lookup, label).length;
}

async function remember(email) {
  lookup = null;
  lookupExpires = 0;
  await chrome.storage.session.set({ lastCreated: email.hme });
  return email;
}

async function prepareRules() {
  // Restrict header changes to requests from THIS extension, never normal tabs
  // or another extension. The extension ID varies when loaded unpacked.
  rulesReady ??= chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [1],
    addRules: [{
      id: 1, priority: 1,
      action: {
        type: "modifyHeaders",
        requestHeaders: [
          { header: "Origin", operation: "set", value: "https://www.icloud.com" },
          { header: "Referer", operation: "set", value: "https://www.icloud.com/" },
        ],
      },
      condition: {
        requestDomains: ["icloud.com"],
        initiatorDomains: [chrome.runtime.id],
        resourceTypes: ["xmlhttprequest"],
      },
    }],
  }).catch(error => { rulesReady = undefined; throw error; });
  await rulesReady;
}

async function client() {
  await prepareRules();
  const api = new ICloudClient();
  await api.connect();
  return api;
}

async function load() {
  // Reopening the popup during creation waits for that same operation.
  await Promise.allSettled([...creating.values(), ...using.values()]);
  const api = await client();
  const data = await api.list();
  const { lastCreated } = await chrome.storage.session.get("lastCreated");
  return { ...data, lastCreated: data.emails.find(item => item.hme === lastCreated) ?? null };
}

function create(label, source = "popup") {
  if (creating.has(source)) return creating.get(source);
  if (typeof label !== "string" || !label.trim() || label.length > 256) {
    throw new ICloudError("Add a label of up to 256 characters.");
  }
  const operation = (async () => {
    const api = await client();
    const email = await api.create(label.trim());
    return remember(email);
  })().finally(() => { creating.delete(source); });
  creating.set(source, operation);
  return operation;
}

function useOrCreate(label) {
  // Recheck with Apple when clicked, even if the focus-time lookup was empty.
  // Share one operation per hostname so two tabs cannot create duplicates.
  if (using.has(label)) return using.get(label);
  const operation = (async () => {
    const api = await client();
    const matches = addressesForSite((await api.list()).emails, label);
    if (matches.length > 1) return { choices: matches.map(email => ({ hme: email.hme })) };
    if (matches.length === 1) return { hme: matches[0].hme };
    return { hme: (await remember(await api.create(label))).hme };
  })().finally(() => { using.delete(label); });
  using.set(label, operation);
  return operation;
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return false;
  const popup = sender.url === chrome.runtime.getURL("popup.html");
  const inline = isInlineSender(sender);
  if (!popup && !inline) return false;
  (async () => {
    try {
      if (popup && message?.type === "LOAD") respond({ ok: true, data: await load() });
      else if (popup && message?.type === "CREATE") respond({ ok: true, data: await create(message.label) });
      else if (inline && message?.type === "INLINE_CONTEXT") {
        const label = labelForSender(sender);
        respond({ ok: true, data: { label, count: await siteCount(label) } });
      }
      else if (inline && ["INLINE_USE_OR_CREATE", "INLINE_CREATE"].includes(message?.type)) {
        respond({ ok: true, data: await useOrCreate(labelForSender(sender)) });
      }
      else if (inline && message?.type === "INLINE_CREATE_NEW") {
        const email = await create(labelForSender(sender), `inline:${sender.tab.id}:${sender.frameId ?? 0}`);
        respond({ ok: true, data: { hme: email.hme } });
      }
      else respond({ ok: false, error: "Unknown action." });
    } catch (error) {
      respond({ ok: false, error: error.message || "Something went wrong.", code: error.code || "ERROR" });
    }
  })();
  return true;
});
