# Multi-Channel Routing Contract Delta

Status: Draft; not part of the frozen `CONTRACT-001` package

Executable target: future `@we-remember/contracts` package-root exports

## 1. Boundary

This document defines the minimum contract delta needed before any WeCom, Feishu, or DingTalk SDK enters the repository. It does not amend the frozen MVP contract by itself.

Provider payloads begin as `unknown`. A platform adapter verifies transport authenticity and narrows the payload before creating any public routing type. Requests cannot select their own member, space, installation, or conversation authority.

## 2. Common types

```ts
type ChannelPlatform = "wecom" | "feishu" | "dingtalk";

type ChannelSurface = "direct" | "group";

type ChannelEventKind = "message" | "action";

interface InboundEnvelope {
  schemaVersion: 1;
  platform: ChannelPlatform;
  installationId: EntityId;
  platformEventId: string;
  platformConversationId: string;
  platformSenderId: string;
  surface: ChannelSurface;
  eventKind: ChannelEventKind;
  occurredAt: Timestamp;
  receivedAt: Timestamp;
  replyReference: string | null;
  payload: InboundMessage | InboundAction;
}

interface InboundMessage {
  kind: "message";
  platformMessageId: string;
  content: ChannelContent;
  addressedToBot: boolean;
}

interface InboundAction {
  kind: "action";
  actionToken: string;
  actionValue: string;
}

type ChannelContent =
  | { type: "text"; text: string }
  | { type: "image"; mediaReference: string; safeMetadata: MediaMetadata };
```

Exact schemas must bound all strings, reject unknown keys, validate offset-aware timestamps, and keep provider-specific fields out of package consumers.

## 3. Installation and binding records

```ts
interface ChannelInstallation {
  id: EntityId;
  platform: ChannelPlatform;
  externalTenantId: string;
  status: "pending" | "active" | "disabled" | "revoked";
  ingressMode: "callback" | "long_connection";
  capabilities: ChannelCapabilities;
  version: number;
}

interface ChannelIdentityBinding {
  id: EntityId;
  installationId: EntityId;
  externalUserId: string;
  memberId: EntityId;
  status: "pending" | "active" | "revoked";
  verifiedAt: Timestamp | null;
  version: number;
}

interface ChannelConversationBinding {
  id: EntityId;
  installationId: EntityId;
  externalConversationId: string;
  conversationId: EntityId;
  spaceId: EntityId;
  surface: ChannelSurface;
  status: "pending" | "active" | "disabled";
  version: number;
}
```

Secrets, access tokens, webhook URLs, encryption keys, and raw platform configuration are not contract fields.

## 4. Authentication evidence

The future actor contract needs a production platform assertion. It must be constructed only after installation, identity, and conversation checks pass.

```ts
interface PlatformAuthenticationEvidence {
  kind: "platform_assertion";
  platform: ChannelPlatform;
  installationId: EntityId;
  identityBindingId: EntityId;
  platformEventId: string;
}
```

The binding resolves the member and space. The inbound payload never supplies those IDs. The existing scalar `AuthenticationEvidenceSchema` cannot safely express this provenance and requires an explicit versioned contract amendment.

## 5. Route decisions

```ts
type RouteDecision =
  | { status: "accepted"; actor: MemberActor; intent: ProductIntent }
  | { status: "replayed"; originalReceiptId: EntityId }
  | {
      status: "ignored";
      reason: "bot_echo" | "not_addressed" | "unsupported_event";
    }
  | {
      status: "rejected";
      reason:
        | "installation_inactive"
        | "identity_unbound"
        | "conversation_unbound"
        | "surface_mismatch"
        | "event_identity_conflict"
        | "action_invalid"
        | "action_expired"
        | "capability_missing";
    };

type ProductIntent =
  | {
      kind: "member_message";
      conversationId: EntityId;
      clientMessageId: EntityId;
      content: MessageContent;
      occurredAt: Timestamp;
    }
  | {
      kind: "member_action";
      action: ConsequentialAction;
      targetId: EntityId;
      expectedVersion: number;
      idempotencyKey: IdempotencyKey;
    };
```

Rejected and ignored results contain no message content, external user ID, external conversation ID, or record-existence detail.

## 6. Outbound intents

```ts
type OutboundPurpose =
  | "conversation_reply"
  | "consent_request"
  | "handover_action"
  | "care_reminder"
  | "care_escalation"
  | "responsibility_report"
  | "safe_error";

interface OutboundIntent {
  id: EntityId;
  spaceId: EntityId;
  recipientMemberId: EntityId | null;
  sourceConversationBindingId: EntityId | null;
  purpose: OutboundPurpose;
  content: OutboundContent;
  requiredCapabilities: ChannelCapability[];
  idempotencyKey: IdempotencyKey;
  createdAt: Timestamp;
}

type DestinationPolicy =
  | { kind: "reply_to_source" }
  | { kind: "member_preference"; notificationClass: NotificationClass }
  | { kind: "bound_family_group" };
```

`OutboundIntent` describes a logical effect, not a provider request. Rendering and destination resolution occur after authorization.

## 7. Commands

| Command | Actor | Required request facts | Result |
| --- | --- | --- | --- |
| `RegisterChannelInstallation` | authenticated space administrator/member with installation authority | platform, external tenant proof, ingress mode, capability probe | pending or active installation |
| `BeginChannelIdentityBinding` | `MemberActor` | installation, expected member version, idempotency key | short-lived single-use challenge |
| `CompleteChannelIdentityBinding` | verified platform assertion plus authenticated member session | challenge, external user proof, expected versions, idempotency key | active binding or conflict |
| `RevokeChannelIdentityBinding` | bound `MemberActor` | binding, expected version, idempotency key | revoked binding and delivery block |
| `BindChannelConversation` | authorized `MemberActor` | installation, external conversation proof, internal conversation, surface, expected versions, idempotency key | active binding |
| `DisableChannelConversation` | authorized `MemberActor` | binding, expected version, idempotency key | disabled binding |
| `RouteInboundChannelEvent` | `channel_router` system actor | canonical envelope, payload hash, inbox claim | typed `RouteDecision` |
| `EnqueueOutboundIntent` | named feature system actor or authorized feature command | intent and destination policy | durable outbox receipt |
| `RecordChannelDelivery` | `channel_delivery` system actor | outbox item, attempt, safe provider outcome, observed time | retry, delivered-to-platform, or permanent failure |

Installation registration must not accept secret values in the request. It references an environment or secret-manager configuration key established outside the product API.

## 8. Queries

| Query | Result boundary |
| --- | --- |
| `GetMyChannelBindings` | only the requester's masked platform, status, surface, and display label |
| `GetSpaceChannelConversations` | authorized space bindings without external raw IDs or secrets |
| `GetChannelDeliveryStatus` | content-free logical status for an authorized intent |

No query returns callback payloads, webhook URLs, tokens, encryption keys, signatures, raw SDK errors, or another member's external platform identifier.

## 9. Error codes

The bounded public set is:

```text
invalid_request
unauthenticated
forbidden
not_found
conflict
idempotency_conflict
installation_inactive
identity_unbound
conversation_unbound
surface_mismatch
event_identity_conflict
unsupported_event
unsupported_content
capability_missing
action_invalid
action_expired
platform_rate_limited
platform_unavailable
delivery_failed
internal_failure
```

Provider error bodies are never copied into public errors. Retryability is assigned by the adapter from a bounded mapping.

## 10. Events and audit

Allowed domain events are content-free:

```text
channel.installation.activated
channel.installation.disabled
channel.identity.bound
channel.identity.revoked
channel.conversation.bound
channel.conversation.disabled
channel.inbound.accepted
channel.inbound.rejected
channel.delivery.succeeded
channel.delivery.failed
```

Audit payloads may include internal entity IDs, platform enum, decision/error code, versions, and timestamps. They must not include external IDs, message content, media references, reply references, action tokens, provider receipts, or secret configuration keys.

## 11. Persistence invariants

- Active identity uniqueness: `(installationId, externalUserId)` maps to at most one active member.
- Active conversation uniqueness: `(installationId, externalConversationId)` maps to at most one active product conversation.
- Inbox uniqueness: `(installationId, platformEventId)` is unique and includes a canonical payload hash.
- Outbox uniqueness: `(intentId, destinationBindingId)` is unique.
- Action nonce uniqueness: one successful consequential action per nonce and canonical request hash.
- Revoked/disabled bindings cannot authorize new effects even when an old event is redelivered.
- Space deletion removes all installations scoped exclusively to the space, bindings, inbox payload/content references, outbox content, delivery attempts, and channel audit entries in the same deletion workflow.

## 12. Required denial tests

- valid signature with an unbound sender;
- bound sender in an unbound group;
- group message that does not address the bot;
- bot echo;
- duplicate event with the same hash;
- duplicate event ID with a different hash;
- revoked binding redelivery;
- action token used by another member or conversation;
- stale action expected version;
- platform accepts a send but user delivery remains unproven;
- missing card capability falls back only to an authenticated web action;
- no active reminder destination produces a visible delivery failure, not a guessed recipient;
- deletion leaves no routable identity, pending content, or reusable action token.
