"use client";

import Image from "next/image";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { Role } from "../contracts";
import {
  getTimetableState,
  postTimetableAction,
  queryMemberAgent,
  TimetableApiError,
  type AgentIntent,
  type AgentResponse,
  type TimetableCategory,
  type TimetableItem,
  type TimetableProjection,
} from "./timetable-api";

const ROLES: readonly Role[] = ["primary", "partner", "subject"];
const ROLE_FALLBACK = {
  primary: { name: "林秀", detail: "妈妈" },
  partner: { name: "陈建国", detail: "爸爸" },
  subject: { name: "周素兰", detail: "奶奶" },
} as const;
const CATEGORY_LABELS: Readonly<Record<TimetableCategory, string>> = {
  responsibility: "责任",
  care: "照护",
  family: "家庭",
};
const STATUS_LABELS = {
  planned: "计划中",
  completed: "已完成",
} as const;
const QUICK_QUERIES: readonly { label: string; message: string; intent: AgentIntent }[] = [
  { label: "看日程", message: "这周有什么安排？", intent: "schedule" },
  { label: "看责任", message: "现在有哪些责任需要留意？", intent: "responsibilities" },
  { label: "看照护", message: "有哪些照护安排？", intent: "care" },
];
const SHANGHAI_TIME_ZONE = "Asia/Shanghai";
const SHANGHAI_DATE_FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: SHANGHAI_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const SHANGHAI_TIME_FORMAT = new Intl.DateTimeFormat("zh-CN", {
  timeZone: SHANGHAI_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function shanghaiDay(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  const parts = SHANGHAI_DATE_FORMAT.formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function addUtcDays(day: string, amount: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function weekDays(now: string): readonly string[] {
  const today = shanghaiDay(now);
  const date = new Date(`${today}T00:00:00Z`);
  const offset = (date.getUTCDay() + 6) % 7;
  const monday = addUtcDays(today, -offset);
  return Array.from({ length: 7 }, (_, index) => addUtcDays(monday, index));
}

function dayLabel(day: string): { readonly weekday: string; readonly date: string } {
  const date = new Date(`${day}T00:00:00Z`);
  return {
    weekday: new Intl.DateTimeFormat("zh-CN", { weekday: "short", timeZone: "UTC" }).format(date),
    date: new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", timeZone: "UTC" }).format(date),
  };
}

function timeLabel(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : SHANGHAI_TIME_FORMAT.format(date);
}

function serializeShanghaiDateTimeLocal(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) {
    throw new TimetableApiError("请选择有效的开始时间。", "invalid_request");
  }
  return `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:00+08:00`;
}

function apiMessage(error: unknown, fallback: string): string {
  return error instanceof TimetableApiError ? error.message : fallback;
}

function memberName(state: TimetableProjection, memberId: string): string {
  return state.members.find(({ id }) => id === memberId)?.displayName ?? "家庭成员";
}

export function FamilyHome() {
  const [role, setRole] = useState<Role>("primary");
  const [state, setState] = useState<TimetableProjection | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [memberFilter, setMemberFilter] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<TimetableCategory | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState("member_primary");
  const [message, setMessage] = useState("");
  const [agentResponse, setAgentResponse] = useState<AgentResponse | null>(null);
  const requestVersion = useRef(0);

  const load = useCallback(async (nextRole: Role) => {
    const version = ++requestVersion.current;
    setLoading(true);
    setError(null);
    try {
      const nextState = await getTimetableState(nextRole);
      if (version !== requestVersion.current) return;
      setState(nextState);
      const viewer = nextState.members.find((member) => member.role === nextRole);
      if (viewer) setSelectedAgentId(viewer.id);
    } catch (caught: unknown) {
      if (version === requestVersion.current) {
        setError(apiMessage(caught, "家庭日程暂时无法加载。"));
      }
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const version = ++requestVersion.current;

    void getTimetableState(role)
      .then((nextState) => {
        if (cancelled || version !== requestVersion.current) return;
        setState(nextState);
        const nextViewer = nextState.members.find((member) => member.role === role);
        if (nextViewer) setSelectedAgentId(nextViewer.id);
      })
      .catch((caught: unknown) => {
        if (!cancelled && version === requestVersion.current) {
          setError(apiMessage(caught, "家庭日程暂时无法加载。"));
        }
      })
      .finally(() => {
        if (!cancelled && version === requestVersion.current) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [role]);

  const days = useMemo(() => (state ? weekDays(state.now) : []), [state]);
  const filteredItems = useMemo(() => {
    if (!state) return [];
    return state.timetableItems.filter(
      (item) =>
        (memberFilter === null || item.ownerId === memberFilter) &&
        (categoryFilter === null || item.category === categoryFilter),
    );
  }, [categoryFilter, memberFilter, state]);
  const selectedItem = filteredItems.find(({ id }) => id === selectedItemId) ?? null;
  const selectedAgent = state?.members.find(({ id }) => id === selectedAgentId) ?? state?.members[0];
  const viewer = state?.members.find((member) => member.role === role);

  async function runAction(
    label: string,
    action: Parameters<typeof postTimetableAction>[1],
  ): Promise<boolean> {
    const version = requestVersion.current;
    setPending(action.type === "complete_timetable_item" ? action.itemId : action.type);
    setError(null);
    setNotice(null);
    try {
      const nextState = await postTimetableAction(role, action);
      if (version !== requestVersion.current) return false;
      setState(nextState);
      setNotice(label);
      return true;
    } catch (caught: unknown) {
      if (version === requestVersion.current) {
        setError(apiMessage(caught, "日程操作没有完成。"));
      }
      return false;
    } finally {
      if (version === requestVersion.current) setPending(null);
    }
  }

  async function sendAgentQuery(nextMessage: string, intentHint?: AgentIntent) {
    const trimmed = nextMessage.trim();
    if (!selectedAgent || trimmed.length === 0) return;
    const version = requestVersion.current;
    const targetMemberId = selectedAgent.id;
    setPending("agent");
    setError(null);
    setAgentResponse(null);
    try {
      const response = await queryMemberAgent(role, {
        targetMemberId,
        message: trimmed,
        ...(intentHint ? { intentHint } : {}),
      });
      if (version !== requestVersion.current) return;
      setAgentResponse(response);
      setMessage("");
    } catch (caught: unknown) {
      if (version === requestVersion.current) {
        setError(apiMessage(caught, "成员 Agent 暂时无法回答。"));
      }
    } finally {
      if (version === requestVersion.current) setPending(null);
    }
  }

  function submitAgent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendAgentQuery(message);
  }

  async function submitItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const domainId = String(form.get("domainId") ?? "");
    let startsAt: string;
    try {
      startsAt = serializeShanghaiDateTimeLocal(String(form.get("startsAt") ?? ""));
    } catch (caught: unknown) {
      setError(apiMessage(caught, "请选择有效的开始时间。"));
      return;
    }
    const created = await runAction("日程已添加，并同步到本周安排。", {
      type: "create_timetable_item",
      ownerId: String(form.get("ownerId") ?? ""),
      title: String(form.get("title") ?? "").trim(),
      startsAt,
      durationMinutes: Number(form.get("durationMinutes")),
      category: String(form.get("category")) as TimetableCategory,
      ...(domainId ? { domainId } : {}),
    });
    if (created) formElement.reset();
  }

  return (
    <main className="family-home" data-testid="family-home">
      <header className="family-header">
        <a className="family-brand" href="#timetable-heading" aria-label="跳到家庭日程">
          <Image src="/dujide-logo-roof-ink.svg" alt="" width={54} height={42} priority />
          <span>都记得<small>We Remember</small></span>
        </a>
        <p className="fixture-note"><strong>本地 Fixture</strong><span>确定性核心 · StepFun 可选文本改写</span></p>
        <Link className="demo-link" href="/demo" data-testid="open-demo">打开四分钟演示</Link>
      </header>

      <section className="home-role-switch" data-testid="role-switch" aria-label="切换当前查看角色">
        <span className="filter-label">当前身份</span>
        <div>
          {ROLES.map((item) => {
            const member = state?.members.find(({ role: memberRole }) => memberRole === item);
            return (
              <button
                key={item}
                type="button"
                aria-pressed={role === item}
                disabled={loading || pending !== null}
                onClick={() => {
                  if (role === item) return;
                  requestVersion.current += 1;
                  setLoading(true);
                  setError(null);
                  setState(null);
                  setRole(item);
                  setSelectedItemId(null);
                  setAgentResponse(null);
                  setNotice(null);
                }}
              >
                <strong>{member?.displayName ?? ROLE_FALLBACK[item].name}</strong>
                <small>{ROLE_FALLBACK[item].detail}</small>
              </button>
            );
          })}
        </div>
      </section>

      <div className="family-content" aria-busy={loading || pending !== null}>
        <div className="home-intro">
          <div>
            <p className="eyebrow">Family timetable · 7 days</p>
            <h1 id="timetable-heading">这一周，家里的事都在这里。</h1>
          </div>
          <p>日程是首页，成员 Agent 只从你当前可见的信息回答。新增和完成始终需要明确操作。</p>
        </div>

        {error ? (
          <div className="home-alert error" role="alert">
            <span>{error}</span>
            <button type="button" onClick={() => void load(role)}>重新加载</button>
          </div>
        ) : null}
        {notice ? <p className="home-alert" role="status">{notice}</p> : null}
        {loading && !state ? <div className="home-loading" role="status"><span aria-hidden="true" />正在读取家庭日程…</div> : null}

        {state?.role === role ? (
          <div className="home-layout">
            <section className="timetable-panel" aria-labelledby="week-title">
              <div className="panel-heading">
                <div><p className="eyebrow">{dayLabel(days[0] ?? "").date} — {dayLabel(days[6] ?? "").date}</p><h2 id="week-title">全家一周</h2></div>
                <span>{filteredItems.length} 项可见安排</span>
              </div>

              <div className="timetable-filters" aria-label="筛选家庭日程">
                <span className="filter-label">筛选</span>
                <button
                  type="button"
                  data-testid="timetable-filter-all"
                  aria-pressed={memberFilter === null && categoryFilter === null}
                  onClick={() => { setMemberFilter(null); setCategoryFilter(null); }}
                >全部</button>
                {state.members.map((member) => (
                  <button key={member.id} type="button" aria-pressed={memberFilter === member.id} onClick={() => setMemberFilter(memberFilter === member.id ? null : member.id)}>
                    {member.displayName}
                  </button>
                ))}
                {Object.entries(CATEGORY_LABELS).map(([category, label]) => (
                  <button key={category} type="button" aria-pressed={categoryFilter === category} onClick={() => setCategoryFilter(categoryFilter === category ? null : category as TimetableCategory)}>
                    {label}
                  </button>
                ))}
              </div>

              <div className="timetable-grid" data-testid="timetable-grid">
                {days.map((day) => {
                  const label = dayLabel(day);
                  const items = filteredItems
                    .filter((item) => shanghaiDay(item.startsAt) === day)
                    .sort((left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt));
                  return (
                    <section className="timetable-day" key={day} data-testid={`timetable-day-${day}`} aria-labelledby={`day-${day}`}>
                      <header><strong id={`day-${day}`}>{label.weekday}</strong><span>{label.date}</span></header>
                      <div className="day-items">
                        {items.map((item) => (
                          <button
                            className={`timetable-item category-${item.category} ${item.status === "completed" ? "is-completed" : ""}`}
                            key={item.id}
                            type="button"
                            data-testid={`timetable-item-${item.id}`}
                            aria-pressed={selectedItemId === item.id}
                            onClick={() => setSelectedItemId(item.id)}
                          >
                            <time dateTime={item.startsAt}>{timeLabel(item.startsAt)}</time>
                            <strong>{item.title}</strong>
                            <span>{memberName(state, item.ownerId)} · {CATEGORY_LABELS[item.category]} · {STATUS_LABELS[item.status]}</span>
                          </button>
                        ))}
                        {items.length === 0 ? <p className="day-empty">暂无安排</p> : null}
                      </div>
                    </section>
                  );
                })}
              </div>

              {filteredItems.length === 0 ? <p className="timetable-empty">当前筛选下没有安排。清除筛选即可回到全家一周。</p> : null}
              {selectedItem ? (
                <ItemDetail
                  item={selectedItem}
                  state={state}
                  pending={pending === selectedItem.id}
                  onComplete={() => void runAction("这项安排已完成。", { type: "complete_timetable_item", itemId: selectedItem.id })}
                />
              ) : null}
            </section>

            <aside className="agent-panel" aria-labelledby="agent-title">
              <div className="panel-heading agent-heading">
                <div><p className="eyebrow">Member Agents</p><h2 id="agent-title">问问家里人</h2></div>
                <span>只读</span>
              </div>
              <p className="agent-safety">选择成员不会扩大你的可见范围。回答来自当前角色投影，不保存对话。</p>
              <div className="member-agent-list" aria-label="选择成员 Agent">
                {state.members.map((member) => (
                  <button
                    key={member.id}
                    type="button"
                    data-testid={`member-agent-${member.id}`}
                    aria-pressed={selectedAgent?.id === member.id}
                    disabled={pending === "agent"}
                    onClick={() => { setSelectedAgentId(member.id); setAgentResponse(null); }}
                  >
                    <span aria-hidden="true">{member.displayName.slice(-1)}</span>
                    <strong>{member.displayName}</strong>
                    <small>的 Agent</small>
                  </button>
                ))}
              </div>

              <div className="quick-queries" aria-label="快捷提问">
                {QUICK_QUERIES.map((query) => (
                  <button key={query.intent} type="button" disabled={pending === "agent"} onClick={() => void sendAgentQuery(query.message, query.intent)}>{query.label}</button>
                ))}
              </div>

              <form className="agent-form" onSubmit={submitAgent}>
                <label htmlFor="agent-message">问{selectedAgent?.displayName ?? "成员"}的 Agent</label>
                <textarea
                  id="agent-message"
                  data-testid="agent-message"
                  value={message}
                  maxLength={240}
                  rows={3}
                  placeholder="例如：这周有哪些照护安排？"
                  onChange={(event) => setMessage(event.target.value)}
                />
                <div><small>{message.length}/240</small><button type="submit" data-testid="agent-send" disabled={pending === "agent" || message.trim().length === 0}>{pending === "agent" ? "正在查找…" : "发送只读查询"}</button></div>
              </form>

              <div className="agent-response" data-testid="agent-response" aria-live="polite">
                {agentResponse ? (
                  <><p>{agentResponse.text}</p><small>回答引擎：{agentResponse.engine === "stepfun" ? "StepFun" : "Fixture 意图路由器"} · {agentResponse.intent}</small></>
                ) : <p>可以查询日程、责任与照护信息。自由文本不会新增、完成或修改任何事项。</p>}
              </div>

              <AddItemForm key={`${state.role}:${selectedAgent?.id ?? ""}`} state={state} viewerId={viewer?.id ?? ""} selectedAgentId={selectedAgent?.id ?? ""} pending={pending === "create_timetable_item"} onSubmit={submitItem} />
            </aside>
          </div>
        ) : null}
      </div>
    </main>
  );
}

function ItemDetail({
  item,
  state,
  pending,
  onComplete,
}: {
  readonly item: TimetableItem;
  readonly state: TimetableProjection;
  readonly pending: boolean;
  readonly onComplete: () => void;
}) {
  const domain = state.domains.find(({ id }) => id === item.domainId);
  return (
    <article className="item-detail" aria-live="polite">
      <div><p className="eyebrow">安排详情</p><h3>{item.title}</h3></div>
      <dl>
        <div><dt>时间</dt><dd>{shanghaiDay(item.startsAt)} {timeLabel(item.startsAt)}–{timeLabel(item.endsAt)}</dd></div>
        <div><dt>负责人</dt><dd>{memberName(state, item.ownerId)}</dd></div>
        <div><dt>类别</dt><dd>{CATEGORY_LABELS[item.category]}</dd></div>
        <div><dt>责任域</dt><dd>{domain?.name ?? "未关联"}</dd></div>
      </dl>
      {item.status === "planned" ? (
        <button type="button" data-testid={`complete-item-${item.id}`} disabled={!item.canComplete || pending} onClick={onComplete}>
          {item.canComplete ? (pending ? "正在完成…" : "标记为完成") : "仅负责人可完成"}
        </button>
      ) : <span className="completed-label">已完成</span>}
    </article>
  );
}

function AddItemForm({
  state,
  viewerId,
  selectedAgentId,
  pending,
  onSubmit,
}: {
  readonly state: TimetableProjection;
  readonly viewerId: string;
  readonly selectedAgentId: string;
  readonly pending: boolean;
  readonly onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const ownerOptions = state.role === "subject" ? state.members.filter(({ id }) => id === viewerId) : state.members;
  const defaultOwner = ownerOptions.some(({ id }) => id === selectedAgentId) ? selectedAgentId : viewerId;
  const [ownerId, setOwnerId] = useState(defaultOwner);
  const [category, setCategory] = useState<TimetableCategory>("family");

  function selectOwner(nextOwnerId: string) {
    setOwnerId(nextOwnerId);
    if (nextOwnerId !== viewerId && category === "responsibility") {
      setCategory("family");
    }
  }

  return (
    <details className="add-item" open>
      <summary>添加一项明确安排</summary>
      <form data-testid="add-item-form" aria-label="添加家庭日程" onSubmit={onSubmit}>
        <label htmlFor="timetable-title">事项名称</label>
        <input id="timetable-title" name="title" required maxLength={80} placeholder="例如：晚间用药" />
        <div className="form-row">
          <label htmlFor="timetable-owner">负责人<select id="timetable-owner" name="ownerId" value={ownerId} required onChange={(event) => selectOwner(event.target.value)}>{ownerOptions.map((member) => <option key={member.id} value={member.id}>{member.displayName}</option>)}</select></label>
          <label htmlFor="timetable-category">类别<select id="timetable-category" name="category" value={category} onChange={(event) => setCategory(event.target.value as TimetableCategory)}><option value="family">家庭</option><option value="care">照护</option><option value="responsibility" disabled={ownerId !== viewerId}>责任</option></select></label>
        </div>
        <label htmlFor="timetable-start">开始时间</label>
        <input id="timetable-start" name="startsAt" type="datetime-local" min="2026-08-24T00:00" max="2026-08-30T23:45" aria-describedby="timetable-timezone" required />
        <small id="timetable-timezone">北京时间（UTC+8）</small>
        <div className="form-row">
          <label htmlFor="timetable-duration">时长<select id="timetable-duration" name="durationMinutes" defaultValue="30"><option value="15">15 分钟</option><option value="30">30 分钟</option><option value="60">1 小时</option><option value="120">2 小时</option></select></label>
          <label htmlFor="timetable-domain">责任域<select id="timetable-domain" name="domainId" defaultValue=""><option value="">不关联</option>{state.domains.map((domain) => <option key={domain.id} value={domain.id}>{domain.name}</option>)}</select></label>
        </div>
        <button type="submit" disabled={pending}>{pending ? "正在添加…" : "添加到日程"}</button>
      </form>
    </details>
  );
}
