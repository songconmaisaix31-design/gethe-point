import type {
  NotificationAdapter,
  NotificationAdapterRequest,
  NotificationAdapterResult,
} from "../contracts.ts";

const MAX_A3_TEXT_BYTES = 1_024;
const DEFAULT_TIMEOUT_MS = 3_000;

export const appNotificationAdapter: NotificationAdapter = {
  channel: "app",
  async send(): Promise<NotificationAdapterResult> {
    return { status: "shown_in_app", safeCode: null };
  },
};

interface A3AdapterOptions {
  readonly enabled?: boolean;
  readonly endpoint?: string;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

function isAcceptedResponse(value: unknown): boolean {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  return Reflect.get(value, "accepted") === true;
}

async function readBoundedJson(response: Response): Promise<unknown> {
  if (!response.body) {
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
    if (byteLength > 1_024) {
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
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    return undefined;
  }
}

export function createA3NotificationAdapter(
  options: A3AdapterOptions = {},
): NotificationAdapter {
  const enabled = options.enabled ?? process.env.ENABLE_ROBOT === "true";
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    channel: "robot_a3",
    async send(
      request: NotificationAdapterRequest,
    ): Promise<NotificationAdapterResult> {
      if (!enabled) {
        return { status: "disabled", safeCode: "disabled" };
      }

      if (!options.endpoint) {
        return { status: "failed", safeCode: "provider_unavailable" };
      }

      if (Buffer.byteLength(request.text, "utf8") > MAX_A3_TEXT_BYTES) {
        return { status: "failed", safeCode: "invalid_request" };
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetchImpl(options.endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            eventId: request.logicalEventId,
            text: request.text,
            priority: request.priority,
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          return { status: "failed", safeCode: "provider_unavailable" };
        }

        const contentLength = Number(response.headers.get("content-length"));
        if (Number.isFinite(contentLength) && contentLength > 1_024) {
          return { status: "failed", safeCode: "provider_unavailable" };
        }

        const body = await readBoundedJson(response);
        return isAcceptedResponse(body)
          ? { status: "sent_to_provider", safeCode: null }
          : { status: "failed", safeCode: "provider_unavailable" };
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          return { status: "failed", safeCode: "timeout" };
        }
        return { status: "failed", safeCode: "provider_unavailable" };
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
