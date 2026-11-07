export class ICloudError extends Error {
  constructor(message, code = "API_ERROR") {
    super(message);
    this.name = "ICloudError";
    this.code = code;
  }
}

export function validEmail(value) {
  return typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function serviceURL(value) {
  let url;
  try { url = new URL(value); } catch { throw new ICloudError("iCloud returned an invalid service address."); }
  if (url.protocol !== "https:" || !/(^|\.)icloud\.com$/.test(url.hostname) ||
      url.username || url.password || url.port || url.search || url.hash) {
    throw new ICloudError("iCloud returned an unexpected service address.");
  }
  return url.href.replace(/\/$/, "");
}

export class ICloudClient {
  constructor(fetcher = globalThis.fetch) {
    // Native browser fetch needs its Window/WorkerGlobalScope receiver. Calling
    // an unbound fetch as this.fetcher() throws before any request is sent.
    this.fetcher = fetcher.bind(globalThis);
    this.base = null;
  }

  async request(url, method = "GET", data) {
    let response;
    try {
      response = await this.fetcher(url, {
        method,
        credentials: "include",
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(12000),
        ...(data === undefined ? {} : { body: JSON.stringify(data) }),
      });
    } catch {
      throw new ICloudError("Couldn’t reach iCloud. Check your connection and try again.", "NETWORK_ERROR");
    }
    if ([401, 403, 421, 450].includes(response.status)) {
      throw new ICloudError("Sign in to iCloud in this Chrome profile, then try again.", "AUTH_REQUIRED");
    }
    if (!response.ok) {
      throw new ICloudError(response.status === 429
        ? "iCloud is receiving too many requests. Try again in a moment."
        : `iCloud couldn’t complete the request (${response.status}).`);
    }
    let result;
    try { result = await response.json(); } catch {
      throw new ICloudError("iCloud returned an unreadable response. Try signing in again.");
    }
    if (!result || typeof result !== "object") throw new ICloudError("iCloud returned an empty response.");
    if (result.success === false) {
      const message = result.error?.errorMessage;
      throw new ICloudError(typeof message === "string" ? message : "iCloud couldn’t complete the request.");
    }
    return result;
  }

  async connect() {
    const data = await this.request("https://setup.icloud.com/setup/ws/1/validate", "POST");
    const url = data.webservices?.premiummailsettings?.url;
    if (!url) throw new ICloudError("Hide My Email isn’t available. Check your iCloud+ subscription and iCloud sign-in.", "UNAVAILABLE");
    this.base = serviceURL(url);
  }

  async list() {
    const data = await this.request(`${this.base}/v2/hme/list`);
    if (!Array.isArray(data.result?.hmeEmails)) throw new ICloudError("iCloud returned an unexpected address list.");
    return {
      emails: data.result.hmeEmails.filter(item => item?.isActive === true && validEmail(item.hme))
        .sort((a, b) => (Number(b.createTimestamp) || 0) - (Number(a.createTimestamp) || 0)),
      forwardTo: typeof data.result.selectedForwardTo === "string" ? data.result.selectedForwardTo : "",
    };
  }

  async create(label) {
    const generated = await this.request(`${this.base}/v1/hme/generate`, "POST");
    const hme = generated.result?.hme;
    if (!validEmail(hme)) throw new ICloudError("iCloud didn’t return a valid new address.");
    try {
      const saved = await this.request(`${this.base}/v1/hme/reserve`, "POST", {
        hme, label, note: "Created with Hide My Email · Local",
      });
      if (saved.success !== true || saved.result?.hme?.hme !== hme) {
        throw new ICloudError("iCloud didn’t confirm the saved address.");
      }
      return saved.result.hme;
    } catch (error) {
      // A response can be lost after Apple has saved the address. Never generate
      // another alias automatically; first look for the exact one we reserved.
      try {
        const { emails } = await this.list();
        const recovered = emails.find(item => item.hme === hme);
        if (recovered) return recovered;
      } catch { /* Keep the original failure, including sign-in errors. */ }
      throw new ICloudError(`${error.message} Check your address list before creating another.`, error.code);
    }
  }
}
