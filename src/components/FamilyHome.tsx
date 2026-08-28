"use client";

import Image from "next/image";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

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
const QUICK_QUERIES: readonly { label: string; message: string; intent: AgentIntent }[] = [
  { label: "看日程", message: "这周有什么安排？", intent: "schedule" },
  { label: "看责任", message: "现在有哪些责任需要留意？", intent: "responsibilities" },
  { label: "看照护", message: "有哪些照护安排？", intent: "care" },
];

function isoDay(value: string): string {
  return value.slice(0, 10);
}

function addUtcDays(day: string, amount: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function weekDays(now: string): readonly string[] {
  const today = isoDay(now);
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
  const match = value.match(/T(\d{2}):(\d{2})/);
  return match ? `${match[1]}:${match[2]}` : value;
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

  const load = useCallback(async (nextRole: Role) => {
    setLoading(true);
    setError(null);
    try {
      const nextState = await getTimetableState(nextRole);
      setState(nextState);
      const viewer = nextState.members.find((member) => member.role === nextRole);
      if (viewer) setSelectedAgentId(viewer.id);
    } catch (caught: unknown) {
      setError(apiMessage(caught, "家庭日程暂时无法加载。"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    void getTimetableState(role)
      .then((nextState) => {
        if (cancelled) return;
        setState(nextState);
        const nextViewer = nextState.members.find((member) => member.role === role);
        if (nextViewer) setSelectedAgentId(nextViewer.id);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(apiMessage(caught, "家庭日程暂时无法加载。"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
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
  const selectedItem = state?.timetableItems.find(({ id }) => id === selectedItemId) ?? null;
  const selectedAgent = state?.members.find(({ id }) => id === selectedAgentId) ?? state?.members[0];
  const viewer = state?.members.find((member) => member.role === role);

  async function runAction(label: string, action: Parameters<typeof postTimetableAction>[1]) {
    setPending(action.type === "complete_timetable_item" ? action.itemId : action.type);
    setError(null);
    setNotice(null);
    try {
      setState(await postTimetableAction(role, action));
      setNotice(label);
    } catch (caught: unknown) {
      setError(apiMessage(caught, "日程操作没有完成。"));
    } finally {
      setPending(null);
    }
  }

  async function sendAgentQuery(nextMessage: string, intentHint?: AgentIntent) {
    const trimmed = nextMessage.trim();
    if (!selectedAgent || trimmed.length === 0) return;
    setPending("agent");
    setError(null);
    setAgentResponse(null);
    try {
      setAgentResponse(
        await queryMemberAgent(role, {
          targetMemberId: selectedAgent.id,
          message: trimmed,
          ...(intentHint ? { intentHint } : {}),
        }),
      );
      setMessage("");
    } catch (caught: unknown) {
      setError(apiMessage(caught, "成员 Agent 暂时无法回答。"));
    } finally {
      setPending(null);
    }
  }

  function submitAgent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendAgentQuery(message);
  }

  function submitItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const domainId = String(form.get("domainId") ?? "");
    void runAction("日程已添加，并同步到本周安排。", {
      type: "create_timetable_item",
      ownerId: String(form.get("ownerId") ?? ""),
      title: String(form.get("title") ?? "").trim(),
      startsAt: new Date(String(form.get("startsAt") ?? "")).toISOString(),
      durationMinutes: Number(form.get("durationMinutes")),
      category: String(form.get("category")) as TimetableCategory,
      ...(domainId ? { domainId } : {}),
    });
  }

  return (
    <main className="family-home" data-testid="family-home">
      <header className="family-header">
        <a className="family-brand" href="#timetable-heading" aria-label="跳到家庭日程">
          <Image src="/dujide-logo-roof-ink.svg" alt="" width={54} height={42} priority />
          <span>都记得<small>We Remember</small></span>
        </a>
        <p className="fixture-note"><strong>本地 Fixture</strong><span>确定性意图路由器 · 非实时大模型</span></p>
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
                disabled={loading}
                onClick={() => {
                  setLoading(true);
                  setError(null);
                  setRole(item);
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

        {state ? (
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
                    .filter((item) => isoDay(item.startsAt) === day)
                    .sort((left, right) => left.startsAt.localeCompare(right.startsAt));
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
                            <span>{memberName(state, item.ownerId)} · {CATEGORY_LABELS[item.category]}</span>
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
                  <><p>{agentResponse.text}</p><small>回答引擎：Fixture intent router · {agentResponse.intent}</small></>
                ) : <p>可以查询日程、责任与照护信息。自由文本不会新增、完成或修改任何事项。</p>}
              </div>

              <AddItemForm state={state} viewerId={viewer?.id ?? ""} selectedAgentId={selectedAgent?.id ?? ""} pending={pending === "create_timetable_item"} onSubmit={submitItem} />
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
        <div><dt>时间</dt><dd>{isoDay(item.startsAt)} {timeLabel(item.startsAt)}–{timeLabel(item.endsAt)}</dd></div>
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
  return (
    <details className="add-item" open>
      <summary>添加一项明确安排</summary>
      <form data-testid="add-item-form" onSubmit={onSubmit}>
        <label>事项名称<input name="title" required maxLength={80} placeholder="例如：晚间用药" /></label>
        <div className="form-row">
          <label>负责人<select name="ownerId" key={defaultOwner} defaultValue={defaultOwner} required>{ownerOptions.map((member) => <option key={member.id} value={member.id}>{member.displayName}</option>)}</select></label>
          <label>类别<select name="category" defaultValue="family"><option value="family">家庭</option><option value="care">照护</option><option value="responsibility">责任</option></select></label>
        </div>
        <label>开始时间<input name="startsAt" type="datetime-local" required /></label>
        <div className="form-row">
          <label>时长<select name="durationMinutes" defaultValue="30"><option value="15">15 分钟</option><option value="30">30 分钟</option><option value="60">1 小时</option><option value="120">2 小时</option></select></label>
          <label>责任域<select name="domainId" defaultValue=""><option value="">不关联</option>{state.domains.map((domain) => <option key={domain.id} value={domain.id}>{domain.name}</option>)}</select></label>
        </div>
        <button type="submit" disabled={pending}>{pending ? "正在添加…" : "添加到日程"}</button>
      </form>
    </details>
  );
}
