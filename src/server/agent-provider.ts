import type { AgentIntent, TimetableCategory, TimetableStatus } from "../contracts.ts";

const STEPFUN_ENDPOINT = "https://api.stepfun.com/v1/chat/completions";
const DEFAULT_MODEL = "step-2-mini";
const DEFAULT_TIMEOUT_MS = 3_000;
const MAX_REQUEST_BYTES = 8_192;
const MAX_RESPONSE_BYTES = 16_384;
const MAX_PROVIDER_TEXT_CHARS = 500;
const MAX_PROVIDER_TEXT_BYTES = 2_048;

export interface AgentProviderTimetableItem {
  readonly title: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly category: TimetableCategory;
  readonly status: TimetableStatus;
}

export interface AgentProviderRequest {
  readonly targetDisplayName: string;
  readonly intent: AgentIntent;
  readonly deterministicAnswer: string;
  readonly visibleTimetable: readonly AgentProviderTimetableItem[];
  readonly visibleResponsibilityCount: number;
  readonly visibleCareRuleCount: number;
}

export interface AgentTextProvider {
  rewrite(request: AgentProviderRequest): Promise<unknown>;
}

interface StepFunProviderOptions {
  readonly apiKey?: string;
  readonly model?: string;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateProviderText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const text = value.trim();
  if (
    text.length === 0 ||
    text.length > MAX_PROVIDER_TEXT_CHARS ||
    Buffer.byteLength(text, "utf8") > MAX_PROVIDER_TEXT_BYTES
  ) {
    return null;
  }
  return text;
}

function extractProviderText(value: unknown): string | null {
  if (!isRecord(value)) {
    return null;
  }
  const choices = value.choices;
  if (!Array.isArray(choices) || choices.length !== 1 || !isRecord(choices[0])) {
    return null;
  }
  const message = choices[0].message;
  if (!isRecord(message)) {
    return null;
  }
  return validateProviderText(message.content);
}

async function readBoundedJson(response: Response): Promise<unknown> {
  if (!response.body) {
    return undefined;
  }

  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    return undefined;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  while (true) {
    const item = await reader.read();
    if (item.done) {
      break;
    }
    byteLength += item.value.byteLength;
    if (byteLength > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(item.value);
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    ) as unknown;
  } catch {
    return undefined;
  }
}

function resolveModel(model: string | undefined): string | null {
  const candidate = model ?? DEFAULT_MODEL;
  return /^[A-Za-z0-9._-]{1,80}$/.test(candidate) ? candidate : null;
}

export function createStepFunAgentProvider(
  options: StepFunProviderOptions,
): AgentTextProvider {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    async rewrite(request: AgentProviderRequest): Promise<unknown> {
      const apiKey = options.apiKey?.trim();
      const model = resolveModel(options.model);
      if (!apiKey || !model || timeoutMs <= 0) {
        return null;
      }

      const requestBody = JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content:
              "Rewrite the deterministic answer in concise Chinese using only the supplied facts. Do not diagnose, blame anyone, invent facts, add identifiers, add actions, make authorization decisions, or include private details.",
          },
          {
            role: "user",
            content: JSON.stringify({
              targetDisplayName: request.targetDisplayName,
              intent: request.intent,
              deterministicAnswer: request.deterministicAnswer,
              visibleTimetable: request.visibleTimetable.map((item) => ({
                title: item.title,
                startsAt: item.startsAt,
                endsAt: item.endsAt,
                category: item.category,
                status: item.status,
              })),
              visibleResponsibilityCount: request.visibleResponsibilityCount,
              visibleCareRuleCount: request.visibleCareRuleCount,
            }),
          },
        ],
        max_tokens: 180,
        temperature: 0.2,
        stream: false,
      });
      if (Buffer.byteLength(requestBody, "utf8") > MAX_REQUEST_BYTES) {
        return null;
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(STEPFUN_ENDPOINT, {
          method: "POST",
          headers: {
            authorization: `Bearer ${apiKey}`,
            "content-type": "application/json",
          },
          body: requestBody,
          signal: controller.signal,
        });
        if (!response.ok) {
          return null;
        }
        return extractProviderText(await readBoundedJson(response));
      } catch {
        return null;
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
