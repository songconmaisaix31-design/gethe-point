import { MVP_CORE_DISPLAY, MVP_CORE_TEST_IDS } from "../features/experience/fixture-display";

export interface TruthLabelsProps {
  readonly writeCount: number | null;
  readonly sharedRowCount: number | null;
}

export const TruthLabels = ({ writeCount, sharedRowCount }: TruthLabelsProps) => (
  <aside className="truth-boundary" role="note" aria-label="Fixture truth boundary">
    <div className="truth-badges">
      {MVP_CORE_DISPLAY.truthBadges.map((label) => (
        <span key={label}>{label}</span>
      ))}
    </div>
    <p className="fictional-notice" data-testid={MVP_CORE_TEST_IDS.fictionalNotice}>
      {MVP_CORE_DISPLAY.fictionalNotice}
    </p>
    <p className="contract-truth-labels">
      <span>{MVP_CORE_DISPLAY.contractTruthLabels.data}</span>
      <span>{MVP_CORE_DISPLAY.contractTruthLabels.account}</span>
      <span>{MVP_CORE_DISPLAY.contractTruthLabels.authentication}</span>
    </p>
    <dl className="truth-counters" aria-label="服务端写入计数">
      <div>
        <dt>Writes</dt>
        <dd data-testid={MVP_CORE_TEST_IDS.writeCount}>
          {writeCount === null ? "—" : String(writeCount)}
        </dd>
      </div>
      <div>
        <dt>Shared rows</dt>
        <dd data-testid={MVP_CORE_TEST_IDS.sharedRowCount}>
          {sharedRowCount === null ? "—" : String(sharedRowCount)}
        </dd>
      </div>
    </dl>
  </aside>
);
