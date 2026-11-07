export function isInlineSender(sender) {
  if (!Number.isInteger(sender.tab?.id)) return false;
  try { return /^https?:$/.test(new URL(sender.url).protocol); } catch { return false; }
}

export function labelForSender(sender) {
  // Use Chrome's sender metadata, never a hostname supplied in the message.
  // Embedded signup frames should be labelled with the top-level website.
  for (const value of [sender.tab?.url, sender.url]) {
    try {
      const url = new URL(value);
      if (/^https?:$/.test(url.protocol)) return url.hostname.replace(/^www\./, "");
    } catch { /* Fall back to the actual frame URL if tab metadata is absent. */ }
  }
  return "";
}

function siteHostname(value) {
  if (typeof value !== "string" || !value.trim()) return "";
  try {
    const raw = value.trim();
    const url = new URL(raw.includes("://") ? raw : `https://${raw}`);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) return "";
    return url.hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
  } catch { return ""; }
}

export function addressesForSite(emails, label) {
  const hostname = siteHostname(label);
  if (!hostname) return [];
  const seen = new Set();
  return emails.filter(email => {
    if (email?.isActive !== true || typeof email.hme !== "string" || seen.has(email.hme) || siteHostname(email.label) !== hostname) return false;
    seen.add(email.hme);
    return true;
  });
}
