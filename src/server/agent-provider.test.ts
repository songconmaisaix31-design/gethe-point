import assert from "node:assert/strict";
import { test } from "node:test";

import type { AgentProviderRequest } from "./agent-provider.ts";
// @ts-expect-error Node's native TypeScript runner requires an explicit extension.
import { createStepFunAgentProvider } from "./agent-provider.ts";

const PRIVATE_EVIDENCE = "腿又疼了，下楼有点吃力";
const SECRET = "test-secret-must-not-leak";

const request: AgentProviderRequest = {
  question: "请查看今天的日程安排",
  targetDisplayName: "周素兰",
  intent: "schedule",
  deterministicAnswer: "周素兰当前有 1 项可见日程：晚间用药。",
  visibleTimetable: [
    {
      title: "晚间用药",
      startsAt: "2026-08-29T19:00:00+08:00",
      endsAt: "2026-08-29T19:30:00+08:00",
      category: "care",
      status: "planned",
    },
  ],
  visibleResponsibilityCount: 0,
  visibleCareRuleCount: 1,
};

test("StepFun sends one bounded request to the fixed endpoint and validates text", async () => {
  let calls = 0;
  let outboundBody = "";
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls += 1;
    assert.equal(input.toString(), "https://api.stepfun.com/v1/chat/completions");
    assert.equal(init?.method, "POST");
    outboundBody = String(init?.body);
    return Response.json({
      choices: [{ message: { content: "  今晚有一项可见的用药安排。  " } }],
    });
  }) as typeof fetch;

  const result = await createStepFunAgentProvider({
    apiKey: SECRET,
    fetchImpl,
  }).rewrite(request);

  assert.equal(result, "今晚有一项可见的用药安排。");
  assert.equal(calls, 1);
  const body = JSON.parse(outboundBody) as {
    readonly model: string;
    readonly max_tokens: number;
    readonly messages: readonly { readonly content: string }[];
  };
  assert.equal(body.model, "step-2-mini");
  assert.equal(body.max_tokens, 180);
  assert.equal(body.messages.length, 2);
  assert.equal(outboundBody.includes(request.question), true);
  assert.equal(outboundBody.includes(PRIVATE_EVIDENCE), false);
  assert.equal(outboundBody.includes(SECRET), false);
  assert.equal(outboundBody.includes("evidence_"), false);
  assert.equal(outboundBody.includes("notification"), false);
  assert.equal(outboundBody.includes("member_subject"), false);
});

test("StepFun falls back without a configured key and never calls fetch", async () => {
  let called = false;
  const result = await createStepFunAgentProvider({
    fetchImpl: (async () => {
      called = true;
      return Response.json({ choices: [] });
    }) as typeof fetch,
  }).rewrite(request);

  assert.equal(result, null);
  assert.equal(called, false);
});

test("StepFun times out once and returns no provider error", async () => {
  let calls = 0;
  const fetchImpl = ((_input: RequestInfo | URL, init?: RequestInit) => {
    calls += 1;
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        reject(Object.assign(new Error(`aborted ${SECRET}`), { name: "AbortError" }));
      });
    });
  }) as typeof fetch;

  const result = await createStepFunAgentProvider({
    apiKey: SECRET,
    fetchImpl,
    timeoutMs: 5,
  }).rewrite(request);

  assert.equal(result, null);
  assert.equal(calls, 1);
});

test("StepFun falls back once for network, HTTP, JSON, empty, and oversized failures", async (context) => {
  const cases: readonly {
    readonly name: string;
    readonly response: () => Promise<Response>;
  }[] = [
    {
      name: "network",
      response: async () => {
        throw new Error(`network ${SECRET}`);
      },
    },
    {
      name: "HTTP",
      response: async () => new Response(`provider body ${SECRET}`, { status: 503 }),
    },
    {
      name: "malformed JSON",
      response: async () => new Response("not-json"),
    },
    {
      name: "empty text",
      response: async () => Response.json({ choices: [{ message: { content: "  " } }] }),
    },
    {
      name: "oversized text",
      response: async () => Response.json({ choices: [{ message: { content: "答".repeat(721) } }] }),
    },
    {
      name: "oversized response body",
      response: async () => new Response("x".repeat(16_385)),
    },
  ];

  for (const failure of cases) {
    await context.test(failure.name, async () => {
      let calls = 0;
      const result = await createStepFunAgentProvider({
        apiKey: SECRET,
        fetchImpl: (async () => {
          calls += 1;
          return failure.response();
        }) as typeof fetch,
      }).rewrite(request);

      assert.equal(result, null);
      assert.equal(calls, 1);
    });
  }
});

test("StepFun does not log secrets or provider bodies", async () => {
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;
  const logged: unknown[] = [];
  console.log = (...values: unknown[]) => { logged.push(...values); };
  console.warn = (...values: unknown[]) => { logged.push(...values); };
  console.error = (...values: unknown[]) => { logged.push(...values); };
  try {
    const result = await createStepFunAgentProvider({
      apiKey: SECRET,
      fetchImpl: (async () =>
        new Response(`provider body ${SECRET}`, { status: 500 })) as typeof fetch,
    }).rewrite(request);
    assert.equal(result, null);
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
  }

  assert.deepEqual(logged, []);
});
