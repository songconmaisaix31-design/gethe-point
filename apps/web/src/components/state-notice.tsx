import { UI_STATE_VOCABULARY, type UIState } from "../features/experience/contracts";

interface StateNoticeProps {
  readonly state: UIState;
  readonly detail?: string | undefined;
  readonly onRetry?: (() => void) | undefined;
}

const stateTone = (state: UIState): string => {
  switch (state) {
    case "success":
      return "success";
    case "blocked":
    case "needs_human_review":
    case "evidence_missing":
    case "unresolved":
      return "blocked";
    case "error":
    case "denied":
      return "error";
    case "loading":
    case "empty":
    case "retry":
      return "info";
  }
};

export function StateNotice({ state, detail, onRetry }: StateNoticeProps) {
  const vocabulary = UI_STATE_VOCABULARY[state];

  return (
    <section
      className={`state-notice state-notice--${stateTone(state)}`}
      aria-live={state === "loading" ? "polite" : "assertive"}
      data-ui-state={state}
    >
      <span className="state-notice__icon" aria-hidden="true">
        {state === "success" ? "✓" : state === "error" || state === "denied" ? "!" : "i"}
      </span>
      <div>
        <h2>{vocabulary.heading}</h2>
        <p>{detail ?? vocabulary.detail}</p>
        {(state === "error" || state === "retry") && onRetry !== undefined ? (
          <button className="button button--secondary" type="button" onClick={onRetry}>
            {UI_STATE_VOCABULARY.retry.heading}
          </button>
        ) : null}
      </div>
    </section>
  );
}
