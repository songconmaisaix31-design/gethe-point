import {
  HIGH_RISK_SPEAKER_GUIDANCE,
} from "../../boundary/src/index";
import type {
  LLMProvider,
  LLMProviderRequest,
  LLMProviderResult,
} from "../../../packages/contracts/src/index";
import type { SignalDraftCandidate } from "./signal-draft";

const DISCUSSION_ONLY_PATTERN =
  /(?:只是讨论|只是聊聊|不用安排|不需要(?:安排|处理)|discussion only|just discussing|no action)/iu;

const completed = (
  output: SignalDraftCandidate,
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
      const output: SignalDraftCandidate = discussionOnly
        ? {
            candidateDomainId: null,
            confidence: 0.95,
            kind: "discussion_only",
            missingInfo: [],
            proposedConclusion: "这是一条仅供家庭讨论的信息，不需要创建任务。",
            redactedExcerpt: "发言人希望保留为讨论信息。",
          }
        : {
            candidateDomainId: null,
            confidence: 0.9,
            kind: "potential_task",
            missingInfo: ["确认负责人和时间"],
            proposedConclusion: "需要由家人确认后续安排。",
            redactedExcerpt: "发言人希望家人确认后续安排。",
          };

      return Promise.resolve(completed(output, request.redactedInput.length));
    },
  };

  return Object.freeze(provider);
};

export const createHighRiskSignalDraftCandidate = (): SignalDraftCandidate =>
  Object.freeze({
    candidateDomainId: null,
    confidence: 1,
    kind: "high_risk",
    missingInfo: [],
    proposedConclusion: HIGH_RISK_SPEAKER_GUIDANCE,
    redactedExcerpt: "发言人希望获得及时的现实支持。",
  });
