# jm's Hide My Email for Chrome

A small Chrome extension for iCloud Hide My Email. Focus an email field and
click **Use saved email** to reuse a site’s address, or create one for a new site.
No build step, framework, account system, or runtime dependencies.

## Install in Chrome

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked**, then select `~/development/hide-my-email/extension`.
3. Pin **jm's Hide My Email for Chrome** from Chrome’s extensions menu.
4. Sign in at https://www.icloud.com/ in the **same Chrome profile**. Complete any
   verification or terms prompts. If Apple asks, trust this browser.
5. Click the extension, then **I’m signed in — try again** if needed.

You need iCloud+ with Hide My Email available on your Apple Account. This version
supports `icloud.com`; mainland China accounts using `icloud.com.cn` are outside
its current scope. Incognito is disabled by default; use your normal profile.

If updating an existing installation, open `chrome://extensions`, find
**jm's Hide My Email for Chrome**, and click its reload button. Version **0.2.0** adds
the email-field button and requests access to ordinary HTTP/HTTPS web pages
so it can appear automatically. Approve the new site access if Chrome asks,
then refresh any already-open page once. The browser request binding fix from
0.1.1 is included.

## Use

- Click an empty email field on a website. If an active address is labelled for
  that hostname, **Use saved email** fills it. Multiple matches offer a chooser.
  Matching ignores `www.`, letter case, and URL paths. Unrelated domains and
  custom labels without a hostname are not guessed.
- For a new site, **Create a hidden email** creates, saves, and fills an address
  labelled with its hostname. When an address exists, **Create another** remains
  a separate action. The default action rechecks Apple before creating so a
  stale lookup or two tabs on the same site won’t create duplicate aliases.
- The button leaves room for Chrome’s native autofill menu. If there is no room
  above the field it uses the side, or the bottom edge on narrow screens.
- The button also works in supported embedded frames and dynamically added
  forms. Embedded forms use the main website’s hostname as their label.
- Press **Down Arrow** from the field to focus the button, or **Escape** to
  dismiss it. Password fields and fields with existing values are left alone.
- Open the extension on a website. The label defaults to that site’s hostname.
- Click **Create & copy**. The extension generates **and saves** the address with
  Apple before copying it. Paste it wherever you need it.
- **Fill on page** fills the focused text/email field, or the single email field
  on the page. It dispatches input/change events for common web frameworks. It
  won’t replace a field that already contains a different value.
- Search active addresses by label or email. Each has **Copy** and **Fill**.
- **Manage in iCloud** opens Apple’s settings for deactivation or other changes.
- Address creation continues if the popup closes. Reopen it to recover the last
  saved address during the current browser session.

Addresses are created only when you click the inline create button or the
toolbar’s **Create & copy**. Focusing a field looks up existing addresses but
never creates one. Read-only lookups are shared for up to 15 seconds; selecting
the default action always checks the current account again.
Closed shadow roots, special sandboxed frames, Chrome internal pages, and the
Chrome Web Store may require copying and pasting. Toolbar **Fill** operates in
the main frame; the inline button works inside ordinary permitted frames.
The extension never submits a form. A label is required when there is no website
hostname to use. Clipboard failure leaves the saved address selected for manual
copying. If a reservation fails, refresh the list before creating another address:
a network error can occur after Apple has saved it. There are no automatic
mutation retries.

## Privacy and permissions

All service requests go directly from Chrome to Apple. No analytics, remote code,
third-party server, or external assets. Authentication uses your existing browser
session (`credentials: include`); the extension never asks for your password,
reads cookie values, or stores authentication tokens.

| Permission | Purpose |
| --- | --- |
| HTTP/HTTPS website access | Detect focused email fields, display the inline button, read the hostname, and fill the chosen field. Also covers the iCloud service requests. |
| `declarativeNetRequestWithHostAccess` | Set iCloud Origin/Referer headers **only for this extension’s own requests**. |
| `activeTab`, `scripting` | Suggest the current hostname and fill the current page when you ask. |
| `clipboardWrite` | Copy an address. |
| `storage` | Remember the last created email in memory for this browser session. |

An isolated content script runs on ordinary HTTP/HTTPS pages and frames to
watch focus events. This requires Chrome’s broad website-access permission;
you can limit access through the extension’s Chrome settings if desired.
It does not read passwords or submit forms. Focusing an email field validates
your iCloud session and reads addresses to check for an existing site match.
Only the hostname, not the page path,
query, or form contents, is used as the label sent to Apple.
Content scripts receive only a match count on focus. After a trusted user click
they receive the matching site address or choices, never the whole account list
or forwarding address. Concurrent requests for different sites are separate;
default requests for the same site share one operation.
Account address lists stay in popup or service-worker memory; only the last created email string goes into
`chrome.storage.session`, which clears with the browser session. On each refresh,
that string is shown only if present in the currently signed-in account’s list.
Signing out of iCloud revokes future service access; an already-open popup may
show its loaded list until refreshed.

## Development and verification

Use Node.js 20+ (Node 22+ recommended). The extension itself needs no installation.

```sh
npm ci
npm run check
npm test
npx playwright install chromium
npm run test:browser
```

Browser tests load the actual unpacked extension into an isolated Chromium
profile. They use Chrome’s real worker `fetch`; Apple responses are intercepted
at the network layer instead of replacing that function. No personal account
is used, and no real aliases are created. Tests run a disposable copy of the
shipping extension with its unchanged manifest and website permissions.
Tests cover creation/reservation, copy/fill, search, safe rendering, sign-in
expiry, errors, popup closure during creation, focus-triggered inline controls,
hostname labels, cross-origin frames, separate concurrent tab requests,
keyboard dismissal, site-address reuse, multiple-match selection, duplicate
prevention, and preserving values typed during creation.
Screenshots are written to `test-results/`. Real iCloud account behavior requires
a signed-in manual check after installation.

Apple’s Hide My Email web endpoints are **unofficial** and can change. This is a
personal-use integration, unaffiliated with Apple. If sign-in keeps failing,
visit iCloud directly, complete pending prompts, and refresh the extension.

## Reference

Independently written minimal implementation, informed by the protocol in
[dedoussis/icloud-hide-my-email-browser-extension](https://github.com/dedoussis/icloud-hide-my-email-browser-extension).
This does not install or depend on that extension. See `THIRD_PARTY_NOTICES.md`
for its MIT notice.
