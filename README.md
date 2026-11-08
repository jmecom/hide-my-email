# jm's Hide My Email for Chrome

A small Chrome extension for iCloud Hide My Email. Focus an email field and
click **Use saved email** to reuse a site’s address, or create one for a new site.

## Install in Chrome

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked**, then select `~/development/hide-my-email/extension`.
3. Pin **jm's Hide My Email for Chrome** from Chrome’s extensions menu.
4. Sign in at https://www.icloud.com/ in the **same Chrome profile**. Complete any
   verification or terms prompts. If Apple asks, trust this browser.
5. Click the extension, then **I’m signed in — try again** if needed.

You need iCloud+ with Hide My Email available on your Apple Account.

## Privacy and permissions

All service requests go directly from Chrome to Apple. Authentication uses your existing browser
session (`credentials: include`); the extension never asks for your password,
reads cookie values, or stores authentication tokens.

| Permission | Purpose |
| --- | --- |
| HTTP/HTTPS website access | Detect focused email fields, display the inline button, read the hostname, and fill the chosen field. Also covers the iCloud service requests. |
| `declarativeNetRequestWithHostAccess` | Set iCloud Origin/Referer headers **only for this extension’s own requests**. |
| `activeTab`, `scripting` | Suggest the current hostname and fill the current page when you ask. |
| `clipboardWrite` | Copy an address. |
| `storage` | Remember the last created email in memory for this browser session. |

## Development and verification

Use Node.js 20+ (Node 22+ recommended). The extension itself needs no installation.

```sh
npm ci
npm run check
npm test
npx playwright install chromium
npm run test:browser
```

Apple’s Hide My Email web endpoints are **unofficial** and can change. This is a
personal-use integration, unaffiliated with Apple. If sign-in keeps failing,
visit iCloud directly, complete pending prompts, and refresh the extension.

## Reference

Independently written minimal implementation, informed by the protocol in
[dedoussis/icloud-hide-my-email-browser-extension](https://github.com/dedoussis/icloud-hide-my-email-browser-extension).
This does not install or depend on that extension. See `THIRD_PARTY_NOTICES.md`
for its MIT notice.
