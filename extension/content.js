(() => {
  if (globalThis.__hmeLocalInstalled) return;
  globalThis.__hmeLocalInstalled = true;

  let target;
  let pending = false;
  let generation = 0;
  let savedCount = -1;
  const host = document.createElement("div");
  host.id = "hme-local-assist";
  host.setAttribute("aria-label", "Hide My Email");
  // Shadow DOM keeps website styles out. No account credentials or address
  // lists are ever sent to this script or inserted into the page.
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `<style>
    :host { all:initial; position:fixed !important; z-index:2147483647 !important; width:264px !important; max-width:calc(100vw - 16px) !important; margin:0 !important; padding:0 !important; border:0 !important; background:transparent !important; overflow:visible !important; color-scheme:light dark; }
    :host([hidden]) { display:none !important; }
    * { box-sizing:border-box; }
    .card { position:relative; padding:12px; border:1px solid #dedbe9; border-radius:11px; background:#fff; color:#25232e; box-shadow:0 5px 24px #24203326; font:12px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
    button { font:inherit; cursor:pointer; }
    .create { display:block; width:calc(100% - 22px); text-align:left; border:0; border-radius:6px; padding:5px 3px; color:#6351d8; background:transparent; font-weight:600; }
    .create:hover { background:#f1effc; }
    .create:disabled { cursor:wait; opacity:.6; }
    .new { display:block; border:0; background:transparent; color:#77717f; padding:5px 3px; margin-top:3px; font-size:11px; }
    .new:hover { color:#6351d8; }
    .choices { display:grid; gap:4px; margin:0 20px 5px 0; }
    .use { border:0; border-radius:5px; padding:6px 3px; text-align:left; background:transparent; color:inherit; overflow-wrap:anywhere; }
    .use:hover { background:#f1effc; }
    .close { position:absolute; top:10px; right:9px; padding:1px 5px; font-size:18px; line-height:1; border:0; background:transparent; color:#888; }
    .label { margin:4px 24px 0 3px; color:#77717f; font-size:11px; overflow-wrap:anywhere; }
    .status { margin:7px 3px 0; font-size:11px; overflow-wrap:anywhere; }
    .status.error { color:#a33c2a; }
    a { color:#6351d8; display:inline-block; margin:7px 3px 0; font-size:11px; }
    input { margin-top:7px; width:100%; padding:6px; border:1px solid #dedbe9; border-radius:5px; color:inherit; background:transparent; font:11px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
    [hidden] { display:none !important; }
    button:focus-visible,a:focus-visible,input:focus-visible { outline:2px solid #8470e9; outline-offset:2px; }
    @media(prefers-color-scheme:dark) { .card { background:#26242d; border-color:#514b61; color:#f1eef8; } .create,a { color:#b6a6ff; } .create:hover { background:#373044; } .label { color:#b6aebf; } .status.error { color:#ffb69e; } }
  </style><section class="card" role="group" aria-label="Hidden email">
    <button class="create" type="button">＋ Create a hidden email</button>
    <button class="close" type="button" aria-label="Dismiss Hide My Email">×</button>
    <div class="choices"></div>
    <button class="new" type="button" hidden>Create another</button>
    <p class="label"></p>
    <p class="status" role="status" aria-live="polite" hidden></p>
    <a href="https://www.icloud.com/" target="_blank" rel="noopener noreferrer" hidden>Sign in to iCloud ↗</a>
    <input aria-label="Saved hidden email" readonly hidden>
  </section>`;
  const createButton = shadow.querySelector(".create");
  const newButton = shadow.querySelector(".new");
  const choices = shadow.querySelector(".choices");
  const closeButton = shadow.querySelector(".close");
  const label = shadow.querySelector(".label");
  const status = shadow.querySelector(".status");
  const signIn = shadow.querySelector("a");
  const savedAddress = shadow.querySelector("input");
  host.hidden = true;

  function isEmailField(element) {
    if (!(element instanceof HTMLInputElement) || element.disabled || element.readOnly ||
        !["text", "email"].includes(element.type) || element.value || !element.getClientRects().length) return false;
    if (element.type === "email" || /(^|\s)email(\s|$)/i.test(element.autocomplete)) return true;
    const hints = `${element.name} ${element.id} ${element.placeholder} ${element.getAttribute("aria-label") || ""} ${Array.from(element.labels || [], item => item.textContent).join(" ")}`;
    return /e[-_ ]?mail/i.test(hints);
  }

  function hide() {
    host.hidden = true;
    if (host.hidePopover && host.matches(":popover-open")) host.hidePopover();
  }

  function position() {
    if (host.hidden || !target) return;
    const rect = target.getBoundingClientRect();
    if (!target.isConnected || !rect.width || !rect.height || rect.bottom < 0 || rect.top > innerHeight) { hide(); return; }
    const width = Math.min(264, innerWidth - 16);
    const height = host.getBoundingClientRect().height || 78;
    const gap = 8;
    let left = Math.max(8, Math.min(rect.left, innerWidth - width - 8));
    let top;
    // Chrome's native autofill menu is outside the page's stacking order:
    // no z-index or HTML popover can cover it. Leave its usual space below
    // the field clear, using the side when there isn't room above.
    if (rect.top - height - gap >= 8 && innerHeight - rect.bottom >= 200) {
      top = rect.top - height - gap;
      host.dataset.placement = "above";
    } else if (rect.right + gap + width <= innerWidth - 8) {
      left = rect.right + gap;
      top = Math.max(8, Math.min(rect.top, innerHeight - height - 8));
      host.dataset.placement = "right";
    } else if (rect.left - gap - width >= 8) {
      left = rect.left - gap - width;
      top = Math.max(8, Math.min(rect.top, innerHeight - height - 8));
      host.dataset.placement = "left";
    } else if (rect.top - height - gap >= 8) {
      // Near the bottom Chrome may put its menu above instead. Our smaller
      // card can often fit below in the remaining space.
      const belowFits = rect.bottom + gap + height <= innerHeight - 8;
      top = belowFits ? rect.bottom + gap : rect.top - height - gap;
      host.dataset.placement = belowFits ? "below" : "above";
    } else {
      // A field at the very top of a narrow screen has no adjacent space.
      // Dock away from it rather than hiding under the native dropdown.
      top = Math.max(8, innerHeight - height - 8);
      host.dataset.placement = "docked";
    }
    host.style.setProperty("left", `${left}px`, "important");
    host.style.setProperty("top", `${top}px`, "important");
  }

  async function send(type) {
    const response = await chrome.runtime.sendMessage({ type });
    if (!response?.ok) {
      const error = new Error(response?.error || "Open the extension and check your iCloud connection.");
      error.code = response?.code;
      throw error;
    }
    return response.data;
  }

  async function show(element) {
    if (pending || !isEmailField(element)) return;
    target = element;
    const version = ++generation;
    status.hidden = true;
    signIn.hidden = true;
    savedAddress.hidden = true;
    savedCount = -1;
    choices.replaceChildren();
    newButton.hidden = true;
    createButton.hidden = false;
    createButton.disabled = true;
    createButton.textContent = "Checking…";
    label.textContent = `Label: ${location.hostname.replace(/^www\./, "")}`;
    if (!host.isConnected) document.documentElement.append(host);
    host.hidden = false;
    // Top-layer rendering keeps the button visible over dialogs where supported.
    if (host.showPopover) {
      host.setAttribute("popover", "manual");
      if (!host.matches(":popover-open")) host.showPopover();
    }
    position();
    try {
      const context = await send("INLINE_CONTEXT");
      if (version !== generation) return;
      label.textContent = `Label: ${context.label}`;
      savedCount = context.count;
      createButton.textContent = savedCount ? "Use saved email" : "＋ Create a hidden email";
      newButton.hidden = !savedCount;
      createButton.disabled = false;
      position();
    } catch (error) {
      if (version !== generation) return;
      status.textContent = error.message.includes("Extension context invalidated") ? "Refresh this page to reconnect." : error.message;
      status.className = "status error";
      status.hidden = false;
      signIn.hidden = error.code !== "AUTH_REQUIRED";
      createButton.textContent = "Try again";
      createButton.disabled = false;
      position();
    }
  }

  function fillOrKeep(field, address) {
    if (isEmailField(field)) {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      setter.call(field, address);
      field.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
      field.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
      field.focus();
      hide();
    } else {
      createButton.hidden = true;
      newButton.hidden = true;
      choices.replaceChildren();
      status.textContent = "Copy this address to use it.";
      status.className = "status";
      status.hidden = false;
      savedAddress.value = address;
      savedAddress.hidden = false;
      position();
    }
  }

  async function useOrCreate(field, forceNew = false) {
    pending = true;
    choices.replaceChildren();
    createButton.hidden = false;
    createButton.disabled = true;
    newButton.disabled = true;
    createButton.textContent = "Working…";
    status.hidden = true;
    signIn.hidden = true;
    try {
      const result = await send(forceNew ? "INLINE_CREATE_NEW" : "INLINE_USE_OR_CREATE");
      if (result.choices) {
        createButton.hidden = true;
        newButton.hidden = false;
        for (const email of result.choices) {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "use";
          button.textContent = email.hme;
          button.setAttribute("aria-label", `Fill ${email.hme}`);
          button.addEventListener("pointerdown", event => event.preventDefault());
          button.addEventListener("click", event => {
            if (event.isTrusted && !pending) fillOrKeep(field, email.hme);
          });
          choices.append(button);
        }
        position();
      } else fillOrKeep(field, result.hme);
    } catch (error) {
      status.textContent = error.message;
      status.className = "status error";
      status.hidden = false;
      signIn.hidden = error.code !== "AUTH_REQUIRED";
      position();
    } finally {
      pending = false;
      createButton.disabled = false;
      newButton.disabled = false;
      createButton.textContent = savedCount ? "Use saved email" : "＋ Create a hidden email";
    }
  }

  // Only a trusted user click may reveal or fill an existing address or create
  // a new one. A focus-time check returns a count, never the saved addresses.
  for (const button of [createButton, newButton]) button.addEventListener("pointerdown", event => event.preventDefault());
  createButton.addEventListener("click", event => {
    if (!event.isTrusted || pending || !isEmailField(target)) return;
    if (savedCount < 0) { show(target); return; }
    useOrCreate(target);
  });
  newButton.addEventListener("click", event => {
    if (event.isTrusted && !pending && isEmailField(target)) useOrCreate(target, true);
  });
  savedAddress.addEventListener("click", () => savedAddress.select());
  closeButton.addEventListener("click", () => hide());
  document.addEventListener("focusin", event => {
    const path = event.composedPath();
    if (path.includes(host)) return;
    const field = path.find(item => item instanceof HTMLInputElement);
    if (isEmailField(field)) show(field);
    else if (!pending) hide();
  }, true);
  document.addEventListener("pointerdown", event => {
    const path = event.composedPath();
    if (path.includes(host)) return;
    if (isEmailField(path[0])) { if (!pending) show(path[0]); }
    else if (!pending) hide();
  }, true);
  document.addEventListener("input", event => {
    if (!pending && event.composedPath().includes(target) && target.value) hide();
  }, true);
  document.addEventListener("keydown", event => {
    if (host.hidden) return;
    if (event.key === "Escape") { target?.focus(); hide(); }
    else if (event.key === "ArrowDown" && event.composedPath().includes(target) && !pending) {
      event.preventDefault(); (createButton.hidden ? choices.querySelector("button") || newButton : createButton).focus();
    }
  }, true);
  window.addEventListener("scroll", position, true);
  window.addEventListener("resize", position);
})();
