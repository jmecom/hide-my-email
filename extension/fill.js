// This function is serialized by chrome.scripting; keep it self-contained.
export function fillEmail(address) {
  function deepActive(root) {
    let element = root.activeElement;
    while (element?.shadowRoot?.activeElement) element = element.shadowRoot.activeElement;
    return element;
  }
  const active = deepActive(document);
  const editable = element => element instanceof HTMLInputElement &&
    !element.disabled && !element.readOnly && !["hidden", "password", "file", "checkbox", "radio", "submit", "button", "number"].includes(element.type) &&
    element.getClientRects().length > 0;
  const emailField = element => editable(element) && (element.type === "email" ||
    /(^|\s)(email|username)(\s|$)/i.test(element.autocomplete) ||
    /e[-_ ]?mail/i.test(`${element.name} ${element.id} ${element.placeholder} ${element.getAttribute("aria-label") || ""}`));
  // Explicitly focused text fields are allowed, but never password fields.
  let target = editable(active) && ["text", "email", "search", "url", "tel"].includes(active.type) ? active : null;
  if (!target) {
    const candidates = [];
    function scan(root) {
      for (const element of root.querySelectorAll("input")) if (emailField(element)) candidates.push(element);
      for (const element of root.querySelectorAll("*")) if (element.shadowRoot) scan(element.shadowRoot);
    }
    scan(document);
    if (candidates.length > 1) return { ok: false, reason: "Click the email field you want to fill, then reopen the extension." };
    target = candidates[0];
  }
  if (!target) return { ok: false, reason: "Click an email field first. Fields inside embedded frames may need paste instead." };
  if (target.value && target.value !== address) return { ok: false, reason: "That field already has a value. Clear it first, or paste the copied address." };
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  setter.call(target, address);
  target.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  target.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
  target.focus();
  return { ok: true };
}
