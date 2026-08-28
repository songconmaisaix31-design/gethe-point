"use client";

import Image from "next/image";
import { useCallback, useEffect, useState } from "react";

import type {
  CareEventProjection,
  DemoAction,
  HandoverProjection,
  MemberProjection,
  ResponsibilityTaskProjection,
  Role,
  RoleSafeProjection,
  Visibility,
} from "../contracts";
import { DemoApiError, getDemoState, postDemoAction, resetDemo } from "./demo-api";

const ROLE_LABELS: Readonly<Record<Role, { title: string; detail: string }>> = {
  primary: { title: "妈妈", detail: "主责任人" },
  partner: { title: "爸爸", detail: "共同生活成员" },
  subject: { title: "奶奶", detail: "被看护人" },
};

const STAGES: ReadonlyArray<{
  key: keyof Pick<
    ResponsibilityTaskProjection,
    "discoveredBy" | "deadlineKeptBy" | "scheduledBy" | "executedBy" | "followedUpBy"
  >;
  label: string;
}> = [
  { key: "discoveredBy", label: "发现问题" },
  { key: "deadlineKeptBy", label: "记住截止" },
  { key: "scheduledBy", label: "制定安排" },
  { key: "executedBy", label: "实际执行" },
  { key: "followedUpBy", label: "跟进结果" },
];

const STATUS_LABELS = {
  queued: "已排队",
  deduplicated: "已去重",
  shown_in_app: "已在 App 显示",
  disabled: "未启用",
  sent_to_provider: "服务方已接收",
  failed: "发送失败",
} as const;

function currentMember(state: RoleSafeProjection): MemberProjection | undefined {
  return state.members.find((member) => member.role === state.role);
}

function memberName(state: RoleSafeProjection, id: string | null): string {
  if (id === null) return "未明确";
  return state.members.find((member) => member.id === id)?.displayName ?? "家庭成员";
}

function visibilityLabel(visibility: Visibility): string {
  if (typeof visibility === "object") return "仅指定家人";
  return { self: "只留给自己", space: "家庭空间", care_related: "仅照护相关成员" }[visibility];
}

function latestCareEvent(events: readonly CareEventProjection[]): CareEventProjection | undefined {
  return events.at(-1);
}

export function DemoApp() {
  const [role, setRole] = useState<Role>("primary");
  const [state, setState] = useState<RoleSafeProjection | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async (nextRole: Role) => {
    setLoading(true);
    setError(null);
    try {
      setState(await getDemoState(nextRole));
    } catch (caught: unknown) {
      setError(caught instanceof DemoApiError ? caught.message : "演示状态加载失败。请稍后重试。");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    void getDemoState(role)
      .then((nextState) => {
        if (!cancelled) setState(nextState);
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setError(caught instanceof DemoApiError ? caught.message : "演示状态加载失败。请稍后重试。");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [role]);

  const act = useCallback(
    async (label: string, action: DemoAction) => {
      setPendingAction(action.type);
      setError(null);
      setNotice(null);
      try {
        const nextState = await postDemoAction(role, action);
        setState(nextState);
        setNotice(label);
      } catch (caught: unknown) {
        const detail = caught instanceof DemoApiError ? caught.message : "操作没有完成。";
        setError(`${label}失败：${detail}`);
      } finally {
        setPendingAction(null);
      }
    },
    [role],
  );

  const handleReset = useCallback(async () => {
    setPendingAction("reset");
    setError(null);
    setNotice(null);
    try {
      setState(await resetDemo(role));
      setNotice("Fixture 已恢复到初始状态。");
    } catch (caught: unknown) {
      setError(caught instanceof DemoApiError ? caught.message : "重置失败。");
    } finally {
      setPendingAction(null);
    }
  }, [role]);

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#main-content" aria-label="都记得首页">
          {/* The repository SVG is the approved product mark. */}
          <Image src="/dujide-logo-roof-ink.svg" alt="" width="54" height="40" priority />
          <span>
            都记得
            <small>We Remember</small>
          </span>
        </a>
        <div className="truth-label" data-testid="truth-label">
          <strong>Fixture · Demo Only</strong>
          <span>本地演示，不是生产身份认证或真实设备送达证明</span>
        </div>
        <button className="quiet-button" type="button" onClick={handleReset} disabled={pendingAction !== null}>
          重置演示
        </button>
      </header>

      <nav className="role-switch" data-testid="role-switch" aria-label="切换演示角色">
        {(Object.keys(ROLE_LABELS) as Role[]).map((item) => (
          <button
            key={item}
            type="button"
            aria-pressed={role === item}
            onClick={() => {
              if (role === item) return;
              setLoading(true);
              setError(null);
              setRole(item);
            }}
          >
            <span>{ROLE_LABELS[item].title}</span>
            <small>{ROLE_LABELS[item].detail}</small>
          </button>
        ))}
      </nav>

      <section id="main-content" className="content" aria-busy={loading || pendingAction !== null}>
        <div className="page-intro">
          <p className="eyebrow">林家 · 三位成员</p>
          <h1>{ROLE_LABELS[role].title}的这一面</h1>
          <p>每个角色只看到与自己相关的 Fixture 投影。私聊内容不会因为切换角色而自动共享。</p>
        </div>

        {notice ? <p className="status-message success" role="status">{notice}</p> : null}
        {error ? (
          <div className="status-message error" role="alert">
            <span>{error}</span>
            <button type="button" onClick={() => void load(role)}>重新加载</button>
          </div>
        ) : null}
        {loading ? <LoadingState /> : null}
        {!loading && state ? (
          <RoleSurface state={state} pendingAction={pendingAction} act={act} />
        ) : null}
      </section>
    </main>
  );
}

function LoadingState() {
  return (
    <div className="loading-card" role="status">
      <span className="loading-mark" aria-hidden="true" />
      正在读取这一角色可见的演示数据…
    </div>
  );
}

function RoleSurface({
  state,
  pendingAction,
  act,
}: {
  readonly state: RoleSafeProjection;
  readonly pendingAction: string | null;
  readonly act: (label: string, action: DemoAction) => Promise<void>;
}) {
  const member = currentMember(state);
  const disabled = pendingAction !== null;

  if (!member) {
    return <p className="status-message error">当前角色缺少成员投影，无法安全执行操作。</p>;
  }

  if (state.role === "subject") {
    return <SubjectSurface state={state} member={member} disabled={disabled} act={act} />;
  }

  return (
    <div className="dashboard-grid">
      <div className="main-column">
        {state.role === "primary" ? <ResponsibilityMap state={state} /> : <PartnerOverview state={state} />}
        <HandoverCard state={state} member={member} disabled={disabled} act={act} />
      </div>
      <aside className="side-column">
        <ResponsibilityReport state={state} />
        <CareCard state={state} member={member} disabled={disabled} act={act} />
        <NotificationLog state={state} />
      </aside>
    </div>
  );
}

function ResponsibilityMap({ state }: { readonly state: RoleSafeProjection }) {
  const primaryId = state.members.find((member) => member.role === "primary")?.id;
  const invisibleKeys = STAGES.filter(({ key }) => key !== "executedBy").map(({ key }) => key);
  const burden = primaryId
    ? state.report.tasks.filter((task) => {
        const domain = state.domains.find((item) => item.id === task.domainId);
        return (
          task.status === "open" &&
          (!domain?.ownerId || domain.ownerId === primaryId) &&
          invisibleKeys.every((key) => task[key] === primaryId)
        );
      }).length
    : 0;

  return (
    <section className="paper-card responsibility-map" aria-labelledby="responsibility-title">
      <p className="eyebrow">责任地图</p>
      <div className="burden-summary">
        <div>
          <h2 id="responsibility-title">这周，有哪些事一直只有你在记得？</h2>
          <p>发现、记时间、安排和跟进都落在同一个人身上。</p>
        </div>
        <strong data-testid="burden-count" aria-label={`${burden} 件隐形责任`}>{burden}</strong>
      </div>
      <div className="domain-list">
        {state.domains.map((domain) => (
          <article key={domain.id} className="domain-row">
            <div>
              <h3>{domain.name}</h3>
              <p>{domain.nextAction ?? "目前没有下一步"}</p>
            </div>
            <span className={`tag ${domain.ownerId ? "tag-ok" : "tag-warn"}`}>
              {domain.ownerId ? `主人：${memberName(state, domain.ownerId)}` : "无主人"}
            </span>
          </article>
        ))}
      </div>
    </section>
  );
}

function PartnerOverview({ state }: { readonly state: RoleSafeProjection }) {
  const partnerId = state.members.find((member) => member.role === "partner")?.id;
  const owned = state.domains.filter((domain) => domain.ownerId === partnerId);
  const pending = state.handovers.filter((handover) => handover.toMemberId === partnerId && handover.state !== "accepted");

  return (
    <section className="paper-card" aria-labelledby="partner-title">
      <p className="eyebrow">我的责任</p>
      <h2 id="partner-title">我拥有的责任域</h2>
      <p className="section-lede">执行一次不等于拥有整块责任。接手后，未来提醒也会一起转移。</p>
      <div className="metric-pair">
        <div><strong>{owned.length}</strong><span>已拥有</span></div>
        <div><strong>{pending.length}</strong><span>待确认交接</span></div>
      </div>
      {owned.map((domain) => <p className="summary-row" key={domain.id}>{domain.name}</p>)}
    </section>
  );
}

function ResponsibilityReport({ state }: { readonly state: RoleSafeProjection }) {
  return (
    <section className="paper-card" data-testid="responsibility-report" aria-labelledby="report-title">
      <p className="eyebrow">{state.report.periodLabel}</p>
      <h2 id="report-title">{state.report.title}</h2>
      <div className="report-table-wrap">
        <table>
          <thead><tr><th>任务</th><th>五阶段归属</th></tr></thead>
          <tbody>
            {state.report.tasks.map((task) => (
              <tr key={task.id}>
                <td>{task.title}</td>
                <td>
                  <div className="stage-list">
                    {STAGES.map(({ key, label }) => (
                      <span key={key}>{label} · {memberName(state, task[key])}</span>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="neutral-note">这张表只呈现已记录的责任分布，供家庭成员确认与协作。</p>
      {state.report.excludedNeedsReviewCount > 0 ? (
        <p className="review-note">{state.report.excludedNeedsReviewCount} 条因证据待复核，未计入报告。</p>
      ) : null}
    </section>
  );
}

function HandoverCard({
  state,
  member,
  disabled,
  act,
}: {
  readonly state: RoleSafeProjection;
  readonly member: MemberProjection;
  readonly disabled: boolean;
  readonly act: (label: string, action: DemoAction) => Promise<void>;
}) {
  const handover: HandoverProjection | undefined = state.handovers[0];
  if (!handover) {
    return (
      <section className="paper-card" data-testid="handover-status">
        <p className="eyebrow">责任交接</p>
        <h2>暂无交接提议</h2>
        <p className="section-lede">Fixture 尚未建立交接包；所有权不会因页面操作自行变化。</p>
      </section>
    );
  }

  const domain = state.domains.find((item) => item.id === handover.domainId);
  const canConfirm =
    handover.missingItems.length === 0 &&
    !handover.confirmedBy.includes(member.id) &&
    (member.id === handover.fromMemberId || member.id === handover.toMemberId);
  const stateText = {
    blocked: "BLOCKED · 信息不完整",
    awaiting_confirmations: "等待双方确认",
    accepted: "ACCEPTED · 所有权已转移",
  }[handover.state];

  return (
    <section className="paper-card handover-card" data-testid="handover-status" aria-labelledby="handover-title">
      <div className="section-heading">
        <div><p className="eyebrow">交接包</p><h2 id="handover-title">{domain?.name ?? "责任域交接"}</h2></div>
        <span className={`tag ${handover.state === "accepted" ? "tag-ok" : "tag-warn"}`}>{stateText}</span>
      </div>
      <p className="handover-flow">
        {memberName(state, handover.fromMemberId)} <span aria-hidden="true">→</span> {memberName(state, handover.toMemberId)}
      </p>
      <div className="handover-details">
        <div><span>缺少信息</span><strong>{handover.missingItems.length}</strong></div>
        <div><span>已确认</span><strong>{handover.confirmedBy.length} / 2</strong></div>
      </div>
      {handover.missingItems.length > 0 ? (
        <button
          className="primary-button"
          data-testid="handover-add-info"
          type="button"
          disabled={disabled}
          onClick={() => void act("信息已补齐，但所有权仍未转移。", {
            type: "add_handover_info",
            handoverId: handover.id,
            item: "last_report",
          })}
        >
          补上上次检查报告位置
        </button>
      ) : null}
      <button
        className="secondary-button"
        data-testid="handover-confirm"
        type="button"
        disabled={disabled || !canConfirm}
        onClick={() => void act("你的确认已记录。双方都确认后才会转移所有权。", {
          type: "confirm_handover",
          handoverId: handover.id,
          actorId: member.id,
          expectedVersion: handover.version,
        })}
      >
        {handover.confirmedBy.includes(member.id) ? "你已确认" : "确认这一整块交接"}
      </button>
      <p className="safety-note">信息补齐、且双方都确认前，责任保持在原处，未来提醒不会提前转移。</p>
    </section>
  );
}

function SubjectSurface({
  state,
  member,
  disabled,
  act,
}: {
  readonly state: RoleSafeProjection;
  readonly member: MemberProjection;
  readonly disabled: boolean;
  readonly act: (label: string, action: DemoAction) => Promise<void>;
}) {
  const evidence = state.evidence.find(
    (item) => item.id === "evidence_subject_private" && item.speakerId === member.id && !item.deleted,
  );

  return (
    <div className="subject-layout">
      <section className="subject-phone" data-testid="subject-chat" aria-labelledby="subject-chat-title">
        <div className="chat-heading">
          <div className="agent-mark" aria-hidden="true">记</div>
          <div><h2 id="subject-chat-title">都记得</h2><p>随时可以跟我说话</p></div>
        </div>
        <div className="chat-body">
          <div className="message agent">奶奶早上好。昨天睡得还行吗？</div>
          {evidence ? <div className="message mine">{evidence.text}</div> : <div className="message mine">腿这两天又疼了，下楼有点吃力。</div>}
          <div className="message agent">我记下了。要不要把这件事告诉家里人？</div>
          <div className="consent-card">
            <h3>这句话由你决定</h3>
            <p>每次共享都单独确认。选择“不说”不会进入家庭空间或责任报告。</p>
            {evidence ? (
              <div className="senior-actions">
                <button className="primary-button" data-testid="consent-space" type="button" disabled={disabled} onClick={() => void act("已按你的选择告诉家里人。", {
                  type: "share_evidence", evidenceId: evidence.id, visibility: "space",
                })}>告诉家里人</button>
                <button className="secondary-button" type="button" disabled={disabled} onClick={() => void act("只向照护相关成员共享。", {
                  type: "share_evidence", evidenceId: evidence.id, visibility: "care_related",
                })}>只告诉照护我的人</button>
                <button className="text-button" type="button" disabled={disabled} onClick={() => void act("这句话只留给你自己。", {
                  type: "share_evidence", evidenceId: evidence.id, visibility: "self",
                })}>先别说</button>
              </div>
            ) : <p className="safety-note">当前没有可共享的私聊证据。</p>}
            {evidence ? <p className="visibility-state">当前范围：{visibilityLabel(evidence.visibility)}</p> : null}
          </div>
        </div>
        <div className="voice-control" aria-label="演示输入控件">按住说话</div>
      </section>
      <aside className="subject-actions">
        <CareCard state={state} member={member} disabled={disabled} act={act} />
        <NotificationLog state={state} />
      </aside>
    </div>
  );
}

function CareCard({
  state,
  member,
  disabled,
  act,
}: {
  readonly state: RoleSafeProjection;
  readonly member: MemberProjection;
  readonly disabled: boolean;
  readonly act: (label: string, action: DemoAction) => Promise<void>;
}) {
  const rule = state.careRules.find((item) => item.state === "draft") ?? state.careRules[0];
  const event = latestCareEvent(state.careEvents);
  if (!rule) return null;
  const isSubject = member.id === rule.subjectId;

  return (
    <section className="paper-card care-card" aria-labelledby="care-title">
      <p className="eyebrow">确定性看护</p>
      <div className="section-heading">
        <div><h2 id="care-title">{rule.scheduleLabel}</h2><p>{rule.acknowledgementTimeoutSeconds} 秒未回应后按顺序升级</p></div>
        <span className={`tag ${rule.state === "active" ? "tag-ok" : "tag-warn"}`}>{rule.state === "active" ? "已激活" : "草稿"}</span>
      </div>
      <ol className="care-chain">
        <li>先提醒本人</li>
        {rule.escalationMemberIds.map((id) => <li key={id}>再通知 {memberName(state, id)}</li>)}
      </ol>
      <div className="action-stack">
        <button className="primary-button" data-testid="care-activate" type="button" disabled={disabled || rule.state === "active" || !isSubject} onClick={() => void act("看护规则已由本人确认激活。", {
          type: "activate_care_rule", careRuleId: rule.id, actorId: member.id, expectedVersion: rule.version,
        })}>{isSubject ? "本人确认并激活" : "等待本人确认激活"}</button>
        <button className="secondary-button" data-testid="care-trigger" type="button" disabled={disabled || rule.state !== "active"} onClick={() => void act("提醒先发给本人。", {
          type: "trigger_care_reminder", careRuleId: rule.id,
        })}>触发本次提醒</button>
        <button className="secondary-button" data-testid="care-advance" type="button" disabled={disabled || !event || event.state !== "reminded"} onClick={() => void act("演示时钟已推进到超时边界。", {
          type: "advance_demo_clock", seconds: rule.acknowledgementTimeoutSeconds,
        })}>推进到回应超时</button>
        <button className="primary-button" data-testid="care-ack" type="button" disabled={disabled || !isSubject || !event || !["reminded", "escalated"].includes(event.state)} onClick={() => event ? void act("本人已回应，事件闭环。", {
          type: "acknowledge_care", careEventId: event.id, actorId: member.id,
        }) : undefined}>我知道了</button>
      </div>
      <p className="safety-note">定时、超时、升级和确认全部由程序执行，不调用模型，也不推断健康状态。</p>
    </section>
  );
}

function NotificationLog({ state }: { readonly state: RoleSafeProjection }) {
  const latestEvent = latestCareEvent(state.careEvents);
  return (
    <section className="paper-card" data-testid="notification-log" aria-labelledby="notification-title">
      <p className="eyebrow">通知记录</p>
      <h2 id="notification-title">送达事实，不多说一步</h2>
      {latestEvent ? (
        <p className="safety-note">看护事件：{latestEvent.state === "closed" ? "已闭环" : latestEvent.state}</p>
      ) : null}
      {state.notificationLogs.length ? (
        <ul className="notification-list">
          {state.notificationLogs.map((log) => (
            <li key={log.id}>
              <div><strong>{log.channel === "app" ? "App" : "A3 语音"}</strong><span>{log.templateId}</span></div>
              <span className={`tag ${log.status === "shown_in_app" ? "tag-ok" : "tag-neutral"}`}>{STATUS_LABELS[log.status]}</span>
              <small>{log.occurredAt}</small>
            </li>
          ))}
        </ul>
      ) : <p className="empty-state">还没有通知记录。</p>}
      <p className="safety-note">“服务方已接收”不等于用户已读、已确认或任务已完成；A3 默认关闭。</p>
    </section>
  );
}
