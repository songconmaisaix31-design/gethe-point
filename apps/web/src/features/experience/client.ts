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
  | "stale_fixture_revision"
  | "unexpected_fixture_action";

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

export const createLocalFixtureClient = (
  options: LocalFixtureClientOptions = {},
): ExperienceClient => new LocalFixtureExperienceClient(options);
