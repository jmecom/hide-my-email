import test from "node:test";
import assert from "node:assert/strict";
import { isInlineSender, labelForSender, addressesForSite } from "../extension/messaging.js";

test("allows inline requests only from ordinary web frames with a tab", () => {
  assert.equal(isInlineSender({ tab: { id: 1 }, url: "https://example.com/signup" }), true);
  for (const sender of [{}, { tab: { id: 1 }, url: "chrome://settings" }, { url: "https://example.com" }, { tab: { id: 1 }, url: "file:///tmp/form.html" }]) {
    assert.equal(isInlineSender(sender), false);
  }
});

test("finds active site addresses with hostname, www, case, and URL labels", () => {
  const emails = [
    { hme: "one@icloud.com", label: "HTTPBIN.ORG", isActive: true },
    { hme: "two@icloud.com", label: "https://www.httpbin.org/forms/post", isActive: true },
    { hme: "old@icloud.com", label: "httpbin.org", isActive: false },
    { hme: "other@icloud.com", label: "other.org", isActive: true },
  ];
  assert.deepEqual(addressesForSite(emails, "httpbin.org").map(item => item.hme), ["one@icloud.com", "two@icloud.com"]);
});

test("does not match unrelated domains, lookalikes, or human-readable labels", () => {
  const emails = ["evilhttpbin.org", "httpbin.org.evil.test", "not-httpbin.org", "forms.httpbin.org", "My shopping account", "https://user@httpbin.org"].map((label, i) => ({ label, hme: `${i}@icloud.com`, isActive: true }));
  assert.deepEqual(addressesForSite(emails, "httpbin.org"), []);
  assert.deepEqual(addressesForSite(emails, ""), []);
});

test("deduplicates matching addresses", () => {
  const email = { hme: "one@icloud.com", label: "httpbin.org", isActive: true };
  assert.deepEqual(addressesForSite([email, email], "www.httpbin.org"), [email]);
});

test("derives label from the top-level URL, excluding path and query", () => {
  assert.equal(labelForSender({ tab: { url: "https://www.example.com/signup?private=secret" }, url: "https://form-provider.test/embedded" }), "example.com");
  assert.equal(labelForSender({ url: "https://shop.example.com/login" }), "shop.example.com");
  assert.equal(labelForSender({ tab: { url: "about:blank" }, url: "https://example.org/" }), "example.org");
  assert.equal(labelForSender({ url: "not a url" }), "");
});
