import type {
  LLMProvider,
  LLMProviderRequest,
  LLMProviderResult,
} from "../../../packages/contracts/src/index";
import type { ProviderSignalDraftFields } from "./signal-draft";

const DISCUSSION_ONLY_PATTERN =
  /(?:只是讨论|只是聊聊|不用安排|不需要(?:安排|处理)|discussion only|just discussing|no action)/iu;

const completed = (
  output: ProviderSignalDraftFields,
  inputLength: number,
): LLMProviderResult => ({
  status: "completed",
  completion: {
    latencyMs: 0,
    output,
    usage: {
      inputTokens: Math.ceil(inputLength / 4),
      outputTokens: Math.ceil(JSON.stringify(output).length / 4),
    },
  },
});

export const createFixtureSignalDraftProvider = (): LLMProvider => {
  const provider: LLMProvider = {
    complete: (
      request: Readonly<LLMProviderRequest>,
    ): Promise<LLMProviderResult> => {
      const discussionOnly = DISCUSSION_ONLY_PATTERN.test(request.redactedInput);
      const output: ProviderSignalDraftFields = discussionOnly
        ? {
            confidence: 0.95,
            intent: "discussion_only",
            missingInfoCodes: [],
          }
        : {
            confidence: 0.9,
            intent: "coordinate_schedule",
            missingInfoCodes: ["responsible_member", "target_time"],
          };

      return Promise.resolve(completed(output, request.redactedInput.length));
    },
  };

  return Object.freeze(provider);
};
