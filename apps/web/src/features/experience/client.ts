import { z } from "zod";

import {
  EntityIdSchema,
  ResponsibilityReportSchema,
} from "../../../../../packages/contracts/src/index";
import {
  FIXTURE_TRANSITIONS,
  getFixtureSnapshot,
  type FixtureScenarioStateId,
} from "./fixture-scenario";
import type {
  CanonicalScenarioActionId,
  ExperienceActionRequest,
  ExperienceClient,
  ExperienceSnapshot,
} from "./model";

export type ExperienceClientErrorCode =
  | "fixture_connection_interrupted"
  | "fixture_request_rejected"
  | "malformed_fixture_response"
  | "stale_fixture_revision"
  | "unexpected_fixture_action"
  | "unsupported_fixture_action";

export class ExperienceClientError extends Error {
  readonly code: ExperienceClientErrorCode;
  readonly recoverable: boolean;

  constructor(code: ExperienceClientErrorCode, message: string, recoverable: boolean) {
    super(message);
    this.name = "ExperienceClientError";
    this.code = code;
    this.recoverable = recoverable;
  }
}

const MVP_CORE_STATE_PATH = "/api/fixtures/mvp-core/state";
const MVP_CORE_COMMAND_PATH = "/api/fixtures/mvp-core/commands";
const MVP_CORE_RESET_PATH = "/api/fixtures/mvp-core/reset";

const MvpCoreCommandSchema = z.enum([
  "read_private_message",
  "share_private_message",
  "record_share_consent",
  "record_no_consent",
  "publish_consented_signal",
  "generate_report",
  "supply_handover_info",
  "confirm_handover_from",
  "confirm_handover_to",
]);
type MvpCoreCommand = z.infer<typeof MvpCoreCommandSchema>;
type OrdinaryMvpCoreCommand = Exclude<
  MvpCoreCommand,
  "read_private_message" | "share_private_message"
>;

/**
 * Consumer-side decoding for the accepted QA-002 response boundary.
 * This remains private so the QA seam stays the only exported wire contract.
 */
const MvpCoreSnapshotSchema = z.strictObject({
  scenarioId: z.literal("mvp-core"),
  revision: z.number().int().nonnegative(),
  writeCount: z.number().int().nonnegative(),
  sharedWriteCount: z.number().int().nonnegative(),
  consent: z.enum(["pending", "shared", "discarded"]),
  sharedRows: z.number().int().nonnegative(),
  reportRows: z.number().int().nonnegative(),
  responsibilityOwners: z.strictObject({
    discoveredBy: EntityIdSchema,
    deadlineKeptBy: EntityIdSchema,
    scheduledBy: EntityIdSchema,
    executedBy: EntityIdSchema,
    followedUpBy: EntityIdSchema,
  }),
  domainOwnerId: EntityIdSchema,
  futureReminderCount: z.literal(1),
  reminderOwnerId: EntityIdSchema,
  handover: z.strictObject({
    status: z.enum(["blocked", "awaiting_confirmations", "accepted"]),
    fromConfirmed: z.boolean(),
    toConfirmed: z.boolean(),
  }),
});
type MvpCoreSnapshot = z.infer<typeof MvpCoreSnapshotSchema>;

const MvpCoreCommandResponseSchema = z.discriminatedUnion("ok", [
  z.strictObject({
    ok: z.literal(true),
    command: MvpCoreCommandSchema,
    state: MvpCoreSnapshotSchema,
    result: z.strictObject({
      privateMessage: z
        .strictObject({ id: EntityIdSchema, content: z.string().min(1) })
        .optional(),
      report: ResponsibilityReportSchema.optional(),
    }),
  }),
  z.strictObject({
    ok: z.literal(false),
    command: MvpCoreCommandSchema.nullable(),
    code: z.enum([
      "invalid_request",
      "invalid_session",
      "not_found",
      "forbidden",
      "consent_required",
      "raw_private_share_denied",
      "handover_blocked",
      "transition_denied",
    ]),
    state: MvpCoreSnapshotSchema,
  }),
]);

const malformedResponse = (): ExperienceClientError =>
  new ExperienceClientError(
    "malformed_fixture_response",
    "Fixture 服务返回了无法验证的数据，本次操作没有提交。",
    false,
  );

const requestRejected = (status: number): ExperienceClientError => {
  const recoverable = status === 408 || status === 429 || status >= 500;
  return new ExperienceClientError(
    "fixture_request_rejected",
    recoverable
      ? "Fixture 服务暂时不可用，本次操作没有提交。"
      : "Fixture 服务拒绝了本次操作，当前状态没有改变。",
    recoverable,
  );
};

const connectionInterrupted = (): ExperienceClientError =>
  new ExperienceClientError(
    "fixture_connection_interrupted",
    "连接短暂中断，本次操作没有提交。",
    true,
  );

const snapshotIsCoherent = (snapshot: MvpCoreSnapshot): boolean => {
  if (snapshot.consent !== "shared" && snapshot.sharedRows > 0) {
    return false;
  }
  if (snapshot.reportRows > 0 && snapshot.sharedRows === 0) {
    return false;
  }
  if (
    snapshot.handover.status === "accepted" &&
    (!snapshot.handover.fromConfirmed || !snapshot.handover.toConfirmed)
  ) {
    return false;
  }
  if (
    snapshot.handover.status !== "accepted" &&
    snapshot.handover.fromConfirmed &&
    snapshot.handover.toConfirmed
  ) {
    return false;
  }
  return true;
};

const parseSnapshot = (input: unknown): MvpCoreSnapshot => {
  const parsed = MvpCoreSnapshotSchema.safeParse(input);
  if (!parsed.success || !snapshotIsCoherent(parsed.data)) {
    throw malformedResponse();
  }
  return parsed.data;
};

const toFixtureState = (snapshot: MvpCoreSnapshot): FixtureScenarioStateId => {
  if (snapshot.consent === "pending") {
    return "consent";
  }
  if (snapshot.consent === "discarded") {
    return "consent_private";
  }
  if (snapshot.handover.status === "accepted") {
    return "accepted";
  }
  if (snapshot.handover.status === "awaiting_confirmations") {
    return snapshot.handover.fromConfirmed && !snapshot.handover.toConfirmed
      ? "source_confirmed"
      : "awaiting_confirmations";
  }
  if (snapshot.reportRows > 0) {
    return "blocked";
  }
  if (snapshot.sharedRows > 0) {
    return "report";
  }
  return "consent";
};

const toExperienceSnapshot = (
  snapshot: MvpCoreSnapshot,
  forcedState?: FixtureScenarioStateId,
): ExperienceSnapshot => getFixtureSnapshot(forcedState ?? toFixtureState(snapshot), snapshot.revision);

const stateMatches = (
  snapshot: MvpCoreSnapshot,
  predicate: (value: MvpCoreSnapshot) => boolean,
): MvpCoreSnapshot => {
  if (!snapshotIsCoherent(snapshot) || !predicate(snapshot)) {
    throw malformedResponse();
  }
  return snapshot;
};

export interface HttpExperienceClientOptions {
  readonly fetch?: typeof fetch;
}

const runtimeFetch: typeof fetch = (input, init) => globalThis.fetch(input, init);

class HttpExperienceClient implements ExperienceClient {
  private readonly fetcher: typeof fetch;
  private currentSnapshot: ExperienceSnapshot | null = null;

  constructor(options: HttpExperienceClientOptions) {
    this.fetcher = options.fetch ?? runtimeFetch;
  }

  private async request(input: string, init: RequestInit): Promise<Response> {
    try {
      return await this.fetcher(input, init);
    } catch (error: unknown) {
      if (error instanceof ExperienceClientError) {
        throw error;
      }
      throw connectionInterrupted();
    }
  }

  private async readJson(response: Response): Promise<unknown> {
    try {
      return (await response.json()) as unknown;
    } catch {
      throw malformedResponse();
    }
  }

  private async readState(): Promise<MvpCoreSnapshot> {
    const response = await this.request(MVP_CORE_STATE_PATH, {
      method: "GET",
      headers: { accept: "application/json" },
      credentials: "same-origin",
      cache: "no-store",
    });
    if (response.status !== 200) {
      throw requestRejected(response.status);
    }
    return parseSnapshot(await this.readJson(response));
  }

  private async sendCommand(command: OrdinaryMvpCoreCommand): Promise<MvpCoreSnapshot> {
    const response = await this.request(MVP_CORE_COMMAND_PATH, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      credentials: "same-origin",
      body: JSON.stringify({ command }),
    });
    if (response.status !== 200) {
      throw requestRejected(response.status);
    }

    const parsed = MvpCoreCommandResponseSchema.safeParse(await this.readJson(response));
    if (!parsed.success || !parsed.data.ok || parsed.data.command !== command) {
      throw malformedResponse();
    }
    return parsed.data.state;
  }

  private remember(
    serverSnapshot: MvpCoreSnapshot,
    forcedState?: FixtureScenarioStateId,
  ): ExperienceSnapshot {
    const nextSnapshot = toExperienceSnapshot(serverSnapshot, forcedState);
    this.currentSnapshot = nextSnapshot;
    return nextSnapshot;
  }

  async load(): Promise<ExperienceSnapshot> {
    return this.remember(await this.readState());
  }

  async perform(request: ExperienceActionRequest): Promise<ExperienceSnapshot> {
    if (this.currentSnapshot === null) {
      throw new ExperienceClientError(
        "unexpected_fixture_action",
        "请先加载当前 Fixture，再执行操作。",
        true,
      );
    }
    if (request.expectedRevision !== this.currentSnapshot.revision) {
      throw new ExperienceClientError(
        "stale_fixture_revision",
        "页面状态已经更新，请重新加载当前 Fixture。",
        true,
      );
    }

    switch (request.actionId) {
      case "share_with_space": {
        await this.sendCommand("record_share_consent");
        const serverSnapshot = stateMatches(
          await this.sendCommand("publish_consented_signal"),
          (value) => value.consent === "shared" && value.sharedRows > 0,
        );
        return this.remember(serverSnapshot, "report");
      }
      case "share_with_primary":
        throw new ExperienceClientError(
          "unsupported_fixture_action",
          "当前 HTTP Fixture 不支持指定成员范围分享，本次没有提交。",
          false,
        );
      case "keep_private": {
        const serverSnapshot = stateMatches(
          await this.sendCommand("record_no_consent"),
          (value) => value.consent === "discarded" && value.sharedRows === 0,
        );
        return this.remember(serverSnapshot, "consent_private");
      }
      case "propose_handover": {
        const serverSnapshot = stateMatches(
          await this.sendCommand("generate_report"),
          (value) => value.reportRows > 0 && value.handover.status === "blocked",
        );
        return this.remember(serverSnapshot, "blocked");
      }
      case "supply_last_check_result": {
        const serverSnapshot = stateMatches(
          await this.sendCommand("supply_handover_info"),
          (value) =>
            value.handover.status === "awaiting_confirmations" &&
            !value.handover.fromConfirmed &&
            !value.handover.toConfirmed,
        );
        return this.remember(serverSnapshot, "awaiting_confirmations");
      }
      case "confirm_handover_source": {
        const serverSnapshot = stateMatches(
          await this.sendCommand("confirm_handover_from"),
          (value) =>
            value.handover.status === "awaiting_confirmations" &&
            value.handover.fromConfirmed &&
            !value.handover.toConfirmed,
        );
        return this.remember(serverSnapshot, "source_confirmed");
      }
      case "confirm_handover_recipient": {
        const serverSnapshot = stateMatches(
          await this.sendCommand("confirm_handover_to"),
          (value) =>
            value.handover.status === "accepted" &&
            value.handover.fromConfirmed &&
            value.handover.toConfirmed,
        );
        return this.remember(serverSnapshot, "accepted");
      }
      case "restart_fixture": {
        const response = await this.request(MVP_CORE_RESET_PATH, {
          method: "POST",
          headers: {
            accept: "application/json",
            "content-type": "application/json",
          },
          credentials: "same-origin",
          body: JSON.stringify({}),
        });
        if (response.status !== 204) {
          throw requestRejected(response.status);
        }
        const serverSnapshot = stateMatches(
          await this.readState(),
          (value) =>
            value.revision === 0 &&
            value.consent === "pending" &&
            value.sharedRows === 0 &&
            value.reportRows === 0 &&
            value.handover.status === "blocked",
        );
        return this.remember(serverSnapshot, "consent");
      }
    }
  }
}

export const createHttpExperienceClient = (
  options: HttpExperienceClientOptions = {},
): ExperienceClient => new HttpExperienceClient(options);

export interface LocalFixtureClientOptions {
  readonly delayMs?: number;
  readonly failOnceOn?: CanonicalScenarioActionId;
}

const wait = async (delayMs: number): Promise<void> => {
  if (delayMs <= 0) {
    await Promise.resolve();
    return;
  }

  await new Promise<void>((resolve) => {
    setTimeout(resolve, delayMs);
  });
};

class LocalFixtureExperienceClient implements ExperienceClient {
  private state: FixtureScenarioStateId = "consent";
  private revision = 0;
  private failOnceOn: CanonicalScenarioActionId | null;
  private readonly delayMs: number;

  constructor(options: LocalFixtureClientOptions) {
    this.delayMs = options.delayMs ?? 80;
    this.failOnceOn = options.failOnceOn ?? null;
  }

  async load(): Promise<ExperienceSnapshot> {
    await wait(this.delayMs);
    return getFixtureSnapshot(this.state, this.revision);
  }

  async perform(request: ExperienceActionRequest): Promise<ExperienceSnapshot> {
    await wait(this.delayMs);

    if (request.expectedRevision !== this.revision) {
      throw new ExperienceClientError(
        "stale_fixture_revision",
        "页面状态已经更新，请重新加载当前 Fixture。",
        true,
      );
    }

    if (this.failOnceOn === request.actionId) {
      this.failOnceOn = null;
      throw new ExperienceClientError(
        "fixture_connection_interrupted",
        "连接短暂中断，本次操作没有提交。",
        true,
      );
    }

    const transitions = FIXTURE_TRANSITIONS[this.state];
    const nextState: FixtureScenarioStateId | undefined = transitions[request.actionId];

    if (nextState === undefined) {
      throw new ExperienceClientError(
        "unexpected_fixture_action",
        "当前 Fixture 状态不接受这个操作。",
        false,
      );
    }

    this.state = nextState;
    this.revision += 1;
    return getFixtureSnapshot(this.state, this.revision);
  }
}

/** Explicit test dependency; production never resolves this client by default. */
export const createLocalFixtureClient = (
  options: LocalFixtureClientOptions = {},
): ExperienceClient => new LocalFixtureExperienceClient(options);
