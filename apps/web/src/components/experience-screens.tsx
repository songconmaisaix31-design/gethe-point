"use client";

import {
  FIXTURE_ACCEPTED_HANDOVER,
  FIXTURE_AWAITING_HANDOVER,
  FIXTURE_BLOCKED_HANDOVER,
  FIXTURE_HANDOVER_PACKET,
  FIXTURE_IDS,
  FIXTURE_MEMBERS,
  FIXTURE_SPACE,
  FIXTURE_TIMES,
  type MemberRole,
  type ResponsibilityStage,
} from "../features/experience/contracts";
import { useState } from "react";

import type { ExperienceBundle, ExperienceClient } from "../features/experience/client";
import {
  FIXTURE_ACTION_CONTEXT,
  getFixtureActor,
} from "../features/experience/fixture-client";
import {
  ROLE_LABELS,
  type ExperienceRoute,
} from "../features/experience/model";
import { StateNotice } from "./state-notice";

interface ExperienceScreenProps {
  readonly bundle: ExperienceBundle;
  readonly client: ExperienceClient;
  readonly route: ExperienceRoute;
}

type ActionStatus = "idle" | "working" | "success" | "error";

interface ActionFeedbackValue {
  readonly status: ActionStatus;
  readonly message: string;
}

const idleFeedback: ActionFeedbackValue = { status: "idle", message: "" };

const useActionFeedback = () => {
  const [feedback, setFeedback] = useState<ActionFeedbackValue>(idleFeedback);

  const run = async (work: () => Promise<unknown>, successMessage: string): Promise<void> => {
    setFeedback({ status: "working", message: "正在记录，不会重复提交。" });
    try {
      await work();
      setFeedback({ status: "success", message: successMessage });
    } catch {
      setFeedback({
        status: "error",
        message: "操作未完成，当前状态没有改变，请稍后重试。",
      });
    }
  };

  return { feedback, run } as const;
};

function ActionFeedback({ value }: { readonly value: ActionFeedbackValue }) {
  if (value.status === "idle") {
    return null;
  }

  return (
    <p className={`action-feedback action-feedback--${value.status}`} role="status">
      {value.status === "success" ? <span aria-hidden="true">✓ </span> : null}
      {value.message}
    </p>
  );
}

function ScreenHeading({ eyebrow, title, detail }: {
  readonly eyebrow: string;
  readonly title: string;
  readonly detail: string;
}) {
  return (
    <header className="screen-heading">
      <p className="eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      <p>{detail}</p>
    </header>
  );
}

const rememberedItems = Object.freeze([
  { title: "确认复查时间", meta: "等待补齐上次检查结果" },
  { title: "核对陪同安排", meta: "本周五前确认" },
  { title: "准备既往资料", meta: "由我保管" },
  { title: "更新门诊联系人", meta: "信息仍在核对" },
  { title: "提醒长辈出发时间", meta: "交接完成前仍由我负责" },
  { title: "记录复查结果", meta: "完成后再确认下一步" },
  { title: "跟进后续安排", meta: "当前责任人：家人甲" },
] as const);

function PrimaryHome({ bundle }: { readonly bundle: ExperienceBundle }) {
  const count = bundle.home.role === "primary" ? bundle.home.rememberedItemCount : 0;

  return (
    <>
      <ScreenHeading
        eyebrow="主要照护者 · 今天"
        title="我还在记着的事"
        detail="责任没有因为被写下来就自动转移；这里只显示当前仍由你负责的完整范围。"
      />
      <section className="metric-row" aria-label="当前责任摘要">
        <article className="metric-card metric-card--accent">
          <strong>{count}</strong>
          <span>项仍需我记住</span>
        </article>
        <article className="metric-card">
          <strong>1</strong>
          <span>个交接仍被信息阻塞</span>
        </article>
        <article className="metric-card metric-card--released">
          <strong>0</strong>
          <span>项已完整释放</span>
        </article>
      </section>
      <section className="surface-card" aria-labelledby="remembered-heading">
        <div className="section-title-row">
          <div>
            <p className="eyebrow">近期复查安排</p>
            <h2 id="remembered-heading">7 项记忆负担</h2>
          </div>
          <span className="status-tag status-tag--blocked">责任未转移</span>
        </div>
        <ol className="remembered-list">
          {rememberedItems.map((item, index) => (
            <li key={item.title}>
              <span className="list-index" aria-hidden="true">{index + 1}</span>
              <span>
                <strong>{item.title}</strong>
                <small>{item.meta}</small>
              </span>
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}

function PartnerHome({ bundle }: { readonly bundle: ExperienceBundle }) {
  const ownedCount = bundle.home.role === "partner" ? bundle.home.ownedDomainIds.length : 0;
  const pendingCount = bundle.home.role === "partner" ? bundle.home.pendingHandoverIds.length : 0;

  return (
    <>
      <ScreenHeading
        eyebrow="协作家人 · 今天"
        title="我已经接住的责任"
        detail="接手的是完整责任范围，不只是某一个临时动作；等待确认的交接不会提前算到你名下。"
      />
      <section className="metric-row" aria-label="协作责任摘要">
        <article className="metric-card metric-card--accent">
          <strong>{ownedCount}</strong>
          <span>个完整责任域</span>
        </article>
        <article className="metric-card">
          <strong>{pendingCount}</strong>
          <span>个交接等待确认</span>
        </article>
        <article className="metric-card">
          <strong>1</strong>
          <span>条照护消息待处理</span>
        </article>
      </section>
      <section className="surface-card">
        <div className="section-title-row">
          <div>
            <p className="eyebrow">当前责任边界</p>
            <h2>日常物品补给</h2>
          </div>
          <span className="status-tag status-tag--success">已由我负责</span>
        </div>
        <dl className="detail-grid">
          <div><dt>范围</dt><dd>检查余量、补充购买、到货确认与后续跟进</dd></div>
          <div><dt>下一步</dt><dd>周四核对清单</dd></div>
          <div><dt>提醒</dt><dd>只发送给当前责任人</dd></div>
        </dl>
      </section>
    </>
  );
}

function SubjectHome() {
  return (
    <div className="subject-surface">
      <ScreenHeading
        eyebrow="长辈本人 · 今天"
        title="今天只看两件事"
        detail="你的对话默认只给你看；需要家人知道的内容，会先单独问你。"
      />
      <section className="subject-choice-grid" aria-label="今天的事项">
        <a className="subject-choice" href="/?role=subject&view=private-conversation">
          <span aria-hidden="true">私</span>
          <strong>继续我的私密对话</strong>
          <small>不会自动发给家里人</small>
        </a>
        <a className="subject-choice" href="/?role=subject&view=care-inbox">
          <span aria-hidden="true">信</span>
          <strong>查看 1 条照护消息</strong>
          <small>一步确认，不需要输入文字</small>
        </a>
      </section>
    </div>
  );
}

function RoleHomeScreen({ bundle, role }: {
  readonly bundle: ExperienceBundle;
  readonly role: MemberRole;
}) {
  switch (role) {
    case "primary":
      return <PrimaryHome bundle={bundle} />;
    case "partner":
      return <PartnerHome bundle={bundle} />;
    case "subject":
      return <SubjectHome />;
  }
}

type ConsentChoice = "share" | "discard" | "specific";

function ConversationScreen({ bundle, client, role, consentOnly = false }: {
  readonly bundle: ExperienceBundle;
  readonly client: ExperienceClient;
  readonly role: MemberRole;
  readonly consentOnly?: boolean;
}) {
  const { feedback, run } = useActionFeedback();
  const [selectedChoice, setSelectedChoice] = useState<ConsentChoice | null>(null);
  const actor = getFixtureActor(role);
  const message = bundle.conversation.messages[0];

  const decide = async (choice: ConsentChoice): Promise<void> => {
    const request =
      choice === "discard"
        ? {
            requestId: FIXTURE_ACTION_CONTEXT.requestId,
            signalDraftId: FIXTURE_IDS.signalDraft,
            decision: "discard" as const,
            visibility: null,
            decidedAt: FIXTURE_TIMES.updated,
            expiresAt: null,
          }
        : {
            requestId: FIXTURE_ACTION_CONTEXT.requestId,
            signalDraftId: FIXTURE_IDS.signalDraft,
            decision: "share" as const,
            visibility:
              choice === "specific"
                ? { kind: "members" as const, memberIds: [actor.memberId, FIXTURE_IDS.partner] }
                : { kind: "space" as const },
            decidedAt: FIXTURE_TIMES.updated,
            expiresAt: null,
          };
    const successMessage =
      choice === "discard"
        ? "已记录“先别说”，没有写入家庭动态。"
        : choice === "specific"
          ? "已记录仅向指定成员分享；其他成员看不到这条内容。"
          : "已记录本条分享范围；只有这条结构化结论会进入家庭动态。";

    await run(() => client.command.decideConsent({ actor, request }), successMessage);
    setSelectedChoice(choice);
  };

  return (
    <div className={role === "subject" ? "subject-surface" : undefined}>
      <ScreenHeading
        eyebrow={`${ROLE_LABELS[role]} · ${consentOnly ? "分享确认" : "私密对话"}`}
        title={consentOnly ? "这条内容要告诉谁？" : "只属于我的对话"}
        detail="原话默认留在当前演示成员的私密空间，未经逐项同意不会进入家庭动态。"
      />
      {!consentOnly ? (
        <section className="surface-card private-card" aria-label="私密消息">
          <div className="privacy-line"><span aria-hidden="true">锁</span> 只有当前演示成员能看到这里的原文</div>
          <blockquote>{message?.content ?? "这里还没有私密消息。"}</blockquote>
          <p className="assistant-reply">我可以先整理成一条不含原话的结论，再由你决定是否分享。</p>
        </section>
      ) : null}
      <section className="surface-card consent-card" aria-labelledby="consent-heading">
        <p className="eyebrow">逐项同意 · 本条内容</p>
        <h2 id="consent-heading">需要确认近期复查的时间与陪同安排。</h2>
        <p>将分享结构化结论，不分享上面的私密原话。默认没有选中任何分享范围。</p>
        <div className="consent-actions" role="group" aria-label="选择本条内容的分享范围">
          {([
            ["share", "告诉家里人"],
            ["discard", "先别说"],
            ["specific", "只告诉指定成员"],
          ] as const).map(([choice, label]) => (
            <button
              key={choice}
              className="choice-button"
              type="button"
              aria-pressed={selectedChoice === choice}
              disabled={feedback.status === "working"}
              onClick={() => { void decide(choice); }}
            >
              <span className="choice-button__mark" aria-hidden="true">
                {selectedChoice === choice ? "✓" : "○"}
              </span>
              {label}
            </button>
          ))}
        </div>
        <ActionFeedback value={feedback} />
      </section>
    </div>
  );
}

function FamilyActivityScreen({ bundle, role }: {
  readonly bundle: ExperienceBundle;
  readonly role: MemberRole;
}) {
  const signal = bundle.signals[0];

  return (
    <>
      <ScreenHeading
        eyebrow={`${ROLE_LABELS[role]} · 家庭动态`}
        title="只显示同意分享的结论"
        detail="这里不展示任何人的私密原话；每条动态都保留分享范围与来源记录。"
      />
      <section className="surface-card activity-card">
        <div className="section-title-row">
          <div>
            <p className="eyebrow">照护信息 · 已同意分享</p>
            <h2>{signal?.conclusion ?? "暂无内容"}</h2>
          </div>
          <span className="status-tag status-tag--success">范围已确认</span>
        </div>
        <p>可见成员：长辈甲、家人甲、家人乙</p>
        <div className="provenance-strip">
          <span>来源：私密对话的授权结论</span>
          <span>时间：2026-08-27 08:00</span>
          <span>原话：不在家庭动态中显示</span>
        </div>
      </section>
    </>
  );
}

const stageLabels = Object.freeze({
  discoveredBy: "发现需要处理",
  deadlineKeptBy: "记住截止时间",
  scheduledBy: "安排时间",
  executedBy: "实际执行",
  followedUpBy: "后续跟进",
} as const satisfies Readonly<Record<ResponsibilityStage, string>>);

const memberName = (memberId: string): string => {
  const entry = Object.values(FIXTURE_MEMBERS).find((member) => member.id === memberId);
  return entry?.displayName ?? "未记录成员";
};

function ResponsibilityReportScreen({ bundle, role }: {
  readonly bundle: ExperienceBundle;
  readonly role: MemberRole;
}) {
  const report = bundle.report;

  if (report === null) {
    return <StateNotice state="denied" />;
  }

  return (
    <>
      <ScreenHeading
        eyebrow={`${ROLE_LABELS[role]} · 责任记录`}
        title="谁在哪个阶段承担了工作"
        detail="按五个实际阶段陈述已记录事实，不评价成员，也不把一次动作等同于完整责任。"
      />
      <section className="surface-card report-card">
        <p className="report-narrative">{report.narrative}</p>
        <div className="stage-table" role="table" aria-label="五阶段责任记录">
          {report.rows.map((row) => (
            <div className="stage-row" role="row" key={row.stage}>
              <span role="cell">{stageLabels[row.stage]}</span>
              <strong role="cell">{memberName(row.counts[0]?.memberId ?? "")}</strong>
              <span role="cell">{row.counts[0]?.count ?? 0} 次已记录</span>
            </div>
          ))}
        </div>
        <p className="fine-print">未归属责任域：{report.unownedDomainCount} · 因需重新确认而暂不计入：{report.excludedNeedsReviewCount}</p>
      </section>
    </>
  );
}

function ConfirmationRow({ label, confirmed }: {
  readonly label: string;
  readonly confirmed: boolean;
}) {
  return (
    <li>
      <span aria-hidden="true">{confirmed ? "✓" : "○"}</span>
      <span><strong>{label}</strong><small>{confirmed ? "已独立确认" : "尚未确认"}</small></span>
    </li>
  );
}

function HandoverScreen({ client, role, route }: {
  readonly client: ExperienceClient;
  readonly role: MemberRole;
  readonly route: ExperienceRoute;
}) {
  const { feedback, run } = useActionFeedback();
  const actor = getFixtureActor(role);
  const handover =
    route.handoverVariant === "accepted"
      ? FIXTURE_ACCEPTED_HANDOVER
      : route.handoverVariant === "awaiting"
        ? FIXTURE_AWAITING_HANDOVER
        : FIXTURE_BLOCKED_HANDOVER;
  const blocked = handover.status === "blocked";
  const accepted = handover.status === "accepted";

  const recordHandoverAction = async (): Promise<void> => {
    if (blocked) {
      await run(
        () => client.command.supplyHandoverInfo({
          actor,
          request: {
            requestId: FIXTURE_ACTION_CONTEXT.requestId,
            idempotencyKey: FIXTURE_ACTION_CONTEXT.idempotencyKey,
            handoverId: FIXTURE_IDS.handover,
            resolvedItems: [{
              missingInfoId: FIXTURE_IDS.missingInfo,
              value: "已在授权范围内补充示例检查结果。",
              evidenceIds: [FIXTURE_IDS.evidence],
            }],
            expectedVersion: 1,
          },
        }),
        "信息已记录；仍需双方分别确认，责任当前没有转移。",
      );
      return;
    }

    if (role === "partner") {
      await run(
        () => client.command.confirmHandoverTo({
          actor,
          request: {
            requestId: FIXTURE_ACTION_CONTEXT.requestId,
            idempotencyKey: FIXTURE_ACTION_CONTEXT.idempotencyKey,
            handoverId: FIXTURE_IDS.handover,
            confirmedAt: FIXTURE_TIMES.confirmedTo,
            expectedVersion: 3,
          },
        }),
        "已记录接手方确认；只有双方都确认且系统完成原子迁移后，责任才会转移。",
      );
      return;
    }

    await run(
      () => client.command.confirmHandoverFrom({
        actor,
        request: {
          requestId: FIXTURE_ACTION_CONTEXT.requestId,
          idempotencyKey: FIXTURE_ACTION_CONTEXT.idempotencyKey,
          handoverId: FIXTURE_IDS.handover,
          confirmedAt: FIXTURE_TIMES.confirmedFrom,
          expectedVersion: 2,
        },
      }),
      "已记录交出方确认；接手方仍需独立确认，责任当前没有转移。",
    );
  };

  return (
    <>
      <ScreenHeading
        eyebrow={`${ROLE_LABELS[role]} · 责任交接`}
        title="近期复查安排"
        detail="交接的是预约、陪同、结果记录与后续跟进的完整责任，不只是一个临时动作。"
      />
      {blocked ? (
        <StateNotice
          state="blocked"
          detail="缺少“上次检查结果”，双方都不能确认；当前负责人仍是家人甲。"
        />
      ) : null}
      {accepted ? (
        <StateNotice
          state="success"
          detail="责任已由家人乙接住；家人甲的后续提醒已移除，交接状态为终态。"
        />
      ) : null}
      <section className="surface-card handover-card">
        <div className="ownership-flow" aria-label="责任所有者变化">
          <div><small>{accepted ? "原负责人" : "当前负责人"}</small><strong>家人甲</strong></div>
          <span aria-hidden="true">→</span>
          <div><small>{accepted ? "当前负责人" : "拟接手人"}</small><strong>家人乙</strong></div>
        </div>
        <dl className="handover-packet">
          <div><dt>完整范围</dt><dd>{FIXTURE_HANDOVER_PACKET.scope}</dd></div>
          <div><dt>已知情况</dt><dd>{FIXTURE_HANDOVER_PACKET.history[0]}</dd></div>
          <div><dt>约束</dt><dd>{FIXTURE_HANDOVER_PACKET.constraints[0]}</dd></div>
          <div><dt>联系人</dt><dd>{FIXTURE_HANDOVER_PACKET.contacts[0].redactedValue}</dd></div>
          <div><dt>下一步</dt><dd>{FIXTURE_HANDOVER_PACKET.nextAction}</dd></div>
        </dl>
        {blocked ? (
          <div className="missing-info" role="note">
            <strong>缺少：上次检查结果</strong>
            <span>接手人需要这项信息才能继续安排。</span>
          </div>
        ) : null}
        <div className="confirmation-panel">
          <h2>双方分别确认</h2>
          <ul>
            <ConfirmationRow label="家人甲 · 交出方" confirmed={handover.fromConfirmedAt !== null} />
            <ConfirmationRow label="家人乙 · 接手方" confirmed={handover.toConfirmedAt !== null} />
          </ul>
        </div>
        {!accepted ? (
          <button
            className="button button--primary"
            type="button"
            disabled={feedback.status === "working"}
            onClick={() => { void recordHandoverAction(); }}
          >
            {blocked ? "补齐示例信息" : role === "partner" ? "确认完整接手范围" : "确认完整交出范围"}
          </button>
        ) : (
          <div className="workload-release" data-testid="workload-release">
            <span aria-hidden="true">✓</span>
            <div><strong>工作量已明确释放</strong><p>后续提醒不再发送给家人甲，新任务默认归家人乙。</p></div>
          </div>
        )}
        <ActionFeedback value={feedback} />
      </section>
    </>
  );
}

function CareInboxScreen({ client, role, route }: {
  readonly client: ExperienceClient;
  readonly role: MemberRole;
  readonly route: ExperienceRoute;
}) {
  const { feedback, run } = useActionFeedback();
  const actor = getFixtureActor(role);
  const isSubject = role === "subject";
  const handled = route.careVariant === "handled";

  const acknowledge = async (): Promise<void> => {
    await run(
      () => client.command.acknowledgeCareEvent({
        actor,
        request: {
          requestId: FIXTURE_ACTION_CONTEXT.requestId,
          idempotencyKey: FIXTURE_ACTION_CONTEXT.idempotencyKey,
          careEventId: FIXTURE_IDS.careEvent,
          acknowledgedAt: FIXTURE_TIMES.deadline,
          expectedVersion: 1,
        },
      }),
      "已完成：你的确认已经记录，家人可以看到本次状态。",
    );
  };

  const handle = async (): Promise<void> => {
    await run(
      () => client.command.handleCareEvent({
        actor,
        request: {
          requestId: FIXTURE_ACTION_CONTEXT.requestId,
          idempotencyKey: FIXTURE_ACTION_CONTEXT.idempotencyKey,
          careEventId: FIXTURE_IDS.careEvent,
          resolution: "in_person_check_started",
          handledAt: FIXTURE_TIMES.handled,
          expectedVersion: 3,
        },
      }),
      "已完成：已记录开始现场确认；后续状态仍会保留在时间线中。",
    );
  };

  if (isSubject) {
    return (
      <div className="subject-surface">
        <ScreenHeading
          eyebrow="长辈本人 · 照护收件箱"
          title="晚间确认"
          detail="请确认你已经看到这条消息。只需按一次按钮，不需要输入文字。"
        />
        <section className="surface-card subject-care-card">
          <p className="care-time">今天 20:00</p>
          <h2>请确认你已经看到晚间提醒</h2>
          <p>这一步只记录“已看到”，不会自动做其他决定。</p>
          <button
            className="button button--primary subject-primary-action"
            type="button"
            data-subject-primary="true"
            disabled={feedback.status === "working"}
            onClick={() => { void acknowledge(); }}
          >
            我知道了
          </button>
          <ActionFeedback value={feedback} />
        </section>
        <p className="medical-safety">本演示不是医疗器械，不提供诊断，也不能替代紧急服务。遇到紧急情况请联系当地紧急服务。</p>
      </div>
    );
  }

  return (
    <>
      <ScreenHeading
        eyebrow={`${ROLE_LABELS[role]} · 照护收件箱`}
        title={handled ? "现场确认已经开始" : "晚间确认仍未回应"}
        detail="升级由确定规则执行并完整留痕；这里不提供医疗判断或用药建议。"
      />
      <section className="surface-card care-timeline-card">
        <ol className="timeline">
          <li className="timeline__done"><strong>20:00 · 已发送给长辈甲</strong><span>等待一步确认</span></li>
          <li className="timeline__done"><strong>20:01 · 未在时限内确认</strong><span>已按规则通知家人乙</span></li>
          <li className={handled ? "timeline__done" : "timeline__current"}>
            <strong>20:03 · {handled ? "家人乙已开始现场确认" : "请家人乙现场确认"}</strong>
            <span>{handled ? "处理记录已留痕，等待按规则关闭" : "当前仍未解决"}</span>
          </li>
        </ol>
        {handled ? (
          <StateNotice state="success" detail="已记录处理动作；升级经过与当前状态都保持可见。" />
        ) : (
          <>
            <StateNotice state="unresolved" />
            <button
              className="button button--primary"
              type="button"
              disabled={feedback.status === "working"}
              onClick={() => { void handle(); }}
            >
              记录已开始现场确认
            </button>
          </>
        )}
        <ActionFeedback value={feedback} />
      </section>
      <p className="medical-safety">本演示不是医疗器械，不提供诊断，也不能替代紧急服务。</p>
    </>
  );
}

function PrivacyScreen({ bundle, client, role, route }: {
  readonly bundle: ExperienceBundle;
  readonly client: ExperienceClient;
  readonly role: MemberRole;
  readonly route: ExperienceRoute;
}) {
  const { feedback, run } = useActionFeedback();
  const actor = getFixtureActor(role);
  const [typedName, setTypedName] = useState("");
  const provenance = bundle.domain.evidence[0];
  const deleted = route.privacyVariant === "deleted";

  const runPrivacyAction = async (action: "delete" | "revoke" | "export" | "space") => {
    switch (action) {
      case "delete":
        await run(
          () => client.command.deleteEvidence({
            actor,
            request: {
              requestId: FIXTURE_ACTION_CONTEXT.requestId,
              idempotencyKey: FIXTURE_ACTION_CONTEXT.idempotencyKey,
              evidenceId: FIXTURE_IDS.evidence,
              expectedVersion: 0,
            },
          }),
          "已完成：该证据已删除；相关结论需要重新确认，暂不计入报告。已完成的责任交接不会倒退。",
        );
        return;
      case "revoke":
        await run(
          () => client.command.revokeAnalysisConsent({
            actor,
            request: {
              requestId: FIXTURE_ACTION_CONTEXT.requestId,
              idempotencyKey: FIXTURE_ACTION_CONTEXT.idempotencyKey,
              effectiveAt: FIXTURE_TIMES.updated,
              expectedMemberVersion: 0,
            },
          }),
          "已完成：今后的内容不再用于分析；此前经同意产生的记录按规则保留。",
        );
        return;
      case "export":
        await run(
          () => client.command.exportMyData({
            actor,
            request: {
              requestId: FIXTURE_ACTION_CONTEXT.requestId,
              idempotencyKey: FIXTURE_ACTION_CONTEXT.idempotencyKey,
              format: "json",
              requestedAt: FIXTURE_TIMES.updated,
            },
          }),
          "已完成：Fixture 个人数据包已生成；没有连接真实账号或下载真实数据。",
        );
        return;
      case "space":
        await run(
          () => client.command.deleteSpace({
            actor,
            request: {
              requestId: FIXTURE_ACTION_CONTEXT.requestId,
              idempotencyKey: FIXTURE_ACTION_CONTEXT.idempotencyKey,
              spaceId: FIXTURE_IDS.space,
              expectedSpaceName: FIXTURE_SPACE.name,
              typedSpaceName: typedName,
              expectedVersion: 0,
            },
          }),
          "已完成：Fixture 空间删除结果已确认；演示中没有真实家庭数据。",
        );
        return;
    }
  };

  return (
    <div className={role === "subject" ? "subject-surface" : undefined}>
      <ScreenHeading
        eyebrow={`${ROLE_LABELS[role]} · 来源与隐私`}
        title="看得见来源，也能撤回未来使用"
        detail="原始私密内容与家庭可见结论分开保存；删除和授权变更都明确说明后果。"
      />
      {deleted ? (
        <section className="surface-card deletion-consequence">
          <h2>删除后的确定结果</h2>
          <ul className="plain-list">
            <li>证据已缺失，相关结论需要重新确认。</li>
            <li>相关内容暂不计入责任记录。</li>
            <li>已接受的责任交接保持不变，不会把责任退回原负责人。</li>
          </ul>
        </section>
      ) : (
        <section className="surface-card provenance-card">
          <div className="section-title-row">
            <div><p className="eyebrow">来源记录</p><h2>近期复查安排</h2></div>
            <span className="status-tag status-tag--info">可核对</span>
          </div>
          <dl className="detail-grid">
            <div><dt>来源类型</dt><dd>{provenance?.view === "provenance" ? "私密对话的来源记录" : "仅本人可见原始证据"}</dd></div>
            <div><dt>发生时间</dt><dd>2026-08-27 08:00</dd></div>
            <div><dt>家庭可见内容</dt><dd>只有经同意的结构化结论</dd></div>
            <div><dt>原始内容</dt><dd>{role === "subject" ? "仅你本人可查看和删除" : "你无权查看"}</dd></div>
          </dl>
        </section>
      )}
      <section className="surface-card privacy-actions-card">
        <h2>我的数据控制</h2>
        <div className="privacy-actions">
          {role === "subject" ? (
            <>
              <button className="button button--secondary" type="button" onClick={() => { void runPrivacyAction("delete"); }}>删除这条证据</button>
              <button className="button button--secondary" type="button" onClick={() => { void runPrivacyAction("revoke"); }}>停止今后分析</button>
            </>
          ) : null}
          <button className="button button--secondary" type="button" onClick={() => { void runPrivacyAction("export"); }}>导出我的数据</button>
        </div>
        {role === "primary" ? (
          <div className="danger-zone">
            <h3>删除整个家庭空间</h3>
            <p>仅空间创建者可以执行。删除会移除空间内所有产品内容与审计记录，不能用普通操作恢复。</p>
            <label htmlFor="space-name">输入“{FIXTURE_SPACE.name}”确认</label>
            <input id="space-name" value={typedName} onChange={(event) => { setTypedName(event.target.value); }} />
            <button
              className="button button--danger"
              type="button"
              disabled={typedName !== FIXTURE_SPACE.name || feedback.status === "working"}
              onClick={() => { void runPrivacyAction("space"); }}
            >
              删除 Fixture 家庭空间
            </button>
          </div>
        ) : null}
        {role === "partner" ? <p className="fine-print">只有空间创建者能删除整个家庭空间。</p> : null}
        <ActionFeedback value={feedback} />
      </section>
    </div>
  );
}

export function ExperienceScreen({ bundle, client, route }: ExperienceScreenProps) {
  switch (route.surface) {
    case "role-home":
      return <RoleHomeScreen bundle={bundle} role={route.role} />;
    case "private-conversation":
      return <ConversationScreen bundle={bundle} client={client} role={route.role} />;
    case "signal-consent":
      return <ConversationScreen bundle={bundle} client={client} role={route.role} consentOnly />;
    case "family-activity":
      return <FamilyActivityScreen bundle={bundle} role={route.role} />;
    case "responsibility-report":
      return <ResponsibilityReportScreen bundle={bundle} role={route.role} />;
    case "handover":
      return <HandoverScreen client={client} role={route.role} route={route} />;
    case "care-inbox":
      return <CareInboxScreen client={client} role={route.role} route={route} />;
    case "evidence-and-privacy":
      return <PrivacyScreen bundle={bundle} client={client} role={route.role} route={route} />;
  }
}
