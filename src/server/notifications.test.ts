import assert from "node:assert/strict";
import { test } from "node:test";

import type { NotificationAdapterRequest } from "@/contracts";
// @ts-expect-error Node's native TypeScript runner requires an explicit extension.
import { createA3NotificationAdapter } from "./notifications.ts";

const request: NotificationAdapterRequest = {
  logicalEventId: "event_1",
  recipientId: "member_subject",
  channel: "robot_a3",
  priority: "high",
  templateId: "care_reminder",
  text: "请查看照护提醒。",
};

test("A3 is disabled by default", async () => {
  const result = await createA3NotificationAdapter({ enabled: false }).send(
    request,
  );
  assert.deepEqual(result, { status: "disabled", safeCode: "disabled" });
});

test("A3 rejects text over 1024 UTF-8 bytes before fetch", async () => {
  let called = false;
  const fetchImpl = (async () => {
    called = true;
    return Response.json({ accepted: true });
  }) as typeof fetch;
  const result = await createA3NotificationAdapter({
    enabled: true,
    endpoint: "https://device.invalid/notify",
    fetchImpl,
  }).send({ ...request, text: "痛".repeat(400) });

  assert.deepEqual(result, { status: "failed", safeCode: "invalid_request" });
  assert.equal(called, false);
});

test("A3 times out with a bounded safe result", async () => {
  const fetchImpl = ((_input: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
      });
    })) as typeof fetch;
  const result = await createA3NotificationAdapter({
    enabled: true,
    endpoint: "https://device.invalid/notify",
    fetchImpl,
    timeoutMs: 5,
  }).send(request);

  assert.deepEqual(result, { status: "failed", safeCode: "timeout" });
});

test("A3 accepts only a small explicit provider acknowledgement", async () => {
  const accepted = await createA3NotificationAdapter({
    enabled: true,
    endpoint: "https://device.invalid/notify",
    fetchImpl: (async () => Response.json({ accepted: true })) as typeof fetch,
  }).send(request);
  const malformed = await createA3NotificationAdapter({
    enabled: true,
    endpoint: "https://device.invalid/notify",
    fetchImpl: (async () => new Response("not-json")) as typeof fetch,
  }).send(request);
  const oversized = await createA3NotificationAdapter({
    enabled: true,
    endpoint: "https://device.invalid/notify",
    fetchImpl: (async () =>
      new Response("{}", { headers: { "content-length": "2048" } })) as typeof fetch,
  }).send(request);
  const oversizedWithoutHeader = await createA3NotificationAdapter({
    enabled: true,
    endpoint: "https://device.invalid/notify",
    fetchImpl: (async () => new Response("x".repeat(2_048))) as typeof fetch,
  }).send(request);

  assert.deepEqual(accepted, { status: "sent_to_provider", safeCode: null });
  assert.deepEqual(malformed, {
    status: "failed",
    safeCode: "provider_unavailable",
  });
  assert.deepEqual(oversized, {
    status: "failed",
    safeCode: "provider_unavailable",
  });
  assert.deepEqual(oversizedWithoutHeader, {
    status: "failed",
    safeCode: "provider_unavailable",
  });
});
