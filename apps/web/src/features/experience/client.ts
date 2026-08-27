import {
  MVP_CORE_CANONICAL_REPORT,
  MVP_CORE_PATHS,
} from "./fixture-display";
import type {
  ExperienceActionId,
  ExperienceClient,
  ExperienceSnapshot,
  ExperienceStage,
} from "./model";
import {
  decodeMvpCoreSnapshot,
  MvpCoreCommandResponseSchema,
  VisibleMvpCoreCommandSchema,
  type MvpCoreReport,
  type MvpCoreSnapshot,
  type VisibleMvpCoreCommand,
} from "./wire-contract";

export type ExperienceClientErrorCode =
  | "fixture_connection_interrupted"
  | "fixture_request_rejected"
  | "malformed_fixture_response"
  | "unexpected_fixture_action";

export type SnapshotTruthSource = "response" | "reload" | "retained";

export class ExperienceClientError extends Error {
  readonly code: ExperienceClientErrorCode;
  readonly recoverable: boolean;
  readonly snapshot: ExperienceSnapshot | null;
  readonly truthSource: SnapshotTruthSource | null;

  constructor(
    code: ExperienceClientErrorCode,
    message: string,
    recoverable: boolean,
    snapshot: ExperienceSnapshot | null = null,
    truthSource: SnapshotTruthSource | null = null,
  ) {
    super(message);
    this.name = "ExperienceClientError";
    this.code = code;
    this.recoverable = recoverable;
    this.snapshot = snapshot;
    this.truthSource = truthSource;
  }

  withTruth(
    snapshot: ExperienceSnapshot | null,
    truthSource: SnapshotTruthSource,
  ): ExperienceClientError {
    return new ExperienceClientError(
      this.code,
      this.message,
      this.recoverable,
      snapshot,
      truthSource,
    );
  }
}

const connectionInterrupted = (): ExperienceClientError =>
  new ExperienceClientError(
    "fixture_connection_interrupted",
    "连接在响应完成前中断，客户端无法判断服务端是否已经接受写入。",
    true,
  );

const malformedResponse = (): ExperienceClientError =>
  new ExperienceClientError(
    "malformed_fixture_response",
    "服务端响应无法验证，客户端不会推断写入成功或回滚。",
    true,
  );

const rejectedResponse = (
  status: number,
  snapshot: ExperienceSnapshot | null,
  detail: string,
): ExperienceClientError =>
  new ExperienceClientError(
    "fixture_request_rejected",
    `服务端未返回可接受的成功结果（HTTP ${String(status)}，${detail}）。`,
    status === 408 || status === 429 || status >= 500,
    snapshot,
    snapshot === null ? null : "response",
  );

const stageFromSnapshot = (snapshot: MvpCoreSnapshot): ExperienceStage => {
  if (snapshot.consent === "pending") {
    return "consent";
  }
  if (snapshot.consent === "discarded") {
    return "private";
  }
  if (snapshot.sharedRows === 0) {
    return "consent_recorded";
  }
  if (snapshot.handover.status === "accepted") {
    return "accepted";
  }
  if (snapshot.handover.status === "awaiting_confirmations") {
    if (snapshot.handover.fromConfirmed && snapshot.handover.toConfirmed) {
      return "acceptance_pending";
    }
    if (snapshot.handover.fromConfirmed) {
      return "source_confirmed";
    }
    if (snapshot.handover.toConfirmed) {
      return "recipient_confirmed";
    }
    return "awaiting_confirmations";
  }
  return snapshot.reportRows > 0 ? "blocked" : "report";
};

const STAGE_COPY = Object.freeze({
  consent: Object.freeze({
    title: "由本人决定是否分享",
    summary: "私聊默认只属于本人；同意与发布是两个独立步骤。",
  }),
  consent_recorded: Object.freeze({
    title: "分享同意已记录，等待发布",
    summary: "记录同意不会自动发布；本人仍需单独确认结构化结论。",
  }),
  private: Object.freeze({
    title: "这条消息继续仅本人可见",
    summary: "未产生共享写入，也不会进入责任报告。",
  }),
  report: Object.freeze({
    title: "结构化结论已发布",
    summary: "共享侧只看到同意后的结论，报告尚未生成。",
  }),
  blocked: Object.freeze({
    title: "交接被信息缺口阻断",
    summary: "缺少必要信息时，负责人和提醒都保持原归属。",
  }),
  awaiting_confirmations: Object.freeze({
    title: "信息已完整，等待双方确认",
    summary: "补齐信息不等于交接完成；两个确认缺一不可。",
  }),
  source_confirmed: Object.freeze({
    title: "提出方已确认，等待接手方",
    summary: "一个确认不会移动负责人或提醒。",
  }),
  recipient_confirmed: Object.freeze({
    title: "接手方已确认，等待提出方",
    summary: "一个确认不会移动负责人或提醒。",
  }),
  acceptance_pending: Object.freeze({
    title: "双方已确认，等待系统完成交接",
    summary: "双方确认已经记录；系统完成原子接受前，负责人和提醒仍保持原归属。",
  }),
  accepted: Object.freeze({
    title: "责任与提醒已经转移",
    summary: "双方确认后，责任域负责人和未来提醒一起转移。",
  }),
} as const satisfies Readonly<
  Record<ExperienceStage, Readonly<{ title: string; summary: string }>>
>);

const toExperienceSnapshot = (
  server: MvpCoreSnapshot,
  report: MvpCoreReport | null,
): ExperienceSnapshot => {
  const stage = stageFromSnapshot(server);
  const copy = STAGE_COPY[stage];
  return Object.freeze({
    server,
    stage,
    stageTitle: copy.title,
    stageSummary: copy.summary,
    report,
  });
};

export interface HttpExperienceClientOptions {
  readonly fetch?: typeof fetch;
}

const runtimeFetch: typeof fetch = (input, init) => globalThis.fetch(input, init);

class HttpExperienceClient implements ExperienceClient {
  private readonly fetcher: typeof fetch;
  private currentSnapshot: ExperienceSnapshot | null = null;
  private currentReport: MvpCoreReport | null = null;

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

  private remember(
    server: MvpCoreSnapshot,
    reportFromResult?: MvpCoreReport,
  ): ExperienceSnapshot {
    if (server.reportRows === 0) {
      this.currentReport = null;
    } else {
      this.currentReport =
        reportFromResult ?? this.currentReport ?? MVP_CORE_CANONICAL_REPORT;
    }

    const next = toExperienceSnapshot(server, this.currentReport);
    this.currentSnapshot = next;
    return next;
  }

  private async readState(): Promise<MvpCoreSnapshot> {
    const response = await this.request(MVP_CORE_PATHS.state, {
      method: "GET",
      headers: { accept: "application/json" },
      credentials: "same-origin",
      cache: "no-store",
    });
    if (response.status !== 200) {
      throw rejectedResponse(response.status, null, "state_read_rejected");
    }

    const decoded = decodeMvpCoreSnapshot(await this.readJson(response));
    if (decoded === undefined) {
      throw malformedResponse();
    }
    return decoded;
  }

  private async sendCommand(command: VisibleMvpCoreCommand): Promise<ExperienceSnapshot> {
    const response = await this.request(MVP_CORE_PATHS.commands, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      credentials: "same-origin",
      body: JSON.stringify({ command }),
    });
    let responseBody: unknown;
    try {
      responseBody = await this.readJson(response);
    } catch (reason: unknown) {
      if (response.status !== 200) {
        throw rejectedResponse(response.status, null, "unreadable_error_response");
      }
      throw reason;
    }

    const parsed = MvpCoreCommandResponseSchema.safeParse(responseBody);
    if (!parsed.success) {
      if (response.status !== 200) {
        throw rejectedResponse(response.status, null, "malformed_error_response");
      }
      throw malformedResponse();
    }

    const body = parsed.data;
    if (!body.ok) {
      const trustedSnapshot = this.remember(body.state);
      throw rejectedResponse(response.status, trustedSnapshot, body.code);
    }
    if (body.command !== command) {
      throw malformedResponse();
    }
    const trustedSnapshot = this.remember(
      body.state,
      body.result.report,
    );
    if (response.status !== 200) {
      throw rejectedResponse(
        response.status,
        trustedSnapshot,
        "unexpected_http_status",
      );
    }

    return trustedSnapshot;
  }

  private async reset(): Promise<ExperienceSnapshot> {
    const response = await this.request(MVP_CORE_PATHS.reset, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      credentials: "same-origin",
      body: JSON.stringify({}),
    });
    if (response.status !== 204) {
      throw rejectedResponse(response.status, null, "reset_rejected");
    }
    return this.load();
  }

  private async reconcile(error: ExperienceClientError): Promise<ExperienceClientError> {
    if (error.snapshot !== null) {
      return error;
    }

    try {
      const latest = this.remember(await this.readState());
      return error.withTruth(latest, "reload");
    } catch {
      return error.withTruth(this.currentSnapshot, "retained");
    }
  }

  async load(): Promise<ExperienceSnapshot> {
    return this.remember(await this.readState());
  }

  async perform(actionId: ExperienceActionId): Promise<ExperienceSnapshot> {
    try {
      if (actionId === "reset_fixture") {
        return await this.reset();
      }

      const command = VisibleMvpCoreCommandSchema.safeParse(actionId);
      if (!command.success) {
        throw new ExperienceClientError(
          "unexpected_fixture_action",
          "当前 Fixture 不支持这个操作。",
          false,
        );
      }
      return await this.sendCommand(command.data);
    } catch (reason: unknown) {
      const error =
        reason instanceof ExperienceClientError ? reason : connectionInterrupted();
      throw await this.reconcile(error);
    }
  }
}

export const createHttpExperienceClient = (
  options: HttpExperienceClientOptions = {},
): ExperienceClient => new HttpExperienceClient(options);
