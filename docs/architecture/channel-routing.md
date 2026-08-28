# Multi-Channel Routing Architecture

Status: Draft for review

Owner: Architecture

Target milestone: Post-fixture channel integration

Contract delta: `docs/architecture/channel-routing-contract.md`

## 1. Outcome

We Remember must accept a family member's explicit interaction through supported enterprise messaging platforms without making platform SDKs part of the product domain. The routing layer converts authenticated platform events into one canonical message boundary, preserves the existing consent model, and sends replies or deterministic notifications through a verified destination.

The product value is not "one bot in three apps." It is a consistent responsibility-transfer and care experience whose privacy, identity, and delivery guarantees remain true when the transport changes.

## 2. Product correction

An ordinary personal WeChat family group is not an approved target for the first official integration. The documented WeCom message-push webhook is outbound-only, while the WeCom intelligent robot API supports interactive callbacks or a long connection in the WeCom application context. This design therefore supports WeCom direct conversations and internal groups that can install the intelligent robot. It does not claim that the robot can join or read an ordinary personal WeChat group.

Feishu and DingTalk are also tenant-based application platforms. A family can use them only when each participating family member has an identity that the relevant tenant and bot can address. Platform account availability is an onboarding constraint, not something the router may infer or bypass.

Unsupported shortcuts are:

- personal-account automation, simulated login, unofficial protocol clients, or session scraping;
- treating an outbound custom webhook as a bidirectional bot;
- reading historical chats or enabling message archives to populate the family space;
- linking identities by display name, phone number, or guessed relationship;
- copying one platform's raw payload into the domain or another platform.

## 3. Scope

The first routing slice covers:

- WeCom intelligent robot direct messages and internal-group interactions;
- Feishu application bot direct messages and group mentions;
- DingTalk application robot direct messages and group interactions;
- explicit platform-identity and conversation binding;
- authenticated inbound normalization and durable deduplication;
- source-affine replies and deterministic notification delivery;
- capability-aware text, card, image, and acknowledgement fallbacks;
- bounded retries, rate limiting, delivery receipts, and safe observability.

It does not cover personal WeChat groups, cross-platform message mirroring, chat-history import, automatic tenant provisioning, voice transcription, or provider-specific business logic.

## 4. Completion criteria

The design is implementable when:

1. each platform has an authenticated ingress mode and a documented unsupported mode;
2. an external identity cannot act as a `MemberActor` before explicit binding;
3. a group cannot route into a `Space` before explicit conversation binding;
4. redelivery of one platform event produces at most one domain effect and one logical reply;
5. platform acknowledgement is returned before AI or domain processing;
6. group content still requires the existing per-signal consent before any L1 shared-family write;
7. a reply defaults to the source channel, while reminders use an explicit verified delivery binding;
8. consequential confirmations use a signed interactive action or authenticated web flow, never an ambiguous free-text guess;
9. unsupported media, identities, conversations, and capabilities fail closed with a safe user-facing path;
10. raw payloads, credentials, tokens, webhook URLs, and private message content are absent from ordinary logs and errors.

## 5. Architecture

```text
Platform callback or long connection
  -> platform-specific verification and decryption
  -> strict adapter parser (`unknown` -> platform event)
  -> canonical `InboundEnvelope`
  -> durable inbox claim and duplicate check
  -> installation, identity, and conversation binding
  -> deterministic `RouteDecision`
  -> existing product command boundary
  -> domain result or notification intent
  -> capability-aware renderer
  -> durable outbox
  -> platform sender
  -> content-free delivery receipt
```

Platform adapters terminate transport trust. The router owns identity resolution, conversation resolution, policy, and destination selection. Existing feature modules continue to own consent, responsibility, handover, care, privacy, and AI drafting.

No adapter may call a feature repository directly. No feature module may import a platform SDK.

## 6. Components

### 6.1 Platform adapters

Each adapter implements the same ports but keeps its protocol-specific code isolated:

```text
verifyInbound(request): VerifiedPlatformRequest
parseInbound(input: unknown): PlatformInboundEvent
renderOutbound(message, capabilities): PlatformOutboundRequest
sendOutbound(request): PlatformSendResult
```

Verification occurs before parsing content. HTTP adapters enforce method, content type, body limit, signature or token proof, timestamp/replay rules where supplied, and platform-specific decryption. Long-connection adapters authenticate the SDK session and treat every received payload as `unknown` until strict parsing succeeds.

### 6.2 Durable inbox

Platforms may retry or deliver concurrently. The inbox claims the tuple `(installationId, platformEventId)` before domain work. The canonical payload hash is stored with the claim:

- same ID and same hash: replay the recorded acknowledgement/result;
- same ID and different hash: reject as `event_identity_conflict`;
- new ID: claim once and enqueue processing.

The HTTP handler acknowledges a verified, durably claimed event without waiting for the LLM. Processing failure is retried from the inbox state, not by asking the platform to hold the request open.

### 6.3 Identity binding

`ChannelIdentityBinding` maps one platform installation and external user ID to one We Remember member. Binding requires an authenticated in-product session plus a short-lived, single-use challenge completed from the platform account.

The router never creates a family member from an inbound display name. An unbound sender receives only a pairing instruction and their content is not persisted as a product message or evidence.

Removing a binding immediately blocks new inbound authority and new outbound delivery on that binding. Historical domain records retain member provenance without retaining platform credentials.

Before binding, the adapter may return one fixed, content-free onboarding response in the same verified interaction. This response is not a product message, does not create an outbox destination, and contains only the authenticated web binding entry point.

### 6.4 Conversation binding

`ChannelConversationBinding` maps a platform conversation to a We Remember `agent_dm` or `family_group` conversation and space.

- Direct message binding requires a bound sender and a matching member-private conversation.
- Group binding requires an explicit space-admin/member action and a verified bot installation in that group.
- A group message routes only when the bot is explicitly addressed or the platform event is an interaction with a bot-authored card.
- Membership drift does not silently update space membership. Unknown or newly added platform users remain unbound and cannot acquire family-space access.

### 6.5 Router

The router is deterministic and returns a typed decision. It does not call an LLM.

Decision order:

1. verify installation is active;
2. claim or replay the inbound event;
3. resolve the bound external identity;
4. resolve the bound conversation and space;
5. reject bot-originated echoes and unsupported event types;
6. apply direct/group addressing rules;
7. create an authenticated member actor from the verified binding;
8. translate to the relevant existing or future domain command;
9. record a content-free route decision;
10. enqueue the response intent.

### 6.6 Domain bridge

The first implementation should expose only two inbound product intents:

- `member_message`: create a private product message owned by its speaker, then optionally request an AI draft;
- `member_action`: execute a validated consent, acknowledgement, handover, or correction action.

Group visibility does not bypass product consent. A group message may be visible in the external chat, but the extracted conclusion is still a new product write and must pass the existing signal-consent boundary.

### 6.7 Outbox and destination resolution

Every outbound effect is first a platform-neutral `OutboundIntent`. Destination resolution follows these rules:

- conversational reply: reply to the verified source conversation;
- consent or handover action: source conversation, with an authenticated web fallback when a secure card action is unavailable;
- care reminder: the subject's explicitly selected active delivery binding;
- care escalation: each recipient's explicitly selected active delivery binding;
- report: only the bound family group or explicitly selected authorized members.

The outbox claims `(intentId, destinationBindingId)` and stores attempts and a content-free provider receipt. Retryable failures use capped exponential backoff with jitter. Permanent capability, permission, identity, or destination failures become visible delivery failures; they do not silently switch to another person or channel.

## 7. Capability matrix

Capabilities are configuration discovered or verified per installation, not assumptions encoded in feature modules.

| Platform mode | Inbound | Outbound | Group interaction | First-slice status |
| --- | --- | --- | --- | --- |
| WeCom intelligent robot API/long connection | Yes | Reply; proactive delivery only when an approved send path is configured | Internal WeCom context only | Supported after feasibility spike |
| WeCom message-push webhook | No | Yes | Internal group push | Outbound-only; never selected as ingress |
| Personal WeChat family group | No approved official path | No approved bot path | Not available | Blocked, no workaround |
| Feishu application bot event subscription | Yes | Yes | Bot-visible direct/group events and actions | Supported |
| Feishu custom webhook | No | Yes | Group push | Outbound-only |
| DingTalk application robot event/Stream mode | Yes | Yes | Bot-visible direct/group events and actions | Supported |
| DingTalk custom webhook | No | Yes | Group push | Outbound-only |

Before implementation, each row must be reconfirmed against the target tenant edition, administrator settings, app publication status, and current official documentation.

## 8. Privacy and security

- Store platform credentials only in the deployment secret manager or environment configuration. Documentation records variable names and locations, never values.
- Store external IDs as opaque identifiers. Do not expose them to the AI provider.
- Do not log callback bodies, decrypted payloads, message content, card form values, media URLs, webhook URLs, tokens, signatures, or SDK error response bodies.
- Record only request ID, installation ID, hashed external event ID where needed, route-decision code, latency, retry class, and safe platform error code.
- Download media only through the adapter after authorization, size/type limits, timeout, redirect policy, and host allowlisting. Never let a platform-provided URL become an unrestricted server-side fetch.
- Keep L0 raw content self-visible and deletable. A platform group does not convert L0 content into L1 shared content.
- Reject events from disabled installations, unbound identities, unbound conversations, unsupported chats, stale interactive actions, and mismatched action actors.
- Interactive actions carry a short-lived nonce bound to installation, conversation, member, action, target, and expected version. Replays return the original result.

## 9. Ordering and reliability

Platform timestamps are provenance, not an authority clock. The inbox assigns a server receive time and monotonically ordered processing position per bound conversation. Processing for one conversation is serialized; separate conversations may run concurrently.

Exactly-once transport is not assumed. The goal is at-least-once receipt with exactly-once domain effects through inbox and command idempotency. A platform `200`, SDK callback acknowledgement, or send API success proves only that transport accepted the request; it does not prove user delivery, reading, consent, or domain completion.

## 10. Rollout

### Phase 0: feasibility spikes

- prove one authenticated inbound text and one reply for each target application bot;
- prove whether the exact target group type can install and interact with the bot;
- record tenant/admin/app-publication prerequisites and rate limits;
- store no family content and use fictional test accounts only.

### Phase 1: one platform, direct message

Implement identity binding, durable inbox, `member_message`, source-affine reply, outbox, and deletion behavior for one platform. Feishu or DingTalk is the lowest-risk first slice because their application-bot event paths are explicit. WeCom follows after its target group type is proven.

### Phase 2: secure actions

Add consent, care acknowledgement, and handover actions with signed nonces and authenticated web fallbacks. Do not ship free-text consequential confirmations.

### Phase 3: bound family groups

Add explicit group binding, mention gating, membership-drift handling, and neutral report delivery. Preserve per-signal consent.

### Phase 4: additional adapters

Add the remaining platforms behind the same contract. Do not generalize further until two production-shaped adapters demonstrate a real shared abstraction.

## 11. Required implementation tasks

1. `CONTRACT-ROUTING-001`: freeze canonical envelopes, route decisions, identity evidence, intents, errors, and ports.
2. `DATA-ROUTING-001`: add installations, identity/conversation bindings, inbox, outbox, and delivery receipts with deletion semantics.
3. `ROUTER-001`: implement deterministic routing and domain bridge without platform SDKs.
4. `ADAPTER-FEISHU-001`: implement the first application-bot adapter.
5. `ADAPTER-DINGTALK-001`: implement DingTalk after the first adapter contract stabilizes.
6. `ADAPTER-WECOM-001`: implement only after the exact direct/group capability spike passes.
7. `SEC-ROUTING-001`: verify callback authentication, replay defenses, media handling, redaction, and action nonces.
8. `INT-ROUTING-001`: run end-to-end redelivery, outage, revocation, deletion, and rate-limit scenarios.

## 12. Verification strategy

- contract tests for every envelope and denied route;
- adapter fixtures signed/encrypted with non-secret test keys;
- duplicate, conflict, out-of-order, echo, stale-action, and retry tests;
- identity and conversation binding authorization tests;
- notification destination and no-silent-fallback tests;
- deletion tests covering bindings, inbox content references, and outbox content;
- integration tests with vendor sandboxes/test tenants and fictional content;
- a manual receipt proving the exact group type, tenant settings, and app publication used.

## 13. Open gates

- Which platform is the first production-shaped slice: Feishu or DingTalk?
- Is the WeCom target an internal WeCom group, a direct intelligent-robot conversation, a customer group, or an ordinary personal WeChat family group?
- Which deployment can accept public callbacks, and which environments require long connections?
- What is the retention period for canonical inbox payloads after successful processing?
- Which platform binding is the default delivery destination for each member and notification class?

These gates affect implementation sequencing, not the canonical privacy and routing model.

## 14. Official references

- [WeCom intelligent robot overview](https://developer.work.weixin.qq.com/document/path/101039)
- [WeCom intelligent robot message receiving](https://developer.work.weixin.qq.com/document/path/100719)
- [WeCom intelligent robot long connection](https://developer.work.weixin.qq.com/document/path/101463)
- [WeCom message-push webhook configuration](https://developer.work.weixin.qq.com/document/path/91770)
- [Feishu message receive event](https://open.feishu.cn/document/server-docs/im-v1/message/events/receive)
- [Feishu send message API](https://open.feishu.cn/document/server-docs/im-v1/message/create)
- [DingTalk robot overview](https://open.dingtalk.com/document/orgapp/robot-overview)
- [DingTalk custom robot access](https://open.dingtalk.com/document/orgapp/custom-robot-access)

These references describe platform surfaces, not proof that a specific tenant, edition, group type, or application has the required capability. Phase 0 must produce that evidence.
