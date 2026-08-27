import type { MemberRole, ResponsibilityReport } from "../features/experience/model";

export interface ResponsibilityReportCardProps {
  readonly report: ResponsibilityReport;
  readonly role: MemberRole;
}

export const ResponsibilityReportCard = ({ report, role }: ResponsibilityReportCardProps) => {
  const roleSummary =
    role === "partner"
      ? `当前负责 ${String(report.partnerOwnedDomains)} 个完整责任域`
      : `“只有你在记得”共 ${String(report.primaryRememberedItems)} 项`;

  return (
    <section className="content-card report-card">
      <header className="card-title-zone">
        <div>
          <p className="eyebrow">责任报告 · {report.period}</p>
          <h3>五阶段责任分布</h3>
        </div>
        <span className="paper-tag">中性统计</span>
      </header>

      <div className="card-body-zone">
        <p className="report-role-summary">{roleSummary}</p>
        <div className="report-table" role="table" aria-label="五阶段责任分布">
          <div className="report-row report-head" role="row">
            <span role="columnheader">工作阶段</span>
            <span role="columnheader">家人甲</span>
            <span role="columnheader">家人乙</span>
          </div>
          {report.rows.map((row) => (
            <div className="report-row" role="row" key={row.field}>
              <span role="cell">{row.label}</span>
              <strong role="cell">{row.primaryCount}</strong>
              <strong role="cell">{row.partnerCount}</strong>
            </div>
          ))}
        </div>
        <p className="neutral-copy">{report.narrative}</p>
      </div>

      <footer className="evidence-zone">
        <span>依据</span>
        <p>{report.evidence}</p>
      </footer>
    </section>
  );
};
