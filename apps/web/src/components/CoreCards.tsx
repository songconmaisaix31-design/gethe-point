import {
  MVP_CORE_DISPLAY,
  MVP_CORE_TEST_IDS,
} from "../features/experience/fixture-display";
import type {
  ExperienceActionId,
  ExperienceSnapshot,
} from "../features/experience/model";
import type { VisibleMvpCoreCommand } from "../features/experience/wire-contract";

const STAGE_LABELS = Object.freeze({
  discoveredBy: "发现问题",
  deadlineKeptBy: "记住截止",
  scheduledBy: "制定安排",
  executedBy: "实际执行",
  followedUpBy: "跟进结果",
});

const ownerName = (memberId: string): string => {
  if (memberId === MVP_CORE_DISPLAY.memberIds.primary) {
    return MVP_CORE_DISPLAY.memberNames.primary;
  }
  if (memberId === MVP_CORE_DISPLAY.memberIds.partner) {
    return MVP_CORE_DISPLAY.memberNames.partner;
  }
  if (memberId === MVP_CORE_DISPLAY.memberIds.subject) {
    return MVP_CORE_DISPLAY.memberNames.subject;
  }
  return "未知成员";
};

interface CommandButtonProps {
  readonly command: VisibleMvpCoreCommand;
  readonly label: string;
  readonly testId: string;
  readonly tone?: "primary" | "secondary";
  readonly disabled: boolean;
  readonly pendingActionId: ExperienceActionId | null;
  readonly onAction: (actionId: ExperienceActionId) => void;
}

const CommandButton = ({
  command,
  label,
  testId,
  tone = "primary",
  disabled,
  pendingActionId,
  onAction,
}: CommandButtonProps) => (
  <button
    type="button"
    className={`action-button ${tone === "primary" ? "primary-action" : "secondary-action"}`}
    data-testid={testId}
    disabled={disabled || pendingActionId !== null}
    onClick={() => {
      onAction(command);
    }}
  >
    {pendingActionId === command ? "正在提交，不会重复操作…" : label}
  </button>
);

interface CoreCardProps {
  readonly snapshot: ExperienceSnapshot;
  readonly pendingActionId: ExperienceActionId | null;
  readonly commandsDisabled: boolean;
  readonly onAction: (actionId: ExperienceActionId) => void;
}

export const ConsentCard = ({
  snapshot,
  pendingActionId,
  commandsDisabled,
  onAction,
}: CoreCardProps) => {
  const state = snapshot.server;
  const canDecide = state.consent === "pending";
  const canPublish = state.consent === "shared" && state.sharedRows === 0;
  const ids = MVP_CORE_TEST_IDS.cards.consent;

  return (
    <section className="content-card core-card consent-card" data-testid={ids.root}>
      <header className="card-zone card-title-zone" data-testid={ids.title}>
        <div>
          <p className="eyebrow">本人私聊 · 默认仅自己</p>
          <h3>要不要让家里人知道？</h3>
        </div>
        <span className="paper-tag">consent: {state.consent}</span>
      </header>

      <div className="card-zone card-body-zone subject-copy" data-testid={ids.content}>
        <blockquote data-testid={MVP_CORE_TEST_IDS.privateMessage}>
          {MVP_CORE_DISPLAY.privateMessage}
        </blockquote>
        <p>只会发布经过同意的结构化结论，不会把私聊原文发给家庭共享侧。</p>
        {state.sharedRows > 0 ? (
          <p className="shared-conclusion" data-testid={MVP_CORE_TEST_IDS.sharedSignal}>
            {MVP_CORE_DISPLAY.sharedConclusion}
          </p>
        ) : null}
      </div>

      <div className="card-zone state-zone" data-testid={ids.state}>
        <strong>{snapshot.stageTitle}</strong>
        <p>{snapshot.stageSummary}</p>
      </div>

      <footer className="card-zone card-actions-zone consent-actions" data-testid={ids.actions}>
        <CommandButton
          command="record_share_consent"
          label="告诉家里人"
          testId={MVP_CORE_TEST_IDS.shareConsent}
          disabled={commandsDisabled || !canDecide}
          pendingActionId={pendingActionId}
          onAction={onAction}
        />
        <CommandButton
          command="record_no_consent"
          label="先别说"
          testId={MVP_CORE_TEST_IDS.noConsent}
          tone="secondary"
          disabled={commandsDisabled || !canDecide}
          pendingActionId={pendingActionId}
          onAction={onAction}
        />
        <div className="future-action">
          <button type="button" className="action-button secondary-action" disabled>
            只告诉指定成员
          </button>
          <small>当前 QA 命令未开放指定成员写入</small>
        </div>
        <CommandButton
          command="publish_consented_signal"
          label="发布已同意结论"
          testId={MVP_CORE_TEST_IDS.publishSignal}
          disabled={commandsDisabled || !canPublish}
          pendingActionId={pendingActionId}
          onAction={onAction}
        />
      </footer>
    </section>
  );
};

export const ReportCard = ({
  snapshot,
  pendingActionId,
  commandsDisabled,
  onAction,
}: CoreCardProps) => {
  const report = snapshot.report;
  const ids = MVP_CORE_TEST_IDS.cards.report;
  const canGenerate = snapshot.server.sharedRows > 0 && snapshot.server.reportRows === 0;

  return (
    <section className="content-card core-card report-card" data-testid={ids.root}>
      <header className="card-zone card-title-zone" data-testid={ids.title}>
        <div>
          <p className="eyebrow">确定性模板 · 中性统计</p>
          <h3>五阶段责任报告</h3>
        </div>
        <span className="paper-tag">{report === null ? "未生成" : "已生成"}</span>
      </header>

      <div className="card-zone card-body-zone" data-testid={ids.content}>
        {report === null ? (
          <p data-testid={MVP_CORE_TEST_IDS.report}>共享结论发布后，才可生成责任报告。</p>
        ) : (
          <div data-testid={MVP_CORE_TEST_IDS.report}>
            <div className="report-table" role="table" aria-label="五阶段责任报告">
              {report.rows.map((row) => (
                <div className="report-row" role="row" key={row.stage}>
                  <span role="cell">{STAGE_LABELS[row.stage]}</span>
                  <strong role="cell">
                    {row.counts.map((count) => `${ownerName(count.memberId)} ${String(count.count)}`).join(" · ")}
                  </strong>
                </div>
              ))}
            </div>
            <p className="neutral-copy">{report.narrative}</p>
          </div>
        )}
      </div>

      <div className="card-zone state-zone" data-testid={ids.state}>
        <strong>reportRows: {String(snapshot.server.reportRows)}</strong>
        <p>不评分、不排名、不诊断，也不判断家庭成员对错。</p>
      </div>

      <footer className="card-zone card-actions-zone" data-testid={ids.actions}>
        <CommandButton
          command="generate_report"
          label="生成责任报告"
          testId={MVP_CORE_TEST_IDS.generateReport}
          disabled={commandsDisabled || !canGenerate}
          pendingActionId={pendingActionId}
          onAction={onAction}
        />
      </footer>
    </section>
  );
};

export const ResponsibilityCard = ({ snapshot }: Pick<CoreCardProps, "snapshot">) => {
  const ids = MVP_CORE_TEST_IDS.cards.responsibility;
  const owners = snapshot.server.responsibilityOwners;

  return (
    <section className="content-card core-card responsibility-card" data-testid={ids.root}>
      <header className="card-zone card-title-zone" data-testid={ids.title}>
        <div>
          <p className="eyebrow">完整责任所有权</p>
          <h3>{MVP_CORE_DISPLAY.domain.name}</h3>
        </div>
        <span className="paper-tag">五个一等字段</span>
      </header>

      <div className="card-zone card-body-zone" data-testid={ids.content}>
        <p className="domain-task">当前任务：{MVP_CORE_DISPLAY.domain.taskTitle}</p>
        <dl className="owner-grid">
          {Object.entries(owners).map(([field, memberId]) => (
            <div key={field}>
              <dt>{STAGE_LABELS[field as keyof typeof STAGE_LABELS]}</dt>
              <dd>{ownerName(memberId)}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="card-zone state-zone" data-testid={ids.state}>
        <strong>责任字段保持原始归属</strong>
        <p>交接只移动责任域和未来提醒，不重写历史阶段事实。</p>
      </div>

      <footer className="card-zone card-actions-zone" data-testid={ids.actions}>
        <button type="button" className="action-button secondary-action" disabled>
          历史归属只读
        </button>
      </footer>
    </section>
  );
};

export const HandoverCard = ({
  snapshot,
  pendingActionId,
  commandsDisabled,
  onAction,
}: CoreCardProps) => {
  const ids = MVP_CORE_TEST_IDS.cards.handover;
  const handover = snapshot.server.handover;
  const isAwaiting = handover.status === "awaiting_confirmations";

  return (
    <section className="content-card core-card handover-card" data-testid={ids.root}>
      <header className="card-zone card-title-zone" data-testid={ids.title}>
        <div>
          <p className="eyebrow">责任域交接</p>
          <h3>{MVP_CORE_DISPLAY.domain.name}</h3>
        </div>
        <span className={`state-badge state-${handover.status}`}>{handover.status}</span>
      </header>

      <div className="card-zone card-body-zone" data-testid={ids.content}>
        <div className="handover-fact">
          <span>责任边界</span>
          <p>{MVP_CORE_DISPLAY.domain.scope}</p>
        </div>
        <div className="handover-fact">
          <span>接手后第一步</span>
          <p>{MVP_CORE_DISPLAY.domain.nextAction}</p>
        </div>
        {handover.status === "blocked" ? (
          <div className="missing-zone">
            <strong>缺少：{MVP_CORE_DISPLAY.handover.missingLabel}</strong>
            <p>{MVP_CORE_DISPLAY.handover.missingReason}</p>
          </div>
        ) : null}
      </div>

      <div className={`card-zone state-zone state-zone-${handover.status}`} data-testid={ids.state}>
        <strong data-testid={MVP_CORE_TEST_IDS.handoverStatus}>{handover.status}</strong>
        <div className="confirmation-grid" aria-label="双方确认状态">
          <p>
            {MVP_CORE_DISPLAY.memberNames.primary} · 提出方
            <b data-testid={MVP_CORE_TEST_IDS.fromConfirmation}>
              {handover.fromConfirmed ? "confirmed" : "pending"}
            </b>
          </p>
          <p>
            {MVP_CORE_DISPLAY.memberNames.partner} · 接手方
            <b data-testid={MVP_CORE_TEST_IDS.toConfirmation}>
              {handover.toConfirmed ? "confirmed" : "pending"}
            </b>
          </p>
        </div>
        <div className="ownership-zone">
          <strong data-testid={MVP_CORE_TEST_IDS.domainOwner}>
            当前负责人：{ownerName(snapshot.server.domainOwnerId)}
          </strong>
          <p data-testid={MVP_CORE_TEST_IDS.reminderOwner}>
            {MVP_CORE_DISPLAY.reminder.label} · {ownerName(snapshot.server.reminderOwnerId)}
          </p>
        </div>
      </div>

      <footer className="card-zone card-actions-zone" data-testid={ids.actions}>
        <CommandButton
          command="supply_handover_info"
          label="补齐上次检查结果"
          testId={MVP_CORE_TEST_IDS.supplyHandoverInfo}
          disabled={commandsDisabled || handover.status !== "blocked"}
          pendingActionId={pendingActionId}
          onAction={onAction}
        />
        <CommandButton
          command="confirm_handover_from"
          label="提出方确认完整移交"
          testId={MVP_CORE_TEST_IDS.confirmFrom}
          tone="secondary"
          disabled={commandsDisabled || !isAwaiting || handover.fromConfirmed}
          pendingActionId={pendingActionId}
          onAction={onAction}
        />
      </footer>
    </section>
  );
};

export const PartnerConfirmationPanel = ({
  snapshot,
  pendingActionId,
  commandsDisabled,
  onAction,
}: CoreCardProps) => {
  const handover = snapshot.server.handover;
  const canConfirm =
    handover.status === "awaiting_confirmations" && !handover.toConfirmed;

  return (
    <section className="partner-confirmation-panel" aria-label="接手方确认">
      <p className="eyebrow">独立确认</p>
      <h3>{MVP_CORE_DISPLAY.memberNames.partner}</h3>
      <p>
        当前交接状态：<strong>{handover.status}</strong>
      </p>
      <p>提出方：{handover.fromConfirmed ? "confirmed" : "pending"}</p>
      <p>接手方：{handover.toConfirmed ? "confirmed" : "pending"}</p>
      <CommandButton
        command="confirm_handover_to"
        label="接手方确认接收"
        testId={MVP_CORE_TEST_IDS.confirmTo}
        disabled={commandsDisabled || !canConfirm}
        pendingActionId={pendingActionId}
        onAction={onAction}
      />
    </section>
  );
};
