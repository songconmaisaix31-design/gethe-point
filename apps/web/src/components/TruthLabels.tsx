const FIXTURE_TRUTH_LABELS = Object.freeze({
  data: "演示数据 Fixture",
  account: "用于演示流程，不是账号实况",
  authentication: "演示角色切换，不是生产身份认证",
});

export const TruthLabels = () => (
  <div className="truth-boundary" role="note" aria-label="Fixture truth boundary">
    <div className="truth-badges" aria-hidden="true">
      <span>Fixture</span>
      <span>Local Demo</span>
      <span>Not Production Acceptance</span>
    </div>
    <p>
      <span>{FIXTURE_TRUTH_LABELS.data}</span>
      <span>{FIXTURE_TRUTH_LABELS.account}</span>
      <span>{FIXTURE_TRUTH_LABELS.authentication}</span>
    </p>
  </div>
);
