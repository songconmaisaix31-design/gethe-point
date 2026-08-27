import { FIXTURE_TRUTH_LABELS } from "../features/experience/contracts";

export function TruthBanner() {
  return (
    <aside className="truth-banner" aria-label="演示数据说明" data-testid="fixture-truth">
      <strong>{FIXTURE_TRUTH_LABELS.data}</strong>
      <span>{FIXTURE_TRUTH_LABELS.account}</span>
      <span>{FIXTURE_TRUTH_LABELS.authentication}</span>
    </aside>
  );
}
