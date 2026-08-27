# Platform Gateway Foundation

Status: Discovery proposal; not implementation authorization

Task: `GATEWAY-DISCOVERY-001`

Research date: 2026-08-28

Research base: `25f00004f83185be3d987424b28f627f3854b35d`

## 1. Decision

Build a transport-only channel gateway around the existing We Remember application boundary.

- Use a long-running Node.js gateway process, separate from the Next.js request runtime.
- Use the official DingTalk Stream SDK for a DingTalk enterprise internal app bot.
- Use the official Feishu/Lark Node SDK for a self-built app bot.
- Use the official WeChat ClawBot OpenClaw plugin only inside an isolated sidecar. Treat this adapter as experimental until a transport-only bridge can be proved without model, tool, memory, or domain authority.
- Expose one signed custom-bot ingress contract for future channels.
- Keep identity resolution, consent, authorization, state transitions, reminders, care escalation, deletion, and audit inside the We Remember application. No platform adapter may decide or mutate those facts directly.

Do not use OpenClaw as the We Remember business agent. An all-OpenClaw solution is quick to demo but introduces a second model/tool/memory boundary around private family messages. That conflicts with the product's consent-first and deterministic-consequence rules.

## 2. Why runtime implementation must not start from this branch

The current research base contains the shared contracts, database boundary, and some feature modules, but the active MVP Fleet has not yet produced an accepted integrated application SHA. The current contracts also do not define:

- external channel connections or member bindings;
- inbound delivery receipts and deduplication;
- outbound message intents, delivery attempts, or retries;
- a channel-safe agent turn and reply contract;
- deterministic feedback from failed delivery into reminder and care state.

Writing adapters now would either duplicate these contracts or modify files owned by the active `foundation`, `architecture`, `data`, and `integration` tracks. Runtime gateway work must start in a new approved epoch from the exact accepted `INT-001` or `INT-002` SHA, not from this discovery branch.

This branch owns only this product discovery document. It does not change the current Fleet plan, contracts, database, dependencies, deployment, or application code.

## 3. Product scope

### P0 outcome

A bound family member can send a text direct message from a supported channel. The gateway authenticates the platform event, resolves the member server-side, creates one private `agent_dm` message through the existing application command boundary, and returns a truthful response or blocked state. Deterministic reminders can be delivered to the bound member with durable receipt and retry evidence.

### P0 channel behavior

- Direct-message ingress only.
- Controlled outbound direct messages.
- Controlled outbound family-group reminders and reports only after an explicit group binding.
- Text messages and deterministic text actions first.
- Duplicate events are harmless.
- Unbound users can only complete a short-lived pairing flow.
- Group messages, files, images, voice, streaming cards, and arbitrary workplace operations are out of P0.

### Non-goals

- Reading a user's existing chat history.
- Personal-WeChat protocol emulation or reverse engineering.
- Allowing a platform payload to choose `memberId`, `spaceId`, role, visibility, or command authority.
- Giving OpenClaw access to family-domain tools, files, calendars, documents, or arbitrary network calls.
- Treating a successful transport acknowledgement as proof that an application command succeeded.
- Treating local fixtures, a platform sandbox, and production delivery as the same evidence level.

## 4. Platform findings

| Platform | Supported path | Important constraints | Decision |
| --- | --- | --- | --- |
| WeChat ClawBot | The official [`@tencent-weixin/openclaw-weixin`](https://www.npmjs.com/package/%40tencent-weixin/openclaw-weixin) channel plugin uses QR authorization and requires an OpenClaw host. Its documentation supports multiple account entries and recommends `per-account-channel-peer` DM isolation. | Login credentials are saved locally by the plugin. The documented `botAgent` value is observability metadata, not authentication or routing. The vendor npm organization currently exposes the channel plugin and installer, not a documented standalone app SDK. | Experimental sidecar only. Do not implement iLink directly from community protocol notes. Block production if a transport-only bridge cannot be proved. |
| DingTalk | A DingTalk enterprise internal app bot with the official [`dingtalk-stream`](https://github.com/open-dingtalk/dingtalk-stream-sdk-nodejs) SDK receives bot messages, events, and card callbacks over Stream mode. | The SDK has bounded pending-handler controls and retry/backpressure behavior. Official card examples warn that the same client ID must not run competing Stream services; development and production need separate app identities. A custom Webhook robot is not the two-way agent boundary. | Native Stream adapter. Start with text; add cards only after callback and idempotency tests. |
| Feishu/Lark | A self-built app bot with the official [`@larksuiteoapi/node-sdk`](https://github.com/larksuite/node-sdk) can receive `im.message.receive_v1` through Webhook or WebSocket and send replies through the message API. Its high-level Channel module is intended for conversational bots. | Long-connection handlers must finish quickly; timeout causes re-push. Multiple clients receive events in cluster mode rather than broadcast. Long connection supports event subscriptions but not every callback type, so interactive cards may still require a verified HTTP callback path. | Native SDK adapter. Acknowledge after durable enqueue, then process asynchronously. Keep cards out of P0. |
| Custom bot | A We Remember-owned HTTPS endpoint with timestamped HMAC authentication and replay protection. | No caller-supplied product actor fields; payload size, content type, timestamp, nonce, and destination are bounded. | First-class adapter contract and fixture implementation. |

Additional official references:

- [Tencent Cloud OpenClaw channel configuration](https://cloud.tencent.com/document/product/1291/129132)
- [Tencent Weixin npm organization](https://www.npmjs.com/org/tencent-weixin)
- [DingTalk custom robot guide](https://open.dingtalk.com/document/orgapp/custom-robot-access)
- [DingTalk official card and Stream examples](https://github.com/open-dingtalk/dingtalk-card-examples)
- [DingTalk Open Platform AI connection page](https://open.dingtalk.com/)
- [Feishu receive-message event](https://open.feishu.cn/document/server-docs/im-v1/message/events/receive)
- [Feishu send-message API](https://open.feishu.cn/document/server-docs/im-v1/message/create)
- [Feishu custom bot guide](https://open.feishu.cn/document/client-docs/bot-v3/add-custom-bot)

Package versions are intentionally not frozen in this discovery. These packages are moving quickly, and one observed DingTalk release is a prerelease. The later foundation task must review release notes and pin exact versions in the root lockfile.

In product language these integrations may be called custom agents. At the trust boundary, DingTalk and Feishu should still be configured as self-built application bots that provide authenticated message transport. The We Remember application remains the only agent that interprets product intent and owns domain behavior. Outbound-only custom Webhook robots are useful notification targets, but they are not substitutes for this two-way boundary.

## 5. Options considered

| Option | Time to first demo | Privacy and authority fit | Operational fit | Result |
| --- | --- | --- | --- | --- |
| OpenClaw plugins for every platform | Fast | Poor: adds another agent, model, tool, memory, and broad permission surface | One runtime, but upgrades and plugin policies become product-critical | Rejected as the core architecture |
| Native adapters for every platform | Medium | Best | Good for DingTalk and Feishu; no documented standalone ClawBot SDK was found | Incomplete for WeChat |
| Native DingTalk/Feishu plus isolated ClawBot sidecar | Medium | Good if the sidecar is transport-only and fail-closed | Separate failure domains and clear vendor ownership | Recommended |
| Webhook-only custom robots | Fast for outbound notifications | Acceptable for outbound-only use | Does not provide complete two-way DM agent behavior | Keep only as a supplemental adapter |

## 6. Target topology

```text
WeChat ClawBot
  <-> official OpenClaw channel plugin
  <-> isolated transport bridge (no model, tools, memory, or domain authority)
  <->
       +-----------------------------+
DingTalk Stream <-> native adapter   |
Feishu WS/HTTP <-> native adapter    |--> Channel Gateway Worker
Custom HTTPS   <-> signed adapter    |      | verify / normalize / dedupe
       +-----------------------------+      | bind / enqueue / deliver
                                             v
                                   Application Gateway Port
                                             |
                      +----------------------+----------------------+
                      |                                             |
             Existing command/query modules              Delivery intent outbox
                      |                                             |
              PostgreSQL domain state                    Platform delivery adapters
```

The Channel Gateway Worker is not a domain service. It cannot call repositories directly. It invokes application ports that construct actors from verified bindings and then call the existing command/query modules.

The worker must not live only in a serverless Next.js route. DingTalk Stream, Feishu WebSocket, and the ClawBot sidecar require durable processes, bounded reconnects, graceful shutdown, and health reporting.

## 7. Mandatory trust boundaries

1. **Platform authentication precedes parsing.** Verify the SDK connection, signature, timestamp, nonce, or callback token before treating the payload as an event.
2. **External IDs never grant authority.** Resolve a stored active binding to a member and space. The payload cannot supply product actor facts.
3. **Unbound content is not persisted.** Before binding, accept only the pairing command; do not store the attempted private message.
4. **Private content crosses one path.** A bound DM can enter only `CreatePrivateMessage`; the gateway does not copy it into logs, receipts, shared signals, reports, or platform telemetry.
5. **Consent remains application-owned.** A channel button or text action is only an input to an actor-authorized command. It cannot bypass `DecideConsent` or `ConfirmSignal`.
6. **Consequential behavior remains deterministic.** Platform agents and OpenClaw cannot accept handovers, activate care rules, escalate care, delete data, or choose reminder recipients.
7. **Acknowledgement is not success.** Transport receipt, durable enqueue, application result, and final delivery receipt are separate states.
8. **Every retry is idempotent.** Platform event identity, application command identity, and outbound delivery identity are distinct and durable.
9. **No raw payload retention by default.** Store a content-free event fingerprint and status. Persist the authorized message only through the existing private-message model.
10. **Fail closed.** Unknown sender, missing binding, invalid signature, unsupported content, stale action token, or ambiguous destination produces a safe blocked result.

## 8. Draft normalized contracts

These types are a proposal for the later architecture task. They are not executable contracts yet.

```ts
export type ChannelKind =
  | "wechat_clawbot"
  | "dingtalk"
  | "feishu"
  | "custom_webhook";

export type InboundContent = Readonly<{
  kind: "text";
  text: string;
}>;

export interface InboundChannelEvent {
  readonly schemaVersion: 1;
  readonly channel: ChannelKind;
  readonly connectionRef: string;
  readonly eventRef: string;
  readonly conversationRef: string;
  readonly senderRef: string;
  readonly messageRef: string;
  readonly conversationType: "direct" | "group";
  readonly occurredAt: string;
  readonly receivedAt: string;
  readonly content: InboundContent;
}

export interface ResolvedChannelActor {
  readonly bindingId: string;
  readonly memberId: string;
  readonly spaceId: string;
  readonly role: "primary" | "partner" | "subject";
  readonly authentication: "verified_session";
}

export interface OutboundMessageIntent {
  readonly intentId: string;
  readonly spaceId: string;
  readonly memberId: string;
  readonly purpose:
    | "agent_reply"
    | "consent_prompt"
    | "handover"
    | "reminder"
    | "care_notification"
    | "report";
  readonly templateId: string;
  readonly templateVersion: number;
  readonly correlationId: string;
  readonly idempotencyKey: string;
}

export type DeliveryReceipt =
  | Readonly<{ status: "delivered"; providerMessageRef: string }>
  | Readonly<{ status: "retryable_failure"; code: string }>
  | Readonly<{ status: "terminal_failure"; code: string }>;
```

Important contract choices:

- Platform references are opaque transport values, not product UUIDs.
- The adapter converts a stable platform message identity into a deterministic product `clientMessageId`; raw provider IDs do not become domain authority.
- Outbound intents reference reviewed templates and domain facts. They do not carry arbitrary URLs, executable instructions, or platform credentials.
- Action buttons use a short-lived, single-use opaque action token bound to actor, message, operation, expected version, and expiry. Platform callbacks cannot send arbitrary command bodies.
- `agent_reply` remains blocked until the application owns a clear reply contract and retention rule.

## 9. Custom robot HTTP boundary

Proposed endpoint:

```text
POST /bot-gateway/v1/events
```

Required headers:

```text
Content-Type: application/json
X-WR-Key-Id: <non-secret key reference>
X-WR-Timestamp: <unix seconds>
X-WR-Nonce: <unique random value>
X-WR-Signature: v1=<hex hmac-sha256>
```

Signature input:

```text
v1\n<timestamp>\n<nonce>\n<sha256(raw-body)>
```

Rules:

- Reject timestamps outside a narrow configured window.
- Reject a reused key ID and nonce pair.
- Compare signatures in constant time.
- Validate a strict schema after signature verification.
- Enforce a small body limit compatible with the current 4,000-character private-message boundary.
- Return only a receipt ID and `accepted`, `duplicate`, or generic `rejected`; do not reveal whether a member or space exists.
- Store signing key values only in the approved runtime secret store. Source and database rows contain key references, never secret values.

## 10. Identity and pairing

1. An authenticated member creates a short-lived pairing request inside the app.
2. The database stores only the pairing-token hash, target member, expiry, allowed channel, and attempt count.
3. The member sends the one-time pairing code in a direct chat with the bot.
4. The gateway verifies platform identity, consumes the code atomically, and creates one active binding.
5. The bot confirms success without echoing the code or exposing product identifiers.

Initial constraints:

- One active external account binding maps to one member in one space.
- Rebinding requires an authenticated app action and revokes the old binding.
- Group binding is a separate administrator action and never follows from a DM binding.
- Development, staging, and production use separate DingTalk/Feishu applications and credentials.
- Provider identifiers are sensitive personal identifiers. Production storage requires an accepted encryption and retention decision; fixture mode uses fictional identifiers.

## 11. Reliability model

### Inbound

```text
authenticate -> normalize -> resolve binding
             -> atomically dedupe + create the authorized private message
             -> acknowledge platform
             -> asynchronously analyze and enqueue a reply intent
```

- Acknowledge a bound message only after both the content-free receipt and the authorized private message are durable. If that transaction is unavailable, request provider retry rather than losing the message.
- Keep platform callback work below the platform timeout by limiting the synchronous path to authentication, binding resolution, deduplication, and one private-message transaction. AI drafting and reply generation run asynchronously.
- For an unbound sender, persist no attempted message content. Process only a valid pairing command and acknowledge the resulting bound or safely rejected state.
- Deduplicate by `(channel, connectionRef, eventRef)` and derive the product client-message identity from the stable provider message identity.
- Bound queues and concurrency. When saturated, request provider retry where supported instead of accepting and dropping work.

### Outbound

```text
domain event or reply plan -> transactional intent -> render authorized template
                           -> adapter send -> delivery receipt -> retry or terminal failure
```

- Use exponential backoff with jitter and a bounded attempt policy.
- Separate provider rate limiting by connection.
- Never mark a reminder or care notification sent before the provider returns a durable success receipt.
- Feed terminal delivery failure back into the deterministic care/reminder state machine. It must become `failed` or `unresolved`, never disappear.
- Dead-letter records contain IDs, error classes, attempt counts, and timestamps only; no message content or credential material.

## 12. Required persistence additions

The later contract and data tracks should design and verify at least:

- `channel_connections`: platform, environment, status, capability flags, credential reference, and version; never credential values.
- `channel_bindings`: connection, a keyed lookup digest, a separately protected routable provider address when required, member, space, status, and revocation facts.
- `channel_pairing_requests`: hashed token, expiry, attempts, target member, and consumed state.
- `channel_inbound_receipts`: content-free event identity, fingerprint, timestamps, and processing state.
- `channel_outbound_intents`: recipient, purpose, template reference, domain references, idempotency, and state.
- `channel_delivery_attempts`: adapter, attempt, status, safe error code, and provider receipt reference.

Space deletion must remove bindings, receipts, intents, and delivery evidence scoped to that space. Revoking a binding must prevent future delivery immediately without falsifying prior content-free receipts.

## 13. Security baseline

- Least-privilege platform scopes. Do not import the broad permission sets used by general workplace-assistant plugins.
- No secret values in source, documentation, fixtures, logs, database content fields, or `MEMORY.md`.
- Do not read local OpenClaw login material. Mount its state only into the ClawBot sidecar with restrictive filesystem permissions.
- No arbitrary callback URLs or server-side URL fetching from messages.
- No `eval`, dynamic code execution, shell execution, or tool selection from message content.
- Treat prompt-like content as untrusted data. It cannot modify system policy or adapter configuration.
- Redact message text from structured logs, traces, exception messages, and provider telemetry.
- Apply per-sender and per-connection rate limits before expensive application or AI work.
- Verify media metadata before download when media support is added; enforce type, size, decompression, malware, and retention gates.
- Keep the ClawBot sidecar on a private network path with egress restricted to the required vendor and internal gateway endpoints.

Runtime configuration may name locations such as `DINGTALK_APP_CLIENT_ID`, `DINGTALK_APP_CLIENT_SECRET`, `FEISHU_APP_ID`, `FEISHU_APP_SECRET`, `FEISHU_ENCRYPT_KEY`, `FEISHU_VERIFICATION_TOKEN`, and `CUSTOM_BOT_SIGNING_KEY_*`. Implementers must never inspect or print their values during code or fixture verification.

## 14. Proposed delivery epoch

Do not amend or relaunch the active MVP Fleet. Create a new reviewed gateway epoch after an accepted app integration SHA exists.

| Order | Task | Owner and write boundary | Outcome |
| --- | --- | --- | --- |
| 1 | `GW-PROD-001` | `product`: gateway product scope | Accept this decision, P0 channels, and evidence levels. |
| 2 | `GW-CONTRACT-001` | `architecture`: public contracts and architecture docs | Freeze channel, binding, ingress, reply, outbound intent, receipt, and deletion contracts. |
| 3 | `GW-FOUND-001` | `foundation`: root manifest, lockfile, checks | Add only reviewed official SDKs, pin exact versions, and add gateway checks. |
| 4 | `GW-DATA-001` | `data`: `packages/db/**` | Add bindings, pairing, dedupe, outbox, delivery attempts, and deletion verification. |
| 5 | `GW-CORE-001` | new non-overlapping gateway path | Implement pure normalization, binding, policy, dedupe, rendering, and retry ports with fixtures. |
| 6 | `GW-DING-001`, `GW-FEISHU-001`, `GW-CUSTOM-001` | one adapter path per task | Implement native adapters in parallel against frozen gateway contracts. |
| 7 | `GW-WECHAT-001` | isolated adapter/deploy path | Prove the official ClawBot sidecar bridge. No direct iLink implementation and no production claim. |
| 8 | `GW-INT-001` | `integration`: app/server composition and deployment | Wire the accepted adapter SHAs to application commands, outbox, and worker lifecycle. |
| 9 | `GW-QA-001` | `qa`: fixtures and E2E evidence | Prove replay, actor confusion, privacy, delivery failure, reconnect, and platform fixture behavior. |

Before this epoch is launched, the coordinator must add explicit, non-overlapping gateway adapter paths to `.agents/fleet.json`. That control-plane change belongs to the automation/control owners, not to a gateway feature worker.

## 15. Acceptance gates

### Fixture gate

- Runs without network credentials or personal data.
- Replayed inbound events create one private message and one reply intent.
- Unknown and cross-space senders cannot construct an actor or infer record existence.
- Message text never appears in logs, receipts, delivery errors, or snapshots.
- Consent, handover, care, deletion, and report behaviors still use existing deterministic application boundaries.
- Provider timeouts, malformed events, queue saturation, and terminal delivery failures are explicit and tested.

### Platform sandbox gate

- Uses dedicated development app identities and fictional accounts/content.
- Proves DM send/receive, reconnect, duplicate delivery, rate limiting, and revocation.
- Proves that platform acknowledgement, application success, and outbound delivery are separately observable.
- Proves that no adapter can invoke a consequential command with caller-selected actor facts.

### WeChat ClawBot gate

- Uses only the official plugin and a pinned compatible OpenClaw version.
- Proves account isolation with `per-account-channel-peer` or a stronger transport-only equivalent.
- Proves no model call, tool call, shared memory, broad filesystem access, or raw-content logging in the bridge path.
- Proves gateway restart and QR revocation behavior without reading or exporting login credentials.
- Remains experimental if any of these claims cannot be verified.

### Production gate

- Requires a reviewed deployment target for the long-running worker; a serverless web route alone is insufficient.
- Requires accepted encryption and retention handling for provider identifiers.
- Requires least-privilege platform permission review and separate production app identities.
- Requires monitoring for connection state, queue depth, retry age, terminal delivery failure, and redacted security events.
- Requires a rollback that disables one channel without disabling the application or corrupting domain state.

## 16. Open decisions before implementation

1. What is the authoritative application contract for an agent turn and agent reply? The current contract persists a member message and AI drafts but does not define general conversational output.
2. Will the first accepted implementation base be `INT-001` or `INT-002`?
3. Can the official ClawBot plugin be bridged as transport-only without invoking OpenClaw's model/tool/memory pipeline? If not, WeChat remains blocked or requires a vendor-supported standalone SDK.
4. Which long-running deployment target owns Stream/WebSocket processes, and how is it isolated from the Next.js runtime?
5. What encryption and retention mechanism is approved for external platform identifiers?
6. Which platform tenants and app administrators will perform setup? Live setup must be user-driven; implementation agents must not request, read, or print credentials.

## 17. Immediate next executable step

Review and accept or amend this product decision after the active MVP integration produces an exact accepted SHA. Then create `GW-CONTRACT-001` from that SHA. Do not install SDKs, create platform apps, scan QR codes, configure callbacks, or launch a gateway worker before the contract and ownership plan are accepted.
