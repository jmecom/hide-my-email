import test from "node:test";
import assert from "node:assert/strict";
import { ICloudClient, serviceURL } from "../extension/api.js";

const email = { hme: "quiet.river@icloud.com", label: "example.com", isActive: true, createTimestamp: 100 };
const reply = (data, status = 200) => new Response(JSON.stringify(data), { status });
function mock(responses) {
  const calls = [];
  const client = new ICloudClient(async (url, options) => {
    calls.push({ url, ...options });
    const next = responses.shift();
    if (next instanceof Error) throw next;
    assert.ok(next, `Unexpected request: ${url}`);
    return next;
  });
  client.base = "https://p01-maildomainws.icloud.com";
  return { client, calls };
}

test("discovers iCloud service with browser credentials and no redirects", async () => {
  const { client, calls } = mock([reply({ webservices: { premiummailsettings: { url: "https://p01-maildomainws.icloud.com/" } } })]);
  await client.connect();
  assert.equal(client.base, "https://p01-maildomainws.icloud.com");
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].credentials, "include");
  assert.equal(calls[0].redirect, "error");
  assert.ok(calls[0].signal instanceof AbortSignal);
});

test("calls the request function with its browser global receiver", async () => {
  let invoked = false;
  const client = new ICloudClient(async function () {
    assert.equal(this, globalThis, "Native browser fetch requires the Window or WorkerGlobalScope receiver");
    invoked = true;
    return reply({ webservices: { premiummailsettings: { url: "https://p01-maildomainws.icloud.com" } } });
  });
  await client.connect();
  assert.equal(invoked, true);
});

test("rejects service addresses outside Apple or containing credentials", () => {
  for (const value of ["http://api.icloud.com", "https://icloud.com.evil.test", "https://evilicloud.com", "https://icloud.com@evil.test", "https://user:pass@api.icloud.com", "https://api.icloud.com:8443", "not a URL"]) {
    assert.throws(() => serviceURL(value));
  }
});

test("shows only active valid addresses, newest first", async () => {
  const { client } = mock([reply({ success: true, result: { hmeEmails: [email, { ...email, hme: "new@icloud.com", createTimestamp: 200 }, { ...email, isActive: false }, { ...email, hme: "bad" }], selectedForwardTo: "me@example.com" } })]);
  const data = await client.list();
  assert.deepEqual(data.emails.map(item => item.hme), ["new@icloud.com", email.hme]);
  assert.equal(data.forwardTo, "me@example.com");
});

test("requires sign-in on expired or unauthorized sessions", async () => {
  for (const status of [401, 403, 421, 450]) {
    const { client } = mock([reply({}, status)]);
    await assert.rejects(client.connect(), { code: "AUTH_REQUIRED" });
  }
});

test("does not treat an unavailable service as an empty address list", async () => {
  const { client } = mock([reply({ webservices: {} })]);
  await assert.rejects(client.connect(), { code: "UNAVAILABLE" });
});

test("generates then reserves, returning only the saved address", async () => {
  const { client, calls } = mock([reply({ success: true, result: { hme: email.hme } }), reply({ success: true, result: { hme: email } })]);
  assert.deepEqual(await client.create("example.com"), email);
  assert.deepEqual(calls.map(call => new URL(call.url).pathname), ["/v1/hme/generate", "/v1/hme/reserve"]);
  assert.equal(JSON.parse(calls[1].body).label, "example.com");
  assert.equal(JSON.parse(calls[1].body).hme, email.hme);
});

test("does not reserve a failed or malformed generated address", async () => {
  for (const result of [{ success: false, error: { errorMessage: "Limit reached" } }, { success: true, result: { hme: "bad" } }]) {
    const { client, calls } = mock([reply(result)]);
    await assert.rejects(client.create("test"));
    assert.equal(calls.length, 1);
  }
});

test("recovers the exact saved alias after a lost reservation response", async () => {
  const { client, calls } = mock([reply({ success: true, result: { hme: email.hme } }), new Error("connection reset"), reply({ success: true, result: { hmeEmails: [email] } })]);
  assert.deepEqual(await client.create("example.com"), email);
  assert.equal(calls.length, 3);
  assert.equal(calls.filter(call => call.url.endsWith("/generate")).length, 1);
});

test("never reports an unreserved alias as ready to use", async () => {
  const { client } = mock([reply({ success: true, result: { hme: email.hme } }), reply({ success: false, error: { errorMessage: "Not saved" } }), reply({ success: true, result: { hmeEmails: [] } })]);
  await assert.rejects(client.create("example.com"), /Not saved.*Check your address list/);
});

test("handles network, rate limit, invalid JSON, and malformed list responses", async () => {
  for (const result of [new Error("offline"), reply({}, 429), new Response("<html>Oops</html>"), reply({ success: true, result: {} }), reply(null)]) {
    const { client } = mock([result]);
    await assert.rejects(client.list());
  }
});
