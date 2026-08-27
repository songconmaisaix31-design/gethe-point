import type { HandoverView, MemberRole } from "../features/experience/model";

export interface HandoverCardProps {
  readonly handover: HandoverView;
  readonly role: MemberRole;
}

export const HandoverCard = ({ handover, role }: HandoverCardProps) => (
  <section className="content-card handover-card" data-viewer-role={role}>
    <header className="card-title-zone">
      <div>
        <p className="eyebrow">交接包 · {handover.id}</p>
        <h3>{handover.domainTitle}</h3>
      </div>
      <span className={`state-badge state-${handover.state}`}>{handover.stateLabel}</span>
    </header>

    <div className="card-body-zone">
      <div className="handover-section">
        <span>责任边界</span>
        <p>{handover.scope}</p>
      </div>
      <div className="handover-section">
        <span>接手后第一步</span>
        <p>{handover.nextStep}</p>
      </div>
    </div>

    <div className={`state-zone state-zone-${handover.state}`}>
      <strong>{handover.stateLabel}</strong>
      <p>{handover.stateDetail}</p>
    </div>

    {handover.missingInformation.length > 0 ? (
      <div className="missing-zone">
        <span>必须补齐</span>
        {handover.missingInformation.map((item) => (
          <strong key={item}>缺少：{item}</strong>
        ))}
      </div>
    ) : (
      <div className="confirmation-zone" aria-label="双方确认状态">
        <span className="zone-label">双方确认</span>
        {handover.confirmations.map((confirmation) => (
          <div className="confirmation-row" key={confirmation.role}>
            <span>{confirmation.partyLabel}</span>
            <strong>
              {confirmation.state === "confirmed"
                ? `已确认 · ${confirmation.confirmedAt ?? "已记录"}`
                : "等待本人确认"}
            </strong>
          </div>
        ))}
      </div>
    )}

    <div className={handover.state === "accepted" ? "release-zone" : "ownership-zone"}>
      <strong>{handover.ownerLabel}</strong>
      <p>{handover.reminderLabel}</p>
    </div>

    <footer className="evidence-zone">
      <span>证据边界</span>
      <p>{handover.evidence}</p>
    </footer>
  </section>
);
