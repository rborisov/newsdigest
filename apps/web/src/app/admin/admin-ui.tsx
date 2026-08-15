"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { SiteHeader } from "@/app/site-header";
import { SignOutButton } from "@/app/sign-out-button";
import { GenerateButton } from "@/app/generate-button";
import { describeHumanSchedule } from "@/lib/schedule-human";

type AllowedUserRow = {
  id: string;
  email: string;
  isAdmin: boolean;
};

type TopicSourceRow = {
  id: string;
  kind: "web" | "telegram";
  enabled: boolean;
  sortOrder: number;
  config: { keywords?: string; peers?: string[]; lookbackHours?: number | null };
  connectionId: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
};

type TopicRow = {
  id: string;
  name: string;
  keywords: string;
  enabled: boolean;
  sortOrder: number;
  scheduleId: string | null;
  sources: TopicSourceRow[];
};

type ScheduleRow = {
  id: string;
  name: string;
  cronExpr: string;
  timezone: string;
  enabled: boolean;
  isDefault: boolean;
  recurrence: string;
  timeOfDay: string;
  weekday: number | null;
  intervalHours: number | null;
  periodHours: number | null;
};

type PromptConfigRow = {
  template: string;
  periodHours: number;
  boardStaleDays: number;
  displayTimezone: string;
  language: string;
  reviewTemplate: string;
};

type TelegraphMetaRow = {
  accessTokenConfigured: boolean;
  authorName: string;
  authorUrl: string;
};

type SocialConnectionRow = {
  provider: string;
  status: string;
  displayName: string;
  externalId: string;
  lastError: string | null;
  linkedAt: string | null;
  linkStep: "awaiting_code" | "awaiting_password" | null;
  isCodeViaApp: boolean | null;
  passwordHint: string | null;
};

type AboutPageRow = {
  enabledEn: boolean;
  enabledRu: boolean;
  footerLabelEn: string;
  footerLabelRu: string;
  pageTitleEn: string;
  pageTitleRu: string;
  leadEn: string;
  leadRu: string;
  productEn: string;
  productRu: string;
  outlookEn: string;
  outlookRu: string;
  collaborationEn: string;
  collaborationRu: string;
};

export type GenerationStepRow = {
  id: string;
  kind: string;
  status: string;
  sortOrder: number;
  topicName: string | null;
  error: string | null;
  updatedAt: string;
  logTail?: string;
};

export type GenerationJobRow = {
  id: string;
  status: string;
  triggerType: string;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  publishedPage: { title: string; telegraphUrl: string } | null;
  elapsedSec?: number;
  idleSec?: number;
  logTail?: string;
  hasLog?: boolean;
  steps?: GenerationStepRow[];
  activeStepLog?: string;
};

export type AdminInitialData = {
  signedInEmail: string;
  users: AllowedUserRow[];
  topics: TopicRow[];
  schedules: ScheduleRow[];
  prompt: PromptConfigRow;
  about: AboutPageRow;
  telegraph: TelegraphMetaRow;
  cursorApiKeyConfigured: boolean;
  telegramApiConfigured: boolean;
  telegramApiId: number | null;
  telegramConnection: SocialConnectionRow;
  jobs: GenerationJobRow[];
};

const sectionStyle = { marginBottom: "2.5rem" };
const headingStyle = { fontSize: "1.125rem", marginBottom: "0.75rem" };
const fieldStyle = { display: "flex", flexDirection: "column" as const, gap: "0.25rem" };
const inputStyle = { padding: "0.375rem 0.5rem", font: "inherit" };
const buttonStyle = { padding: "0.375rem 0.75rem", font: "inherit", cursor: "pointer" };
const tableStyle = { width: "100%", borderCollapse: "collapse" as const, marginTop: "0.75rem" };
const cellStyle = { borderBottom: "1px solid #ddd", padding: "0.5rem 0.25rem", textAlign: "left" as const };
const messageStyle = { color: "#666", fontSize: "0.875rem", marginTop: "0.5rem" };
const errorStyle = { color: "#b00020", fontSize: "0.875rem", marginTop: "0.5rem" };

async function adminFetch(
  path: string,
  init?: RequestInit,
): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });

  const data = (await response.json().catch(() => ({}))) as { error?: string };

  if (!response.ok) {
    return { ok: false, error: data.error ?? `Request failed (${response.status})` };
  }

  return { ok: true, data };
}

function StatusMessage({ message, error }: { message?: string; error?: string }) {
  if (error) {
    return <p style={errorStyle}>{error}</p>;
  }
  if (message) {
    return <p style={messageStyle}>{message}</p>;
  }
  return null;
}

function formatJobTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function formatElapsed(totalSec: number | undefined): string {
  if (totalSec == null || Number.isNaN(totalSec)) {
    return "—";
  }
  const sec = Math.max(0, totalSec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) {
    return `${h}h ${m}m`;
  }
  if (m > 0) {
    return `${m}m ${s}s`;
  }
  return `${s}s`;
}

function shortJobId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}…` : id;
}

function stepLabel(step: GenerationStepRow): string {
  if (step.kind === "topic_publish") {
    return step.topicName ? `publish: ${step.topicName}` : "topic publish";
  }
  if (step.kind === "topic_draft") {
    return step.topicName ? `draft: ${step.topicName}` : "topic draft";
  }
  if (step.kind === "merge_publish") {
    return "merge → publish";
  }
  return step.topicName ?? step.kind;
}

function JobsSection({ initialJobs }: { initialJobs: GenerationJobRow[] }) {
  const [jobs, setJobs] = useState(initialJobs);
  const [error, setError] = useState<string>();
  const [refreshing, setRefreshing] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [autoOpened, setAutoOpened] = useState(false);
  const [logStepId, setLogStepId] = useState<string | "parent" | null>(null);

  const loadJobs = useCallback(async () => {
    setRefreshing(true);
    const result = await adminFetch("/api/admin/jobs");
    setRefreshing(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(undefined);
    const data = result.data as { jobs?: GenerationJobRow[] };
    setJobs(data.jobs ?? []);
  }, []);

  useEffect(() => {
    setJobs(initialJobs);
  }, [initialJobs]);

  useEffect(() => {
    const hasActive = jobs.some((job) => job.status === "pending" || job.status === "running");
    const intervalMs = hasActive ? 5_000 : 30_000;
    const timer = window.setInterval(() => {
      void loadJobs();
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [jobs, loadJobs]);

  useEffect(() => {
    if (autoOpened) {
      return;
    }
    const active = jobs.find((job) => job.status === "pending" || job.status === "running");
    if (active) {
      setExpandedId(active.id);
      const running = active.steps?.find((step) => step.status === "running");
      setLogStepId(running?.id ?? "parent");
      setAutoOpened(true);
    }
  }, [jobs, autoOpened]);

  return (
    <section style={sectionStyle}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
        <h2 style={{ ...headingStyle, marginBottom: 0 }}>Generation jobs</h2>
        <div style={{ display: "flex", alignItems: "center", gap: "0.65rem", flexWrap: "wrap" }}>
          <GenerateButton onTriggered={() => void loadJobs()} />
          <button type="button" className="btn" onClick={() => void loadJobs()} disabled={refreshing}>
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>
      <p style={messageStyle}>
        Auto-refreshes every 5s while a job is pending/running, otherwise every 30s. Each Generate runs
        one publish step per enabled topic. Expand a job for step status and logs. Server:{" "}
        <code>tail -f /opt/newsdigest/data/logs/&lt;jobId&gt;[-step-&lt;stepId&gt;].log</code>
      </p>
      <StatusMessage error={error} />
      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={cellStyle}>Status</th>
            <th style={cellStyle}>Job</th>
            <th style={cellStyle}>Trigger</th>
            <th style={cellStyle}>Elapsed</th>
            <th style={cellStyle}>Created</th>
            <th style={cellStyle}>Digest / error</th>
          </tr>
        </thead>
        <tbody>
          {jobs.length === 0 ? (
            <tr>
              <td colSpan={6} style={cellStyle}>
                No generation jobs yet.
              </td>
            </tr>
          ) : (
            jobs.map((job) => {
              const open = expandedId === job.id;
              const steps = job.steps ?? [];
              const doneCount = steps.filter((step) => step.status === "completed").length;
              const selectedLogId = open ? (logStepId ?? "parent") : null;
              const selectedStep =
                selectedLogId && selectedLogId !== "parent"
                  ? steps.find((step) => step.id === selectedLogId)
                  : null;
              const logText =
                selectedLogId === "parent"
                  ? job.logTail
                  : selectedStep?.logTail || job.activeStepLog || "";

              return (
                <Fragment key={job.id}>
                  <tr>
                    <td style={cellStyle}>
                      <code>{job.status}</code>
                      {steps.length > 0 ? (
                        <span style={{ color: "#666", marginLeft: "0.35rem", fontSize: "0.75rem" }}>
                          {doneCount}/{steps.length} steps
                        </span>
                      ) : null}
                      {job.status === "running" || job.status === "pending" ? (
                        <span style={{ color: "#666", marginLeft: "0.35rem", fontSize: "0.75rem" }}>
                          (idle {formatElapsed(job.idleSec)})
                        </span>
                      ) : null}
                    </td>
                    <td style={cellStyle}>
                      <button
                        type="button"
                        style={{ ...buttonStyle, padding: "0.125rem 0.375rem" }}
                        title={job.id}
                        onClick={() => {
                          if (open) {
                            setExpandedId(null);
                            return;
                          }
                          setExpandedId(job.id);
                          const running = steps.find((step) => step.status === "running");
                          setLogStepId(running?.id ?? "parent");
                        }}
                      >
                        {open ? "▼" : "▶"} {shortJobId(job.id)}
                      </button>
                    </td>
                    <td style={cellStyle}>{job.triggerType}</td>
                    <td style={cellStyle}>{formatElapsed(job.elapsedSec)}</td>
                    <td style={cellStyle}>{formatJobTime(job.createdAt)}</td>
                    <td style={cellStyle}>
                      {job.publishedPage ? (
                        <a href={job.publishedPage.telegraphUrl} target="_blank" rel="noopener noreferrer">
                          {job.publishedPage.title}
                        </a>
                      ) : job.error ? (
                        <span style={{ color: "#b00020" }}>{job.error}</span>
                      ) : job.status === "running" || job.status === "pending" ? (
                        <button
                          type="button"
                          style={{ ...buttonStyle, fontSize: "0.75rem", color: "#b00020" }}
                          onClick={async () => {
                            const result = await adminFetch(`/api/admin/jobs/${job.id}/cancel`, {
                              method: "POST",
                            });
                            if (!result.ok) {
                              setError(result.error);
                              return;
                            }
                            setError(undefined);
                            await loadJobs();
                          }}
                        >
                          Cancel / unlock Generate
                        </button>
                      ) : job.hasLog ? (
                        <span style={{ color: "#666" }}>log available</span>
                      ) : (
                        <span style={{ color: "#666" }}>—</span>
                      )}
                    </td>
                  </tr>
                  {open ? (
                    <tr>
                      <td colSpan={6} style={{ ...cellStyle, background: "#f7f7f7" }}>
                        {steps.length > 0 ? (
                          <div style={{ marginBottom: "0.75rem" }}>
                            <div style={{ fontSize: "0.8rem", marginBottom: "0.35rem", color: "#444" }}>
                              Steps
                            </div>
                            <ul style={{ margin: 0, paddingLeft: "1.1rem", fontSize: "0.85rem" }}>
                              {steps.map((step) => (
                                <li key={step.id} style={{ marginBottom: "0.25rem" }}>
                                  <button
                                    type="button"
                                    style={{
                                      ...buttonStyle,
                                      padding: "0.05rem 0.35rem",
                                      marginRight: "0.35rem",
                                      fontSize: "0.75rem",
                                    }}
                                    onClick={() => setLogStepId(step.id)}
                                  >
                                    log
                                  </button>
                                  <code>{step.status}</code> — {stepLabel(step)}
                                  {step.error ? (
                                    <span style={{ color: "#b00020" }}> — {step.error}</span>
                                  ) : null}
                                </li>
                              ))}
                            </ul>
                            <button
                              type="button"
                              style={{ ...buttonStyle, marginTop: "0.5rem", fontSize: "0.75rem" }}
                              onClick={() => setLogStepId("parent")}
                            >
                              Parent job log
                            </button>
                          </div>
                        ) : null}
                        <pre
                          style={{
                            margin: 0,
                            maxHeight: "16rem",
                            overflow: "auto",
                            fontSize: "0.75rem",
                            whiteSpace: "pre-wrap",
                            wordBreak: "break-word",
                          }}
                        >
                          {logText?.trim()
                            ? logText
                            : job.status === "running" || job.status === "pending"
                              ? "(no log lines yet — new jobs write heartbeats every 15s even when Cursor is quiet.)"
                              : "(no agent log for this job)"}
                        </pre>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })
          )}
        </tbody>
      </table>
    </section>
  );
}

function PeopleSection({ initialUsers }: { initialUsers: AllowedUserRow[] }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  async function handleAdd(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setMessage(undefined);
    setError(undefined);

    const result = await adminFetch("/api/admin/users", {
      method: "POST",
      body: JSON.stringify({ email, isAdmin }),
    });

    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }

    setEmail("");
    setIsAdmin(false);
    setMessage("User added.");
    router.refresh();
  }

  async function toggleAdmin(user: AllowedUserRow) {
    setMessage(undefined);
    setError(undefined);

    const result = await adminFetch("/api/admin/users", {
      method: "PATCH",
      body: JSON.stringify({ id: user.id, isAdmin: !user.isAdmin }),
    });

    if (!result.ok) {
      setError(result.error);
      return;
    }

    setMessage(user.isAdmin ? "Admin role removed." : "Admin role granted.");
    router.refresh();
  }

  async function removeUser(user: AllowedUserRow) {
    if (!window.confirm(`Remove ${user.email}?`)) {
      return;
    }

    setMessage(undefined);
    setError(undefined);

    const result = await adminFetch("/api/admin/users", {
      method: "DELETE",
      body: JSON.stringify({ id: user.id }),
    });

    if (!result.ok) {
      setError(result.error);
      return;
    }

    setMessage("User removed.");
    router.refresh();
  }

  return (
    <section style={sectionStyle}>
      <h2 style={headingStyle}>People</h2>
      <p style={messageStyle}>Manage allowlisted sign-in emails and admin roles.</p>

      <form onSubmit={handleAdd} style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "end", marginTop: "1rem" }}>
        <label style={fieldStyle}>
          Email
          <input
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            style={inputStyle}
          />
        </label>
        <label style={{ ...fieldStyle, flexDirection: "row", alignItems: "center", gap: "0.375rem" }}>
          <input
            type="checkbox"
            checked={isAdmin}
            onChange={(event) => setIsAdmin(event.target.checked)}
          />
          Admin
        </label>
        <button type="submit" disabled={pending} style={buttonStyle}>
          Add user
        </button>
      </form>

      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={cellStyle}>Email</th>
            <th style={cellStyle}>Admin</th>
            <th style={cellStyle}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {initialUsers.map((user) => (
            <tr key={user.id}>
              <td style={cellStyle}>{user.email}</td>
              <td style={cellStyle}>{user.isAdmin ? "Yes" : "No"}</td>
              <td style={cellStyle}>
                <button type="button" style={buttonStyle} onClick={() => toggleAdmin(user)}>
                  {user.isAdmin ? "Remove admin" : "Make admin"}
                </button>{" "}
                <button type="button" style={buttonStyle} onClick={() => removeUser(user)}>
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <StatusMessage message={message} error={error} />
    </section>
  );
}

function PromptSection({ initialPrompt }: { initialPrompt: PromptConfigRow }) {
  const router = useRouter();
  const [template, setTemplate] = useState(initialPrompt.template);
  const [periodHours, setPeriodHours] = useState(String(initialPrompt.periodHours));
  const [boardStaleDays, setBoardStaleDays] = useState(String(initialPrompt.boardStaleDays));
  const [displayTimezone, setDisplayTimezone] = useState(initialPrompt.displayTimezone || "UTC");
  const [language, setLanguage] = useState(initialPrompt.language || "English");
  const [reviewTemplate, setReviewTemplate] = useState(initialPrompt.reviewTemplate || "");
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setMessage(undefined);
    setError(undefined);

    const result = await adminFetch("/api/admin/prompt", {
      method: "PATCH",
      body: JSON.stringify({
        template,
        periodHours: Number(periodHours),
        boardStaleDays: Number(boardStaleDays),
        displayTimezone,
        language,
        reviewTemplate,
      }),
    });

    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }

    setMessage("Prompt saved.");
    router.refresh();
  }

  return (
    <section style={sectionStyle}>
      <h2 style={headingStyle}>Prompt &amp; period</h2>
      <p style={messageStyle}>
        Placeholders: {"{{TOPICS}}"}, {"{{PERIOD_HOURS}}"}, {"{{DATE}}"}, {"{{LANGUAGE}}"},{" "}
        {"{{EXCLUDE_STORIES}}"}
      </p>

      <form onSubmit={handleSave} style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginTop: "1rem" }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
          <label style={fieldStyle}>
            Default lookback (hours)
            <input
              type="number"
              min={1}
              max={168}
              required
              value={periodHours}
              onChange={(event) => setPeriodHours(event.target.value)}
              style={{ ...inputStyle, maxWidth: "8rem" }}
            />
            <span style={{ color: "#666", fontSize: "0.85rem" }}>
              Used when a schedule has no lookback of its own.
            </span>
          </label>
          <label style={fieldStyle}>
            Board stale days (0 = show all cached topics)
            <input
              type="number"
              min={0}
              max={365}
              required
              value={boardStaleDays}
              onChange={(event) => setBoardStaleDays(event.target.value)}
              style={{ ...inputStyle, maxWidth: "8rem" }}
            />
          </label>
          <label style={fieldStyle}>
            Display timezone (IANA)
            <input
              required
              value={displayTimezone}
              onChange={(event) => setDisplayTimezone(event.target.value)}
              placeholder="Europe/Moscow"
              style={{ ...inputStyle, minWidth: "12rem" }}
            />
          </label>
          <label style={fieldStyle}>
            Language ({"{{LANGUAGE}}"})
            <input
              required
              value={language}
              onChange={(event) => setLanguage(event.target.value)}
              placeholder="Russian"
              style={{ ...inputStyle, minWidth: "10rem" }}
            />
          </label>
        </div>
        <label style={fieldStyle}>
          Prompt template
          <textarea
            required
            rows={12}
            value={template}
            onChange={(event) => setTemplate(event.target.value)}
            style={{ ...inputStyle, fontFamily: "monospace", width: "100%" }}
          />
        </label>
        <label style={fieldStyle}>
          Review prompt template
          <textarea
            required
            rows={10}
            value={reviewTemplate}
            onChange={(event) => setReviewTemplate(event.target.value)}
            style={{ ...inputStyle, fontFamily: "monospace", width: "100%" }}
          />
          <span style={{ color: "#666", fontSize: "0.85rem" }}>
            Placeholders: {"{{STORY_ID}}"}, {"{{STORY_TITLE}}"}, {"{{STORY_URL}}"}, {"{{TOPIC_NAME}}"},{" "}
            {"{{LANGUAGE}}"}, {"{{DATE}}"}
          </span>
        </label>
        <button type="submit" disabled={pending} style={{ ...buttonStyle, alignSelf: "start" }}>
          Save prompt
        </button>
      </form>

      <StatusMessage message={message} error={error} />
    </section>
  );
}

const WEEKDAY_OPTIONS = [
  { value: 0, label: "Sunday" },
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
] as const;

function scheduleLabel(schedules: ScheduleRow[], scheduleId: string | null): string {
  if (!scheduleId) {
    const def = schedules.find((s) => s.isDefault);
    return def ? `Default (${def.name})` : "Default";
  }
  const match = schedules.find((s) => s.id === scheduleId);
  return match?.name ?? "Unknown schedule";
}

function defaultTopicSources(): TopicSourceRow[] {
  return [
    {
      id: `new-web`,
      kind: "web",
      enabled: true,
      sortOrder: 0,
      config: { keywords: "" },
      connectionId: null,
      lastSyncAt: null,
      lastError: null,
    },
  ];
}

function sourcesFromTopic(topic: TopicRow): TopicSourceRow[] {
  if (topic.sources?.length) {
    return topic.sources.map((source) => ({
      ...source,
      config:
        source.kind === "telegram"
          ? {
              peers: source.config.peers ?? [],
              lookbackHours: source.config.lookbackHours ?? null,
            }
          : { keywords: source.config.keywords ?? topic.keywords },
    }));
  }
  return [
    {
      id: `legacy-web-${topic.id}`,
      kind: "web",
      enabled: true,
      sortOrder: 0,
      config: { keywords: topic.keywords },
      connectionId: null,
      lastSyncAt: null,
      lastError: null,
    },
  ];
}

function sourcesPayload(sources: TopicSourceRow[]) {
  return sources.map((source, index) =>
    source.kind === "telegram"
      ? {
          kind: "telegram" as const,
          enabled: source.enabled,
          sortOrder: index,
          config: {
            peers: source.config.peers ?? [],
            lookbackHours: source.config.lookbackHours ?? null,
          },
        }
      : {
          kind: "web" as const,
          enabled: source.enabled,
          sortOrder: index,
          config: { keywords: source.config.keywords ?? "" },
        },
  );
}

function TopicsSection({
  initialTopics,
  schedules,
  leaveGuardRef,
}: {
  initialTopics: TopicRow[];
  schedules: ScheduleRow[];
  leaveGuardRef?: { current: (() => Promise<boolean>) | null };
}) {
  const router = useRouter();
  const initialSources =
    initialTopics[0] != null ? sourcesFromTopic(initialTopics[0]) : defaultTopicSources();
  const initialForm =
    initialTopics[0] != null
      ? {
          name: initialTopics[0].name,
          sortOrder: String(initialTopics[0].sortOrder),
          scheduleId: initialTopics[0].scheduleId ?? "",
          sourcesJson: JSON.stringify(sourcesPayload(initialSources)),
        }
      : {
          name: "",
          sortOrder: "0",
          scheduleId: "",
          sourcesJson: JSON.stringify(sourcesPayload(defaultTopicSources())),
        };

  const [topics, setTopics] = useState(initialTopics);
  const [selection, setSelection] = useState<"new" | string>(
    initialTopics[0]?.id ?? "new",
  );
  const [name, setName] = useState(initialForm.name);
  const [sources, setSources] = useState<TopicSourceRow[]>(initialSources);
  const [sortOrder, setSortOrder] = useState(initialForm.sortOrder);
  const [scheduleId, setScheduleId] = useState(initialForm.scheduleId);
  const [baseline, setBaseline] = useState(initialForm);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const [fieldError, setFieldError] = useState<string>();
  const [pending, setPending] = useState(false);
  const [generatePending, setGeneratePending] = useState(false);
  const [generateStatus, setGenerateStatus] = useState<string | null>(null);
  const [ingestPending, setIngestPending] = useState(false);
  const [ingestStatus, setIngestStatus] = useState<string | null>(null);
  const [ingestQualityFilter, setIngestQualityFilter] = useState<"kept" | "all">("kept");
  const [ingestItems, setIngestItems] = useState<
    Array<{
      id: string;
      kind: string;
      externalId: string;
      url: string | null;
      text: string;
      publishedAt: string | null;
      quality: string;
    }>
  >([]);
  const [ingestCounts, setIngestCounts] = useState<{
    total: number;
    kept: number;
    ads: number;
    fluff: number;
    question: number;
    other: number;
  } | null>(null);
  const [faqEnabled, setFaqEnabled] = useState(false);
  const [faqName, setFaqName] = useState("");
  const [faqKeywords, setFaqKeywords] = useState("");
  const [faqPrompt, setFaqPrompt] = useState("");
  const [faqSlug, setFaqSlug] = useState<string | null>(null);
  const [faqEntryCount, setFaqEntryCount] = useState(0);
  const [faqEntries, setFaqEntries] = useState<
    Array<{
      id: string;
      question: string;
      answer: string;
      lastConfirmedAt: string | null;
    }>
  >([]);
  const [faqPending, setFaqPending] = useState(false);
  const [faqStatus, setFaqStatus] = useState<string | null>(null);
  const [activeJob, setActiveJob] = useState<{ id: string; status: string } | null>(null);
  const [leaveTarget, setLeaveTarget] = useState<"new" | string | null>(null);
  const leaveDialogResolver = useRef<((ok: boolean) => void) | null>(null);

  useEffect(() => {
    setTopics(initialTopics);
  }, [initialTopics]);

  const selectedTopic = useMemo(
    () => (selection === "new" ? null : topics.find((topic) => topic.id === selection) ?? null),
    [selection, topics],
  );

  const sourcesJson = JSON.stringify(sourcesPayload(sources));
  const isDirty =
    name !== baseline.name ||
    sortOrder !== baseline.sortOrder ||
    scheduleId !== baseline.scheduleId ||
    sourcesJson !== baseline.sourcesJson;

  const emptyForm = useCallback(
    () => ({
      name: "",
      sortOrder: "0",
      scheduleId: "",
      sourcesJson: JSON.stringify(sourcesPayload(defaultTopicSources())),
    }),
    [],
  );

  const formFromTopic = useCallback((topic: TopicRow) => {
    const nextSources = sourcesFromTopic(topic);
    return {
      name: topic.name,
      sortOrder: String(topic.sortOrder),
      scheduleId: topic.scheduleId ?? "",
      sourcesJson: JSON.stringify(sourcesPayload(nextSources)),
      sources: nextSources,
    };
  }, []);

  const applySelection = useCallback(
    (next: "new" | string) => {
      setSelection(next);
      setMessage(undefined);
      setError(undefined);
      setFieldError(undefined);
      setGenerateStatus(null);
      setIngestStatus(null);
      setIngestItems([]);
      setIngestCounts(null);
      setFaqStatus(null);
      setFaqEnabled(false);
      setFaqName("");
      setFaqKeywords("");
      setFaqPrompt("");
      setFaqSlug(null);
      setFaqEntryCount(0);
      setFaqEntries([]);
      if (next === "new") {
        const form = emptyForm();
        const nextSources = defaultTopicSources();
        setName(form.name);
        setSources(nextSources);
        setSortOrder(form.sortOrder);
        setScheduleId(form.scheduleId);
        setBaseline(form);
        return;
      }
      const topic = topics.find((row) => row.id === next);
      if (!topic) {
        const form = emptyForm();
        const nextSources = defaultTopicSources();
        setSelection("new");
        setName(form.name);
        setSources(nextSources);
        setSortOrder(form.sortOrder);
        setScheduleId(form.scheduleId);
        setBaseline(form);
        return;
      }
      const form = formFromTopic(topic);
      setName(form.name);
      setSources(form.sources);
      setSortOrder(form.sortOrder);
      setScheduleId(form.scheduleId);
      setBaseline({
        name: form.name,
        sortOrder: form.sortOrder,
        scheduleId: form.scheduleId,
        sourcesJson: form.sourcesJson,
      });
    },
    [emptyForm, formFromTopic, topics],
  );

  useEffect(() => {
    if (selection === "new") {
      return;
    }
    if (!topics.some((row) => row.id === selection)) {
      applySelection(topics[0]?.id ?? "new");
    }
  }, [topics, selection, applySelection]);

  const refreshActiveJob = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/jobs");
      if (!response.ok) {
        return;
      }
      const data = (await response.json()) as { jobs?: { id: string; status: string }[] };
      const active =
        data.jobs?.find((job) => job.status === "pending" || job.status === "running") ?? null;
      setActiveJob(active);
      if (!active && generateStatus?.includes("in progress")) {
        setGenerateStatus(null);
      }
    } catch {
      // ignore polling errors
    }
  }, [generateStatus]);

  useEffect(() => {
    void refreshActiveJob();
  }, [refreshActiveJob]);

  useEffect(() => {
    if (!activeJob) {
      return;
    }
    const timer = window.setInterval(() => {
      void refreshActiveJob();
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [activeJob, refreshActiveJob]);

  useEffect(() => {
    if (!isDirty) {
      return;
    }
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isDirty]);

  function validateRequired(): string | null {
    if (!name.trim()) {
      return "Name is required.";
    }
    const enabled = sources.filter((source) => source.enabled);
    if (enabled.length === 0) {
      return "Enable at least one source.";
    }
    for (const source of enabled) {
      if (source.kind === "web" && !(source.config.keywords ?? "").trim()) {
        return "Enabled web sources need keywords / notes.";
      }
      if (source.kind === "telegram" && !(source.config.peers ?? []).length) {
        return "Enabled Telegram sources need at least one peer (e.g. Abkhaziaz).";
      }
    }
    return null;
  }

  async function saveCurrent(): Promise<boolean> {
    const validationError = validateRequired();
    if (validationError) {
      setFieldError(validationError);
      setError(undefined);
      setMessage(undefined);
      return false;
    }

    setPending(true);
    setMessage(undefined);
    setError(undefined);
    setFieldError(undefined);

    const payload = {
      name: name.trim(),
      sortOrder: Number(sortOrder),
      scheduleId: scheduleId || null,
      sources: sourcesPayload(sources),
    };

    const result =
      selection === "new"
        ? await adminFetch("/api/admin/topics", {
            method: "POST",
            body: JSON.stringify(payload),
          })
        : await adminFetch("/api/admin/topics", {
            method: "PATCH",
            body: JSON.stringify({ id: selection, ...payload }),
          });

    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return false;
    }

    const topic = (result.data as { topic?: TopicRow }).topic;
    if (topic) {
      const withSources: TopicRow = {
        ...topic,
        sources: topic.sources?.length ? topic.sources : sourcesFromTopic(topic),
      };
      setTopics((prev) => {
        const rest = prev.filter((row) => row.id !== withSources.id);
        return [...rest, withSources].sort(
          (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
        );
      });
      const form = formFromTopic(withSources);
      setSelection(withSources.id);
      setName(form.name);
      setSources(form.sources);
      setSortOrder(form.sortOrder);
      setScheduleId(form.scheduleId);
      setBaseline({
        name: form.name,
        sortOrder: form.sortOrder,
        scheduleId: form.scheduleId,
        sourcesJson: form.sourcesJson,
      });
      setMessage(selection === "new" ? "Topic added." : "Topic updated.");
    } else {
      setBaseline({
        name: payload.name,
        sortOrder: String(payload.sortOrder),
        scheduleId: payload.scheduleId ?? "",
        sourcesJson: JSON.stringify(payload.sources),
      });
      setMessage(selection === "new" ? "Topic added." : "Topic updated.");
    }
    router.refresh();
    return true;
  }

  function closeLeaveDialog(proceed: boolean) {
    const resolve = leaveDialogResolver.current;
    leaveDialogResolver.current = null;
    setLeaveTarget(null);
    resolve?.(proceed);
  }

  async function requestLeave(): Promise<boolean> {
    if (!isDirty) {
      return true;
    }
    if (leaveDialogResolver.current) {
      return false;
    }
    return await new Promise<boolean>((resolve) => {
      leaveDialogResolver.current = resolve;
      setLeaveTarget("__external__");
    });
  }

  async function navigateTo(next: "new" | string) {
    if (next === selection) {
      return;
    }
    if (!isDirty) {
      applySelection(next);
      return;
    }
    setLeaveTarget(next);
  }

  async function handleLeaveChoice(choice: "save" | "discard" | "stay") {
    const target = leaveTarget;
    if (choice === "stay" || target == null) {
      if (target === "__external__") {
        closeLeaveDialog(false);
      } else {
        setLeaveTarget(null);
      }
      return;
    }

    if (choice === "discard") {
      if (target === "__external__") {
        closeLeaveDialog(true);
        return;
      }
      applySelection(target);
      setLeaveTarget(null);
      return;
    }

    const saved = await saveCurrent();
    if (!saved) {
      if (target === "__external__") {
        closeLeaveDialog(false);
      }
      // Keep dialog closed on validation failure; errors show in the form.
      setLeaveTarget(null);
      return;
    }

    if (target === "__external__") {
      closeLeaveDialog(true);
      return;
    }
    applySelection(target);
    setLeaveTarget(null);
  }

  useEffect(() => {
    if (!leaveGuardRef) {
      return;
    }
    leaveGuardRef.current = () => requestLeave();
    return () => {
      leaveGuardRef.current = null;
    };
  });

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    await saveCurrent();
  }

  async function toggleEnabled(topic: TopicRow) {
    setMessage(undefined);
    setError(undefined);

    const result = await adminFetch("/api/admin/topics", {
      method: "PATCH",
      body: JSON.stringify({ id: topic.id, enabled: !topic.enabled }),
    });

    if (!result.ok) {
      setError(result.error);
      return;
    }

    setTopics((prev) =>
      prev.map((row) => (row.id === topic.id ? { ...row, enabled: !topic.enabled } : row)),
    );
    router.refresh();
  }

  async function removeTopic(topic: TopicRow) {
    if (!window.confirm(`Delete topic "${topic.name}"?`)) {
      return;
    }

    setMessage(undefined);
    setError(undefined);

    const result = await adminFetch("/api/admin/topics", {
      method: "DELETE",
      body: JSON.stringify({ id: topic.id }),
    });

    if (!result.ok) {
      setError(result.error);
      return;
    }

    const remaining = topics.filter((row) => row.id !== topic.id);
    setTopics(remaining);
    applySelection(remaining[0]?.id ?? "new");
    setMessage("Topic deleted.");
    router.refresh();
  }

  const loadIngestPreview = useCallback(async (topicId: string) => {
    const result = await adminFetch(`/api/admin/topics/${topicId}/ingest`);
    if (!result.ok) {
      setIngestStatus(result.error);
      return;
    }
    const data = result.data as {
      counts: {
        total: number;
        kept: number;
        ads: number;
        fluff: number;
        question: number;
        other: number;
      };
      items: Array<{
        id: string;
        kind: string;
        externalId: string;
        url: string | null;
        text: string;
        publishedAt: string | null;
        quality: string;
      }>;
    };
    setIngestCounts(data.counts);
    setIngestItems(data.items);
    setIngestStatus(null);
  }, []);

  const loadFaq = useCallback(async (topicId: string) => {
    const result = await adminFetch(`/api/admin/topics/${topicId}/faq`);
    if (!result.ok) {
      setFaqStatus(result.error);
      return;
    }
    const data = result.data as {
      faq: {
        enabled: boolean;
        name: string;
        keywords: string;
        promptTemplate: string;
        slug: string;
        entryCount: number;
      };
      entries: Array<{
        id: string;
        question: string;
        answer: string;
        lastConfirmedAt: string | null;
      }>;
    };
    setFaqEnabled(data.faq.enabled);
    setFaqName(data.faq.name);
    setFaqKeywords(data.faq.keywords);
    setFaqPrompt(data.faq.promptTemplate);
    setFaqSlug(data.faq.slug);
    setFaqEntryCount(data.faq.entryCount);
    setFaqEntries(data.entries ?? []);
    setFaqStatus(null);
  }, []);

  useEffect(() => {
    if (selection === "new") {
      return;
    }
    void loadIngestPreview(selection);
    void loadFaq(selection);
  }, [selection, loadIngestPreview, loadFaq]);

  async function saveFaq(topic: TopicRow) {
    setFaqPending(true);
    setFaqStatus(null);
    setError(undefined);
    const result = await adminFetch(`/api/admin/topics/${topic.id}/faq`, {
      method: "PATCH",
      body: JSON.stringify({
        enabled: faqEnabled,
        name: faqName,
        keywords: faqKeywords,
        promptTemplate: faqPrompt,
      }),
    });
    setFaqPending(false);
    if (!result.ok) {
      setFaqStatus(result.error);
      return;
    }
    const data = result.data as {
      faq: {
        enabled: boolean;
        name: string;
        keywords: string;
        promptTemplate: string;
        slug: string;
        entryCount: number;
      };
    };
    setFaqEnabled(data.faq.enabled);
    setFaqName(data.faq.name);
    setFaqKeywords(data.faq.keywords);
    setFaqPrompt(data.faq.promptTemplate);
    setFaqSlug(data.faq.slug);
    setFaqEntryCount(data.faq.entryCount);
    setFaqStatus(
      data.faq.enabled
        ? `FAQ saved. Public page: /faq/${data.faq.slug}`
        : "FAQ saved (disabled — not public yet).",
    );
    router.refresh();
  }

  async function refreshFaq(topic: TopicRow) {
    setFaqPending(true);
    setFaqStatus(null);
    setError(undefined);
    const result = await adminFetch(`/api/admin/topics/${topic.id}/faq/refresh`, {
      method: "POST",
    });
    setFaqPending(false);
    if (!result.ok) {
      setFaqStatus(result.error);
      return;
    }
    const data = result.data as { created?: number; skipped?: number; candidates?: number };
    setFaqStatus(
      `Refreshed FAQ: added ${data.created ?? 0}, skipped ${data.skipped ?? 0} duplicates (${data.candidates ?? 0} candidates).`,
    );
    await loadFaq(topic.id);
    router.refresh();
  }

  async function deleteFaqEntryRow(topic: TopicRow, entryId: string) {
    if (!window.confirm("Delete this FAQ entry?")) {
      return;
    }
    setFaqPending(true);
    setFaqStatus(null);
    const result = await adminFetch(`/api/admin/topics/${topic.id}/faq/entries/${entryId}`, {
      method: "DELETE",
    });
    setFaqPending(false);
    if (!result.ok) {
      setFaqStatus(result.error);
      return;
    }
    setFaqStatus("FAQ entry deleted.");
    await loadFaq(topic.id);
    router.refresh();
  }

  async function syncIngest(topic: TopicRow) {
    if (isDirty) {
      setIngestStatus("Save topic changes before syncing Telegram.");
      return;
    }
    const hasTelegram = (topic.sources ?? []).some(
      (source) => source.kind === "telegram" && source.enabled,
    );
    if (!hasTelegram) {
      setIngestStatus("Add an enabled Telegram source with peers first.");
      return;
    }
    setIngestPending(true);
    setIngestStatus(null);
    setError(undefined);
    const result = await adminFetch(`/api/admin/topics/${topic.id}/ingest`, { method: "POST" });
    setIngestPending(false);
    if (!result.ok) {
      setIngestStatus(result.error);
      return;
    }
    const data = result.data as {
      sync?: { keptTotal?: number; sources?: Array<{ error: string | null }> };
      kept?: number;
    };
    const errors = (data.sync?.sources ?? []).filter((source) => source.error).length;
    setIngestStatus(
      `Synced. Kept ${data.kept ?? data.sync?.keptTotal ?? 0} messages${
        errors ? ` (${errors} source error${errors === 1 ? "" : "s"})` : ""
      }. Review below before Generate.`,
    );
    await loadIngestPreview(topic.id);
    router.refresh();
  }

  async function generateTopic(topic: TopicRow) {
    if (activeJob || generatePending) {
      return;
    }
    if (isDirty) {
      setGenerateStatus("Save changes before generating.");
      return;
    }
    if (!topic.enabled) {
      setGenerateStatus("Enable the topic before generating.");
      return;
    }
    if (!topic.keywords.trim()) {
      const hasTelegram = (topic.sources ?? []).some(
        (source) => source.kind === "telegram" && source.enabled,
      );
      if (!hasTelegram) {
        setGenerateStatus("Add web keywords or an enabled Telegram source before generating.");
        return;
      }
    }

    setGeneratePending(true);
    setGenerateStatus(null);
    setError(undefined);

    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topicId: topic.id }),
      });
      const data = (await response.json()) as {
        message?: string;
        error?: string;
        jobId?: string;
      };

      if (!response.ok) {
        setGenerateStatus(data.error ?? "Generation failed.");
        await refreshActiveJob();
        return;
      }

      setGenerateStatus(data.message ?? "Topic generation triggered.");
      if (data.jobId) {
        setActiveJob({ id: data.jobId, status: "running" });
      } else {
        await refreshActiveJob();
      }
    } catch {
      setGenerateStatus("Generation failed.");
    } finally {
      setGeneratePending(false);
    }
  }

  const listItemStyle = (active: boolean): React.CSSProperties => ({
    display: "block",
    width: "100%",
    textAlign: "left",
    padding: "0.55rem 0.65rem",
    border: "none",
    borderLeft: active ? "3px solid #222" : "3px solid transparent",
    background: active ? "#f3f3f3" : "transparent",
    cursor: "pointer",
    font: "inherit",
  });

  const hasEnabledTelegram = (selectedTopic?.sources ?? []).some(
    (source) => source.kind === "telegram" && source.enabled,
  );
  const generateBlockedReason = selectedTopic
    ? isDirty
      ? "Save changes before generating."
      : !selectedTopic.enabled
        ? "Enable the topic before generating."
        : !selectedTopic.keywords.trim() && !hasEnabledTelegram
          ? "Add web keywords or an enabled Telegram source before generating."
          : hasEnabledTelegram && (ingestCounts?.kept ?? 0) === 0
            ? "Sync Telegram and review kept messages below before generating."
            : activeJob
              ? `Job ${activeJob.id} in progress…`
              : null
    : null;

  return (
    <section style={sectionStyle}>
      <h2 style={headingStyle}>Topics</h2>
      <p style={{ margin: "0.5rem 0 0", color: "#555", fontSize: "0.95rem" }}>
        Pick a topic to edit, or add a new one. For Telegram peers: Sync and review kept messages, then
        Generate (combined web + Telegram digest).
      </p>

      <div
        className="topics-master-detail"
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(12rem, 16rem) minmax(0, 1fr)",
          gap: "1.25rem",
          marginTop: "1rem",
          alignItems: "start",
        }}
      >
        <aside
          style={{
            border: "1px solid var(--line)",
            maxHeight: "32rem",
            overflow: "auto",
          }}
        >
          <button
            type="button"
            style={listItemStyle(selection === "new")}
            onClick={() => void navigateTo("new")}
          >
            + Add topic
          </button>
          {topics.length === 0 ? (
            <p style={{ margin: 0, padding: "0.65rem", color: "#666", fontSize: "0.9rem" }}>
              No topics yet.
            </p>
          ) : (
            topics.map((topic) => (
              <button
                key={topic.id}
                type="button"
                style={listItemStyle(selection === topic.id)}
                onClick={() => void navigateTo(topic.id)}
              >
                <span style={{ display: "block", fontWeight: selection === topic.id ? 600 : 400 }}>
                  {topic.name}
                </span>
                <span style={{ display: "block", color: "#666", fontSize: "0.8rem", marginTop: "0.15rem" }}>
                  {scheduleLabel(schedules, topic.scheduleId)}
                  {topic.enabled ? "" : " · disabled"}
                </span>
              </button>
            ))
          )}
        </aside>

        <div>
          <h3 style={{ ...headingStyle, marginTop: 0 }}>
            {selection === "new" ? "New topic" : selectedTopic?.name ?? "Topic"}
            {isDirty ? (
              <span style={{ marginLeft: "0.5rem", color: "#866", fontSize: "0.85rem", fontWeight: 400 }}>
                unsaved
              </span>
            ) : null}
          </h3>

          <form onSubmit={(event) => void handleSave(event)} style={{ display: "grid", gap: "0.75rem" }}>
            <label style={fieldStyle}>
              Name
              <input
                required
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  setFieldError(undefined);
                }}
                style={inputStyle}
              />
            </label>

            <div style={{ display: "grid", gap: "0.75rem" }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
                <strong style={{ fontSize: "0.95rem" }}>Sources</strong>
                <button
                  type="button"
                  style={buttonStyle}
                  disabled={pending}
                  onClick={() =>
                    setSources((prev) => [
                      ...prev,
                      {
                        id: `new-web-${prev.length}`,
                        kind: "web",
                        enabled: true,
                        sortOrder: prev.length,
                        config: { keywords: "" },
                        connectionId: null,
                        lastSyncAt: null,
                        lastError: null,
                      },
                    ])
                  }
                >
                  Add web
                </button>
                <button
                  type="button"
                  style={buttonStyle}
                  disabled={pending}
                  onClick={() =>
                    setSources((prev) => [
                      ...prev,
                      {
                        id: `new-tg-${prev.length}`,
                        kind: "telegram",
                        enabled: true,
                        sortOrder: prev.length,
                        config: { peers: [], lookbackHours: null },
                        connectionId: null,
                        lastSyncAt: null,
                        lastError: null,
                      },
                    ])
                  }
                >
                  Add Telegram
                </button>
              </div>

              {sources.map((source, index) => (
                <div
                  key={`${source.id}-${index}`}
                  style={{
                    border: "1px solid #ddd",
                    padding: "0.75rem",
                    display: "grid",
                    gap: "0.5rem",
                  }}
                >
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "center" }}>
                    <label style={{ display: "flex", gap: "0.35rem", alignItems: "center", fontSize: "0.9rem" }}>
                      <input
                        type="checkbox"
                        checked={source.enabled}
                        onChange={(event) => {
                          const enabled = event.target.checked;
                          setSources((prev) =>
                            prev.map((row, i) => (i === index ? { ...row, enabled } : row)),
                          );
                          setFieldError(undefined);
                        }}
                      />
                      Enabled
                    </label>
                    <span style={{ fontSize: "0.9rem", color: "#555" }}>
                      {source.kind === "web" ? "Web" : "Telegram"}
                    </span>
                    <button
                      type="button"
                      style={buttonStyle}
                      disabled={pending || sources.length <= 1}
                      onClick={() => {
                        setSources((prev) => prev.filter((_, i) => i !== index));
                        setFieldError(undefined);
                      }}
                    >
                      Remove
                    </button>
                  </div>

                  {source.kind === "web" ? (
                    <label style={fieldStyle}>
                      Keywords / topic notes
                      <textarea
                        value={source.config.keywords ?? ""}
                        onChange={(event) => {
                          const keywords = event.target.value;
                          setSources((prev) =>
                            prev.map((row, i) =>
                              i === index ? { ...row, config: { keywords } } : row,
                            ),
                          );
                          setFieldError(undefined);
                        }}
                        rows={6}
                        placeholder={"search terms…\nPrefer: …\nSkip: …"}
                        style={{
                          ...inputStyle,
                          width: "100%",
                          minHeight: "6rem",
                          resize: "vertical",
                          fontFamily: "inherit",
                          boxSizing: "border-box",
                        }}
                      />
                    </label>
                  ) : (
                    <label style={fieldStyle}>
                      Peers (one per line or comma-separated)
                      <textarea
                        value={(source.config.peers ?? []).join("\n")}
                        onChange={(event) => {
                          const peers = event.target.value
                            .split(/[\n,]+/)
                            .map((part) => part.trim())
                            .filter(Boolean);
                          setSources((prev) =>
                            prev.map((row, i) =>
                              i === index
                                ? {
                                    ...row,
                                    config: {
                                      peers,
                                      lookbackHours: row.config.lookbackHours ?? null,
                                    },
                                  }
                                : row,
                            ),
                          );
                          setFieldError(undefined);
                        }}
                        rows={4}
                        placeholder={"Abkhaziaz\n@SomeChannel"}
                        style={{
                          ...inputStyle,
                          width: "100%",
                          minHeight: "4.5rem",
                          resize: "vertical",
                          fontFamily: "inherit",
                          boxSizing: "border-box",
                        }}
                      />
                      <span style={{ color: "#666", fontSize: "0.85rem" }}>
                        Group/channel usernames. Use Sync Telegram below to fetch and review before Generate.
                        {source.lastSyncAt
                          ? ` Last sync: ${new Date(source.lastSyncAt).toLocaleString()}.`
                          : ""}
                        {source.lastError ? ` Last error: ${source.lastError}` : ""}
                      </span>
                    </label>
                  )}
                </div>
              ))}
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "end" }}>
              <label style={fieldStyle}>
                Sort order
                <input
                  type="number"
                  value={sortOrder}
                  onChange={(event) => setSortOrder(event.target.value)}
                  style={{ ...inputStyle, maxWidth: "6rem" }}
                />
              </label>
              <label style={{ ...fieldStyle, minWidth: "12rem", flex: 1 }}>
                Schedule
                <select
                  value={scheduleId}
                  onChange={(event) => setScheduleId(event.target.value)}
                  style={inputStyle}
                >
                  <option value="">Default schedule</option>
                  {schedules.map((schedule) => (
                    <option key={schedule.id} value={schedule.id}>
                      {schedule.name}
                      {schedule.isDefault ? " (default)" : ""}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
              <button type="submit" disabled={pending || !isDirty} style={buttonStyle}>
                {selection === "new" ? "Create topic" : "Save changes"}
              </button>
              {selectedTopic ? (
                <>
                  <button
                    type="button"
                    disabled={pending}
                    style={buttonStyle}
                    onClick={() => void toggleEnabled(selectedTopic)}
                  >
                    {selectedTopic.enabled ? "Disable" : "Enable"}
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    style={buttonStyle}
                    onClick={() => void removeTopic(selectedTopic)}
                  >
                    Delete
                  </button>
                  <button
                    type="button"
                    disabled={pending || ingestPending || isDirty}
                    style={buttonStyle}
                    title={isDirty ? "Save changes first" : undefined}
                    onClick={() => void syncIngest(selectedTopic)}
                  >
                    {ingestPending ? "Syncing…" : "Sync Telegram"}
                  </button>
                  <button
                    type="button"
                    disabled={Boolean(generateBlockedReason) || generatePending}
                    style={buttonStyle}
                    title={generateBlockedReason ?? undefined}
                    onClick={() => void generateTopic(selectedTopic)}
                  >
                    {generatePending || activeJob ? "Generating…" : "Generate this topic"}
                  </button>
                </>
              ) : null}
            </div>
          </form>

          {selectedTopic && hasEnabledTelegram ? (
            <div style={{ marginTop: "1.5rem", borderTop: "1px solid #ddd", paddingTop: "1rem" }}>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "0.75rem",
                  alignItems: "center",
                  marginBottom: "0.75rem",
                }}
              >
                <h3 style={{ ...headingStyle, margin: 0 }}>Telegram ingest</h3>
                <label style={{ fontSize: "0.9rem", display: "flex", gap: "0.35rem", alignItems: "center" }}>
                  Show
                  <select
                    value={ingestQualityFilter}
                    onChange={(event) => setIngestQualityFilter(event.target.value as "kept" | "all")}
                    style={inputStyle}
                  >
                    <option value="kept">kept only</option>
                    <option value="all">all qualities</option>
                  </select>
                </label>
                {ingestCounts ? (
                  <span style={{ color: "#666", fontSize: "0.85rem" }}>
                    kept {ingestCounts.kept} · ads {ingestCounts.ads} · fluff {ingestCounts.fluff} ·
                    questions {ingestCounts.question} · other {ingestCounts.other}
                  </span>
                ) : null}
              </div>
              {ingestStatus ? <p style={messageStyle}>{ingestStatus}</p> : null}
              {ingestItems.length === 0 ? (
                <p style={{ color: "#666", fontSize: "0.9rem" }}>
                  No ingest rows yet. Click Sync Telegram to fetch peers (requires a linked account under API
                  keys).
                </p>
              ) : (
                <ul
                  style={{
                    listStyle: "none",
                    margin: 0,
                    padding: 0,
                    maxHeight: "22rem",
                    overflow: "auto",
                    border: "1px solid #eee",
                  }}
                >
                  {ingestItems
                    .filter((item) =>
                      ingestQualityFilter === "kept" ? item.quality === "kept" : true,
                    )
                    .map((item) => {
                      const peer = item.externalId.split(":")[0] ?? "?";
                      return (
                        <li
                          key={item.id}
                          style={{
                            padding: "0.55rem 0.65rem",
                            borderBottom: "1px solid #f0f0f0",
                            fontSize: "0.88rem",
                          }}
                        >
                          <div style={{ color: "#666", marginBottom: "0.2rem" }}>
                            @{peer}
                            {item.publishedAt
                              ? ` · ${new Date(item.publishedAt).toLocaleString()}`
                              : ""}
                            {` · ${item.quality}`}
                            {item.url ? (
                              <>
                                {" · "}
                                <a href={item.url} target="_blank" rel="noreferrer">
                                  open
                                </a>
                              </>
                            ) : null}
                          </div>
                          <div style={{ whiteSpace: "pre-wrap" }}>
                            {item.text.trim() || "(empty / media-only)"}
                          </div>
                        </li>
                      );
                    })}
                </ul>
              )}
            </div>
          ) : null}

          {selectedTopic ? (
            <div style={{ marginTop: "1.5rem", borderTop: "1px solid #ddd", paddingTop: "1rem" }}>
              <h3 style={{ ...headingStyle, margin: "0 0 0.75rem" }}>Living FAQ</h3>
              <p style={{ color: "#666", fontSize: "0.9rem", marginTop: 0 }}>
                Builds Q&amp;A from Telegram ingest (question + kept messages). Enable to publish at{" "}
                {faqSlug ? (
                  <a href={`/faq/${faqSlug}`} target="_blank" rel="noreferrer">
                    /faq/{faqSlug}
                  </a>
                ) : (
                  "/faq/…"
                )}
                . Active entries: {faqEntryCount}.
              </p>
              <label
                style={{
                  display: "flex",
                  gap: "0.5rem",
                  alignItems: "center",
                  marginBottom: "0.75rem",
                }}
              >
                <input
                  type="checkbox"
                  checked={faqEnabled}
                  onChange={(event) => setFaqEnabled(event.target.checked)}
                />
                Enable public FAQ
              </label>
              <label style={fieldStyle}>
                FAQ name
                <input
                  type="text"
                  value={faqName}
                  onChange={(event) => setFaqName(event.target.value)}
                  style={inputStyle}
                />
              </label>
              <label style={fieldStyle}>
                FAQ keywords / themes
                <textarea
                  value={faqKeywords}
                  onChange={(event) => setFaqKeywords(event.target.value)}
                  rows={2}
                  placeholder="Optional themes to bias matching"
                  style={{
                    ...inputStyle,
                    width: "100%",
                    minHeight: "3rem",
                    resize: "vertical",
                    fontFamily: "inherit",
                    boxSizing: "border-box",
                  }}
                />
              </label>
              <label style={fieldStyle}>
                FAQ prompt (for future agent refresh)
                <textarea
                  value={faqPrompt}
                  onChange={(event) => setFaqPrompt(event.target.value)}
                  rows={5}
                  style={{
                    ...inputStyle,
                    width: "100%",
                    minHeight: "6rem",
                    resize: "vertical",
                    fontFamily: "inherit",
                    boxSizing: "border-box",
                  }}
                />
              </label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginTop: "0.5rem" }}>
                <button
                  type="button"
                  disabled={faqPending}
                  style={buttonStyle}
                  onClick={() => void saveFaq(selectedTopic)}
                >
                  {faqPending ? "Saving…" : "Save FAQ"}
                </button>
                <button
                  type="button"
                  disabled={faqPending}
                  style={buttonStyle}
                  onClick={() => void refreshFaq(selectedTopic)}
                >
                  Refresh from ingest
                </button>
              </div>
              {faqStatus ? <p style={messageStyle}>{faqStatus}</p> : null}
              <div style={{ marginTop: "1rem" }}>
                <h4 style={{ ...headingStyle, fontSize: "1rem", margin: "0 0 0.5rem" }}>
                  FAQ entries ({faqEntries.length})
                </h4>
                <p style={{ color: "#666", fontSize: "0.85rem", marginTop: 0 }}>
                  Refresh appends new rows; delete invalid ones. Same question may appear more than once.
                </p>
                {faqEntries.length === 0 ? (
                  <p style={{ color: "#666", fontSize: "0.9rem" }}>
                    No entries yet. Sync Telegram ingest, then Refresh from ingest.
                  </p>
                ) : (
                  <ul
                    style={{
                      listStyle: "none",
                      margin: 0,
                      padding: 0,
                      maxHeight: "22rem",
                      overflow: "auto",
                      border: "1px solid #eee",
                    }}
                  >
                    {faqEntries.map((entry) => (
                      <li
                        key={entry.id}
                        style={{
                          padding: "0.65rem 0.75rem",
                          borderBottom: "1px solid #f0f0f0",
                          fontSize: "0.88rem",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            gap: "0.75rem",
                            alignItems: "flex-start",
                          }}
                        >
                          <strong style={{ flex: 1 }}>{entry.question}</strong>
                          <button
                            type="button"
                            disabled={faqPending}
                            style={{ ...buttonStyle, padding: "0.25rem 0.5rem", fontSize: "0.8rem" }}
                            onClick={() => void deleteFaqEntryRow(selectedTopic, entry.id)}
                          >
                            Delete
                          </button>
                        </div>
                        <div style={{ whiteSpace: "pre-wrap", marginTop: "0.35rem" }}>{entry.answer}</div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ) : null}

          {leaveTarget != null ? (
            <div
              role="dialog"
              aria-label="Unsaved changes"
              style={{
                marginTop: "1rem",
                padding: "0.85rem 1rem",
                border: "1px solid #c9b48a",
                background: "#fff8ea",
              }}
            >
              <p style={{ margin: "0 0 0.75rem", fontSize: "0.95rem" }}>
                You have unsaved changes. Save them, discard them, or stay on this topic?
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                <button
                  type="button"
                  disabled={pending}
                  style={buttonStyle}
                  onClick={() => void handleLeaveChoice("save")}
                >
                  Save
                </button>
                <button
                  type="button"
                  disabled={pending}
                  style={buttonStyle}
                  onClick={() => void handleLeaveChoice("discard")}
                >
                  Discard
                </button>
                <button
                  type="button"
                  disabled={pending}
                  style={buttonStyle}
                  onClick={() => void handleLeaveChoice("stay")}
                >
                  Stay
                </button>
              </div>
            </div>
          ) : null}

          {fieldError ? <p style={errorStyle}>{fieldError}</p> : null}
          <StatusMessage message={message} error={error} />
          {generateStatus ? <p style={messageStyle}>{generateStatus}</p> : null}
          {generateBlockedReason && selectedTopic && !generateStatus ? (
            <p style={messageStyle}>{generateBlockedReason}</p>
          ) : null}
        </div>
      </div>

      <style>{`
        @media (max-width: 720px) {
          .topics-master-detail {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </section>
  );
}

function SchedulesSection({ initialSchedules }: { initialSchedules: ScheduleRow[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [recurrence, setRecurrence] = useState("daily");
  const [timeOfDay, setTimeOfDay] = useState("09:00");
  const [weekday, setWeekday] = useState("5");
  const [intervalHours, setIntervalHours] = useState("5");
  const [periodHours, setPeriodHours] = useState("24");
  const [timezone, setTimezone] = useState("UTC");
  const [isDefault, setIsDefault] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editRecurrence, setEditRecurrence] = useState("daily");
  const [editTimeOfDay, setEditTimeOfDay] = useState("09:00");
  const [editWeekday, setEditWeekday] = useState("5");
  const [editIntervalHours, setEditIntervalHours] = useState("5");
  const [editPeriodHours, setEditPeriodHours] = useState("");
  const [editTimezone, setEditTimezone] = useState("UTC");
  const [editIsDefault, setEditIsDefault] = useState(false);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  function schedulePayload(fields: {
    name: string;
    recurrence: string;
    timeOfDay: string;
    weekday: string;
    intervalHours: string;
    periodHours: string;
    timezone: string;
    isDefault: boolean;
  }) {
    const lookback = fields.periodHours.trim();
    return {
      name: fields.name,
      recurrence: fields.recurrence,
      timeOfDay: fields.timeOfDay,
      timezone: fields.timezone,
      isDefault: fields.isDefault,
      weekday: fields.recurrence === "weekly" ? Number(fields.weekday) : null,
      intervalHours:
        fields.recurrence === "interval_hours" ? Number(fields.intervalHours) : null,
      periodHours: lookback === "" ? null : Number(lookback),
    };
  }

  function startEdit(schedule: ScheduleRow) {
    setEditingId(schedule.id);
    setEditName(schedule.name);
    setEditRecurrence(schedule.recurrence || "daily");
    setEditTimeOfDay(schedule.timeOfDay || "09:00");
    setEditWeekday(String(schedule.weekday ?? 5));
    setEditIntervalHours(String(schedule.intervalHours ?? 5));
    setEditPeriodHours(schedule.periodHours == null ? "" : String(schedule.periodHours));
    setEditTimezone(schedule.timezone || "UTC");
    setEditIsDefault(schedule.isDefault);
    setMessage(undefined);
    setError(undefined);
  }

  function cancelEdit() {
    setEditingId(null);
  }

  async function handleAdd(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setMessage(undefined);
    setError(undefined);

    const result = await adminFetch("/api/admin/schedules", {
      method: "POST",
      body: JSON.stringify(
        schedulePayload({
          name,
          recurrence,
          timeOfDay,
          weekday,
          intervalHours,
          periodHours,
          timezone,
          isDefault,
        }),
      ),
    });

    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }

    setName("");
    setRecurrence("daily");
    setTimeOfDay("09:00");
    setWeekday("5");
    setIntervalHours("5");
    setPeriodHours("24");
    setTimezone("UTC");
    setIsDefault(false);
    setMessage("Schedule added.");
    router.refresh();
  }

  async function saveEdit(scheduleId: string) {
    setPending(true);
    setMessage(undefined);
    setError(undefined);

    const result = await adminFetch("/api/admin/schedules", {
      method: "PATCH",
      body: JSON.stringify({
        id: scheduleId,
        ...schedulePayload({
          name: editName,
          recurrence: editRecurrence,
          timeOfDay: editTimeOfDay,
          weekday: editWeekday,
          intervalHours: editIntervalHours,
          periodHours: editPeriodHours,
          timezone: editTimezone,
          isDefault: editIsDefault,
        }),
      }),
    });

    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }

    setEditingId(null);
    setMessage("Schedule updated.");
    router.refresh();
  }

  async function toggleEnabled(schedule: ScheduleRow) {
    setMessage(undefined);
    setError(undefined);

    const result = await adminFetch("/api/admin/schedules", {
      method: "PATCH",
      body: JSON.stringify({ id: schedule.id, enabled: !schedule.enabled }),
    });

    if (!result.ok) {
      setError(result.error);
      return;
    }

    router.refresh();
  }

  async function removeSchedule(schedule: ScheduleRow) {
    if (!window.confirm(`Delete schedule "${schedule.name}"? Topics using it will fall back to Default.`)) {
      return;
    }

    setMessage(undefined);
    setError(undefined);

    const result = await adminFetch("/api/admin/schedules", {
      method: "DELETE",
      body: JSON.stringify({ id: schedule.id }),
    });

    if (!result.ok) {
      setError(result.error);
      return;
    }

    if (editingId === schedule.id) {
      setEditingId(null);
    }
    setMessage("Schedule deleted.");
    router.refresh();
  }

  function recurrenceFields(
    current: string,
    setCurrent: (v: string) => void,
    time: string,
    setTime: (v: string) => void,
    day: string,
    setDay: (v: string) => void,
    hours: string,
    setHours: (v: string) => void,
    lookback: string,
    setLookback: (v: string) => void,
    zone: string,
    setZone: (v: string) => void,
    def: boolean,
    setDef: (v: boolean) => void,
  ) {
    return (
      <>
        <label style={fieldStyle}>
          Recurrence
          <select value={current} onChange={(event) => setCurrent(event.target.value)} style={inputStyle}>
            <option value="daily">Every day</option>
            <option value="weekly">Every week</option>
            <option value="interval_hours">Every N hours</option>
          </select>
        </label>
        {current === "weekly" ? (
          <label style={fieldStyle}>
            Weekday
            <select value={day} onChange={(event) => setDay(event.target.value)} style={inputStyle}>
              {WEEKDAY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {current === "interval_hours" ? (
          <label style={fieldStyle}>
            Every N hours
            <input
              type="number"
              min={1}
              max={24}
              value={hours}
              onChange={(event) => setHours(event.target.value)}
              style={{ ...inputStyle, maxWidth: "6rem" }}
            />
          </label>
        ) : null}
        <label style={fieldStyle}>
          Lookback (hours)
          <input
            type="number"
            min={1}
            max={720}
            value={lookback}
            onChange={(event) => setLookback(event.target.value)}
            style={{ ...inputStyle, maxWidth: "7rem" }}
            placeholder="default"
          />
          <span style={{ color: "#666", fontSize: "0.8rem" }}>Empty = global default</span>
        </label>
        <label style={fieldStyle}>
          Start time
          <input
            type="time"
            required
            value={time}
            onChange={(event) => setTime(event.target.value)}
            style={inputStyle}
          />
        </label>
        <label style={fieldStyle}>
          Timezone
          <input
            value={zone}
            onChange={(event) => setZone(event.target.value)}
            style={inputStyle}
            placeholder="Europe/Moscow"
          />
        </label>
        <label style={{ ...fieldStyle, flexDirection: "row", alignItems: "center", gap: "0.5rem" }}>
          <input type="checkbox" checked={def} onChange={(event) => setDef(event.target.checked)} />
          Default schedule
        </label>
      </>
    );
  }

  return (
    <section style={sectionStyle}>
      <h2 style={headingStyle}>Schedules</h2>
      <p style={{ margin: "0.5rem 0 0", color: "#555", fontSize: "0.95rem" }}>
        Set when topics run and how far back each run looks (lookback). Topics inherit the lookback from
        their schedule (or the Default schedule). Empty lookback uses the global default on the Prompt tab.
      </p>

      <form onSubmit={handleAdd} style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "end", marginTop: "1rem" }}>
        <label style={fieldStyle}>
          Name
          <input required value={name} onChange={(event) => setName(event.target.value)} style={inputStyle} />
        </label>
        {recurrenceFields(
          recurrence,
          setRecurrence,
          timeOfDay,
          setTimeOfDay,
          weekday,
          setWeekday,
          intervalHours,
          setIntervalHours,
          periodHours,
          setPeriodHours,
          timezone,
          setTimezone,
          isDefault,
          setIsDefault,
        )}
        <button type="submit" disabled={pending} style={buttonStyle}>
          Add schedule
        </button>
      </form>

      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={cellStyle}>Name</th>
            <th style={cellStyle}>When</th>
            <th style={cellStyle}>Lookback</th>
            <th style={cellStyle}>Default</th>
            <th style={cellStyle}>Enabled</th>
            <th style={cellStyle}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {initialSchedules.length === 0 ? (
            <tr>
              <td colSpan={6} style={cellStyle}>No schedules yet.</td>
            </tr>
          ) : (
            initialSchedules.map((schedule) => {
              const isEditing = editingId === schedule.id;
              return (
                <Fragment key={schedule.id}>
                  <tr>
                    <td style={cellStyle}>
                      {isEditing ? (
                        <input
                          required
                          value={editName}
                          onChange={(event) => setEditName(event.target.value)}
                          style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }}
                        />
                      ) : (
                        schedule.name
                      )}
                    </td>
                    <td style={cellStyle}>
                      {isEditing
                        ? null
                        : describeHumanSchedule({
                            recurrence: schedule.recurrence,
                            timeOfDay: schedule.timeOfDay,
                            timezone: schedule.timezone,
                            weekday: schedule.weekday,
                            intervalHours: schedule.intervalHours,
                          })}
                    </td>
                    <td style={cellStyle}>
                      {isEditing
                        ? null
                        : schedule.periodHours == null
                          ? "Default"
                          : `${schedule.periodHours}h`}
                    </td>
                    <td style={cellStyle}>{schedule.isDefault ? "Yes" : "—"}</td>
                    <td style={cellStyle}>{schedule.enabled ? "Yes" : "No"}</td>
                    <td style={cellStyle}>
                      {isEditing ? (
                        <>
                          <button
                            type="button"
                            disabled={pending || !editName.trim()}
                            style={buttonStyle}
                            onClick={() => void saveEdit(schedule.id)}
                          >
                            Save
                          </button>{" "}
                          <button type="button" disabled={pending} style={buttonStyle} onClick={cancelEdit}>
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <button type="button" style={buttonStyle} onClick={() => startEdit(schedule)}>
                            Edit
                          </button>{" "}
                          <button type="button" style={buttonStyle} onClick={() => toggleEnabled(schedule)}>
                            {schedule.enabled ? "Disable" : "Enable"}
                          </button>{" "}
                          <button type="button" style={buttonStyle} onClick={() => removeSchedule(schedule)}>
                            Delete
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                  {isEditing ? (
                    <tr>
                      <td colSpan={6} style={cellStyle}>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "end" }}>
                          {recurrenceFields(
                            editRecurrence,
                            setEditRecurrence,
                            editTimeOfDay,
                            setEditTimeOfDay,
                            editWeekday,
                            setEditWeekday,
                            editIntervalHours,
                            setEditIntervalHours,
                            editPeriodHours,
                            setEditPeriodHours,
                            editTimezone,
                            setEditTimezone,
                            editIsDefault,
                            setEditIsDefault,
                          )}
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })
          )}
        </tbody>
      </table>

      <StatusMessage message={message} error={error} />
    </section>
  );
}

type AboutLocale = "en" | "ru";

const ABOUT_LOCALE_TABS: { id: AboutLocale; label: string }[] = [
  { id: "en", label: "English" },
  { id: "ru", label: "Русский" },
];

function AboutSection({ initialAbout }: { initialAbout: AboutPageRow }) {
  const router = useRouter();
  const [locale, setLocale] = useState<AboutLocale>("en");
  const [enabledEn, setEnabledEn] = useState(initialAbout.enabledEn);
  const [enabledRu, setEnabledRu] = useState(initialAbout.enabledRu);
  const [footerLabelEn, setFooterLabelEn] = useState(initialAbout.footerLabelEn);
  const [footerLabelRu, setFooterLabelRu] = useState(initialAbout.footerLabelRu);
  const [pageTitleEn, setPageTitleEn] = useState(initialAbout.pageTitleEn);
  const [pageTitleRu, setPageTitleRu] = useState(initialAbout.pageTitleRu);
  const [leadEn, setLeadEn] = useState(initialAbout.leadEn);
  const [leadRu, setLeadRu] = useState(initialAbout.leadRu);
  const [productEn, setProductEn] = useState(initialAbout.productEn);
  const [productRu, setProductRu] = useState(initialAbout.productRu);
  const [outlookEn, setOutlookEn] = useState(initialAbout.outlookEn);
  const [outlookRu, setOutlookRu] = useState(initialAbout.outlookRu);
  const [collaborationEn, setCollaborationEn] = useState(initialAbout.collaborationEn);
  const [collaborationRu, setCollaborationRu] = useState(initialAbout.collaborationRu);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  const localeTabStyle = (active: boolean) => ({
    ...buttonStyle,
    borderBottom: active ? "2px solid #222" : "2px solid transparent",
    borderRadius: 0,
    background: "transparent",
    fontWeight: active ? 600 : 400,
    color: active ? "#111" : "#666",
  });

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setMessage(undefined);
    setError(undefined);

    const result = await adminFetch("/api/admin/about", {
      method: "PATCH",
      body: JSON.stringify({
        enabledEn,
        enabledRu,
        footerLabelEn,
        footerLabelRu,
        pageTitleEn,
        pageTitleRu,
        leadEn,
        leadRu,
        productEn,
        productRu,
        outlookEn,
        outlookRu,
        collaborationEn,
        collaborationRu,
      }),
    });

    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }

    setMessage("About page saved.");
    router.refresh();
  }

  const enabled = locale === "en" ? enabledEn : enabledRu;
  const setEnabled = locale === "en" ? setEnabledEn : setEnabledRu;
  const footerLabel = locale === "en" ? footerLabelEn : footerLabelRu;
  const setFooterLabel = locale === "en" ? setFooterLabelEn : setFooterLabelRu;
  const pageTitle = locale === "en" ? pageTitleEn : pageTitleRu;
  const setPageTitle = locale === "en" ? setPageTitleEn : setPageTitleRu;
  const lead = locale === "en" ? leadEn : leadRu;
  const setLead = locale === "en" ? setLeadEn : setLeadRu;
  const product = locale === "en" ? productEn : productRu;
  const setProduct = locale === "en" ? setProductEn : setProductRu;
  const outlook = locale === "en" ? outlookEn : outlookRu;
  const setOutlook = locale === "en" ? setOutlookEn : setOutlookRu;
  const collaboration = locale === "en" ? collaborationEn : collaborationRu;
  const setCollaboration = locale === "en" ? setCollaborationEn : setCollaborationRu;

  return (
    <section style={sectionStyle}>
      <h2 style={headingStyle}>About</h2>
      <p style={messageStyle}>
        Public About / Collaboration page at <code>/about</code>. Markdown supported in body fields.
      </p>

      <nav
        aria-label="About locales"
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.25rem 0.5rem",
          borderBottom: "1px solid var(--line, #ddd)",
          marginTop: "1rem",
          marginBottom: "1rem",
        }}
      >
        {ABOUT_LOCALE_TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            style={localeTabStyle(locale === item.id)}
            aria-current={locale === item.id ? "true" : undefined}
            onClick={() => setLocale(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <form onSubmit={handleSave} style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        <label style={{ ...fieldStyle, flexDirection: "row", alignItems: "center", gap: "0.5rem" }}>
          <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
          Enabled
        </label>
        <label style={fieldStyle}>
          Footer label
          <input value={footerLabel} onChange={(event) => setFooterLabel(event.target.value)} style={inputStyle} />
        </label>
        <label style={fieldStyle}>
          Page title
          <input value={pageTitle} onChange={(event) => setPageTitle(event.target.value)} style={inputStyle} />
        </label>
        <label style={fieldStyle}>
          Lead
          <textarea
            rows={3}
            value={lead}
            onChange={(event) => setLead(event.target.value)}
            style={{ ...inputStyle, width: "100%" }}
          />
        </label>
        <label style={fieldStyle}>
          Product (Markdown)
          <textarea
            rows={8}
            value={product}
            onChange={(event) => setProduct(event.target.value)}
            style={{ ...inputStyle, fontFamily: "monospace", width: "100%" }}
          />
        </label>
        <label style={fieldStyle}>
          Outlook (Markdown)
          <textarea
            rows={8}
            value={outlook}
            onChange={(event) => setOutlook(event.target.value)}
            style={{ ...inputStyle, fontFamily: "monospace", width: "100%" }}
          />
        </label>
        <label style={fieldStyle}>
          Collaboration (Markdown)
          <textarea
            rows={8}
            value={collaboration}
            onChange={(event) => setCollaboration(event.target.value)}
            style={{ ...inputStyle, fontFamily: "monospace", width: "100%" }}
          />
        </label>
        <button type="submit" disabled={pending} style={{ ...buttonStyle, alignSelf: "start" }}>
          Save about page
        </button>
      </form>

      <StatusMessage message={message} error={error} />
    </section>
  );
}

function KeysSection({
  initialTelegraph,
  cursorApiKeyConfigured,
  initialConnection,
  telegramApiConfigured,
  initialTelegramApiId,
  active,
}: {
  initialTelegraph: TelegraphMetaRow;
  cursorApiKeyConfigured: boolean;
  initialConnection: SocialConnectionRow;
  telegramApiConfigured: boolean;
  initialTelegramApiId: number | null;
  active: boolean;
}) {
  const router = useRouter();
  const [accessToken, setAccessToken] = useState("");
  const [authorName, setAuthorName] = useState(initialTelegraph.authorName);
  const [authorUrl, setAuthorUrl] = useState(initialTelegraph.authorUrl);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setMessage(undefined);
    setError(undefined);

    const payload: { accessToken?: string; authorName: string; authorUrl: string } = {
      authorName,
      authorUrl,
    };

    if (accessToken.trim()) {
      payload.accessToken = accessToken.trim();
    }

    const result = await adminFetch("/api/admin/telegraph", {
      method: "PATCH",
      body: JSON.stringify(payload),
    });

    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }

    setAccessToken("");
    setMessage("Telegra.ph settings saved.");
    router.refresh();
  }

  return (
    <section style={sectionStyle}>
      <h2 style={headingStyle}>API keys</h2>

      <div style={{ marginBottom: "1.5rem", padding: "0.75rem", background: "#f7f7f7", borderRadius: "4px" }}>
        <strong>Cursor API key</strong>
        <p style={{ ...messageStyle, marginTop: "0.25rem" }}>
          <code>CURSOR_API_KEY</code> is read from the server environment only in v1. Set it in{" "}
          <code>.env</code> and restart the app; it is not stored in the database.
        </p>
        <p style={messageStyle}>
          Status: {cursorApiKeyConfigured ? "Configured in environment" : "Not set in environment"}
        </p>
      </div>

      <h3 style={{ fontSize: "1rem", marginBottom: "0.5rem" }}>Telegra.ph token</h3>
      <p style={messageStyle}>
        Current token: {initialTelegraph.accessTokenConfigured ? "Configured" : "Not set"}
      </p>

      <form onSubmit={handleSave} style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginTop: "1rem", maxWidth: "32rem" }}>
        <label style={fieldStyle}>
          Access token
          <input
            type="password"
            value={accessToken}
            onChange={(event) => setAccessToken(event.target.value)}
            placeholder={initialTelegraph.accessTokenConfigured ? "Leave blank to keep current token" : "Paste Telegra.ph access token"}
            style={inputStyle}
          />
        </label>
        <label style={fieldStyle}>
          Author name
          <input value={authorName} onChange={(event) => setAuthorName(event.target.value)} style={inputStyle} />
        </label>
        <label style={fieldStyle}>
          Author URL
          <input
            value={authorUrl}
            onChange={(event) => setAuthorUrl(event.target.value)}
            placeholder="https://t.me/yourchannel (or leave blank)"
            style={inputStyle}
          />
        </label>
        <p style={messageStyle}>
          Must be a full <code>https://…</code> URL or empty. Bare text / invalid links cause Telegra.ph{" "}
          <code>AUTHOR_URL_INVALID</code> on publish.
        </p>
        <button type="submit" disabled={pending} style={{ ...buttonStyle, alignSelf: "start" }}>
          Save Telegra.ph settings
        </button>
      </form>

      <StatusMessage message={message} error={error} />

      <div style={{ marginTop: "2.5rem", borderTop: "1px solid #ddd", paddingTop: "1.5rem" }}>
        <TelegramConnectionPanel
          active={active}
          initialConnection={initialConnection}
          telegramApiConfigured={telegramApiConfigured}
          initialTelegramApiId={initialTelegramApiId}
        />
      </div>
    </section>
  );
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return "—";
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatTokens(n: number | null | undefined): string {
  if (n == null) {
    return "—";
  }
  return n.toLocaleString();
}

type SystemMetricsPayload = {
  serverTime: string;
  disk: {
    path: string;
    totalBytes: number;
    freeBytes: number;
    usedBytes: number;
  } | null;
  digests: {
    root: string;
    database: { path: string; bytes: number; exists: boolean };
    illustrations: { path: string; bytes: number; fileCount: number; exists: boolean };
    jobLogs: { path: string; bytes: number; fileCount: number; exists: boolean };
    workspace: { path: string; bytes: number; fileCount: number; exists: boolean };
    totalBytes: number;
  };
  telegraph: {
    storage: "external";
    note: string;
    localHtmlBytesApprox: number;
    topicPageCount: number;
  };
  cursor: {
    apiKeyConfigured: boolean;
    note: string;
    totals: {
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens: number;
      cacheWriteTokens: number;
      totalTokens: number;
      stepsWithUsage: number;
    };
    recentSteps: Array<{
      id: string;
      jobId: string;
      topicName: string | null;
      model: string | null;
      totalTokens: number | null;
      inputTokens: number | null;
      outputTokens: number | null;
      updatedAt: string;
    }>;
  };
};

function SystemSection() {
  const [metrics, setMetrics] = useState<SystemMetricsPayload | null>(null);
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  const load = useCallback(async () => {
    setPending(true);
    setError(undefined);
    const result = await adminFetch("/api/admin/system");
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setMetrics(result.data as SystemMetricsPayload);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const freePct =
    metrics?.disk && metrics.disk.totalBytes > 0
      ? Math.round((metrics.disk.freeBytes / metrics.disk.totalBytes) * 100)
      : null;

  return (
    <section style={sectionStyle}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "center" }}>
        <h2 style={{ ...headingStyle, marginBottom: 0 }}>System</h2>
        <button type="button" disabled={pending} style={buttonStyle} onClick={() => void load()}>
          {pending ? "Refreshing…" : "Refresh"}
        </button>
        {metrics ? (
          <span style={{ color: "#666", fontSize: "0.85rem" }}>
            Updated {new Date(metrics.serverTime).toLocaleString()}
          </span>
        ) : null}
      </div>
      <p style={{ margin: "0.5rem 0 0", color: "#555", fontSize: "0.95rem" }}>
        Host disk, digest storage breakdown, and Cursor token usage. More controls will land here later.
      </p>

      <StatusMessage error={error} />

      {metrics ? (
        <>
          <h3 style={{ ...headingStyle, marginTop: "1.5rem" }}>Disk</h3>
          {metrics.disk ? (
            <table style={tableStyle}>
              <tbody>
                <tr>
                  <td style={cellStyle}>Mount / path</td>
                  <td style={cellStyle}>
                    <code>{metrics.disk.path}</code>
                  </td>
                </tr>
                <tr>
                  <td style={cellStyle}>Free</td>
                  <td style={cellStyle}>
                    {formatBytes(metrics.disk.freeBytes)}
                    {freePct != null ? ` (${freePct}%)` : ""}
                  </td>
                </tr>
                <tr>
                  <td style={cellStyle}>Used</td>
                  <td style={cellStyle}>{formatBytes(metrics.disk.usedBytes)}</td>
                </tr>
                <tr>
                  <td style={cellStyle}>Total</td>
                  <td style={cellStyle}>{formatBytes(metrics.disk.totalBytes)}</td>
                </tr>
              </tbody>
            </table>
          ) : (
            <p style={messageStyle}>Disk stats unavailable on this host.</p>
          )}

          <h3 style={{ ...headingStyle, marginTop: "1.5rem" }}>Digest storage</h3>
          <p style={{ margin: "0.25rem 0 0", color: "#666", fontSize: "0.85rem" }}>
            Data root: <code>{metrics.digests.root}</code>
          </p>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={cellStyle}>Item</th>
                <th style={cellStyle}>Size</th>
                <th style={cellStyle}>Details</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={cellStyle}>SQLite DB</td>
                <td style={cellStyle}>{formatBytes(metrics.digests.database.bytes)}</td>
                <td style={cellStyle}>
                  <code style={{ fontSize: "0.8rem" }}>{metrics.digests.database.path}</code>
                  {metrics.digests.database.exists ? "" : " (missing)"}
                </td>
              </tr>
              <tr>
                <td style={cellStyle}>Illustrations</td>
                <td style={cellStyle}>{formatBytes(metrics.digests.illustrations.bytes)}</td>
                <td style={cellStyle}>
                  {metrics.digests.illustrations.fileCount} files ·{" "}
                  <code style={{ fontSize: "0.8rem" }}>{metrics.digests.illustrations.path}</code>
                </td>
              </tr>
              <tr>
                <td style={cellStyle}>Job logs</td>
                <td style={cellStyle}>{formatBytes(metrics.digests.jobLogs.bytes)}</td>
                <td style={cellStyle}>
                  {metrics.digests.jobLogs.fileCount} files ·{" "}
                  <code style={{ fontSize: "0.8rem" }}>{metrics.digests.jobLogs.path}</code>
                </td>
              </tr>
              <tr>
                <td style={cellStyle}>Agent workspace</td>
                <td style={cellStyle}>{formatBytes(metrics.digests.workspace.bytes)}</td>
                <td style={cellStyle}>
                  {metrics.digests.workspace.fileCount} files ·{" "}
                  <code style={{ fontSize: "0.8rem" }}>{metrics.digests.workspace.path}</code>
                </td>
              </tr>
              <tr>
                <td style={cellStyle}>
                  <strong>Local total</strong>
                </td>
                <td style={cellStyle}>
                  <strong>{formatBytes(metrics.digests.totalBytes)}</strong>
                </td>
                <td style={cellStyle} />
              </tr>
              <tr>
                <td style={cellStyle}>Board HTML cache</td>
                <td style={cellStyle}>{formatBytes(metrics.telegraph.localHtmlBytesApprox)}</td>
                <td style={cellStyle}>
                  {metrics.telegraph.topicPageCount} topic pages (inside DB)
                </td>
              </tr>
              <tr>
                <td style={cellStyle}>Telegra.ph</td>
                <td style={cellStyle}>external</td>
                <td style={cellStyle}>{metrics.telegraph.note}</td>
              </tr>
            </tbody>
          </table>

          <h3 style={{ ...headingStyle, marginTop: "1.5rem" }}>AI token usage</h3>
          <p style={{ margin: "0.25rem 0 0", color: "#666", fontSize: "0.85rem" }}>
            {metrics.cursor.note} API key:{" "}
            {metrics.cursor.apiKeyConfigured ? "configured" : "missing"}.
          </p>
          <table style={tableStyle}>
            <tbody>
              <tr>
                <td style={cellStyle}>Total tokens</td>
                <td style={cellStyle}>{formatTokens(metrics.cursor.totals.totalTokens)}</td>
              </tr>
              <tr>
                <td style={cellStyle}>Input</td>
                <td style={cellStyle}>{formatTokens(metrics.cursor.totals.inputTokens)}</td>
              </tr>
              <tr>
                <td style={cellStyle}>Output</td>
                <td style={cellStyle}>{formatTokens(metrics.cursor.totals.outputTokens)}</td>
              </tr>
              <tr>
                <td style={cellStyle}>Cache read / write</td>
                <td style={cellStyle}>
                  {formatTokens(metrics.cursor.totals.cacheReadTokens)} /{" "}
                  {formatTokens(metrics.cursor.totals.cacheWriteTokens)}
                </td>
              </tr>
              <tr>
                <td style={cellStyle}>Steps with usage</td>
                <td style={cellStyle}>{metrics.cursor.totals.stepsWithUsage}</td>
              </tr>
            </tbody>
          </table>

          {metrics.cursor.recentSteps.length > 0 ? (
            <>
              <h3 style={{ ...headingStyle, marginTop: "1.25rem" }}>Recent steps</h3>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={cellStyle}>When</th>
                    <th style={cellStyle}>Topic</th>
                    <th style={cellStyle}>Model</th>
                    <th style={cellStyle}>In / Out</th>
                    <th style={cellStyle}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.cursor.recentSteps.map((step) => (
                    <tr key={step.id}>
                      <td style={cellStyle}>{new Date(step.updatedAt).toLocaleString()}</td>
                      <td style={cellStyle}>{step.topicName ?? "—"}</td>
                      <td style={cellStyle}>{step.model ?? "—"}</td>
                      <td style={cellStyle}>
                        {formatTokens(step.inputTokens)} / {formatTokens(step.outputTokens)}
                      </td>
                      <td style={cellStyle}>{formatTokens(step.totalTokens)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : (
            <p style={messageStyle}>No recorded usage yet — run a topic Generate after deploy.</p>
          )}
        </>
      ) : !error && pending ? (
        <p style={messageStyle}>Loading…</p>
      ) : null}
    </section>
  );
}

function TelegramConnectionPanel({
  initialConnection,
  telegramApiConfigured,
  initialTelegramApiId,
  active,
}: {
  initialConnection: SocialConnectionRow;
  telegramApiConfigured: boolean;
  initialTelegramApiId: number | null;
  active: boolean;
}) {
  const [connection, setConnection] = useState(initialConnection);
  const [apiConfigured, setApiConfigured] = useState(telegramApiConfigured);
  const [apiIdShown, setApiIdShown] = useState(initialTelegramApiId);
  const [apiId, setApiId] = useState(initialTelegramApiId != null ? String(initialTelegramApiId) : "");
  const [apiHash, setApiHash] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();

  async function refresh() {
    const result = await adminFetch("/api/admin/connections");
    if (!result.ok) {
      setError(result.error);
      return;
    }
    const data = result.data as {
      connection: SocialConnectionRow;
      telegramApiConfigured: boolean;
      telegramApiId: number | null;
    };
    setConnection(data.connection);
    setApiConfigured(data.telegramApiConfigured);
    setApiIdShown(data.telegramApiId);
    if (data.telegramApiId != null) {
      setApiId(String(data.telegramApiId));
    }
    if (data.connection.status === "linked") {
      setPhone("");
      setCode("");
      setPassword("");
    }
  }

  // Tab switches remounted this section with stale SSR props; always re-fetch when shown.
  useEffect(() => {
    if (!active) return;
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh on show only
  }, [active]);

  async function run(
    path: string,
    body?: Record<string, string>,
    successMsg?: string,
  ) {
    setBusy(true);
    setError(undefined);
    setMessage(undefined);
    const result = await adminFetch(path, {
      method: "POST",
      body: body ? JSON.stringify(body) : undefined,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      await refresh();
      return;
    }
    const data = result.data as {
      connection?: SocialConnectionRow;
      telegramApiConfigured?: boolean;
      telegramApiId?: number;
      alreadyLinked?: boolean;
    };
    if (data.connection) {
      setConnection(data.connection);
    }
    if (data.telegramApiConfigured != null) {
      setApiConfigured(data.telegramApiConfigured);
    }
    if (data.telegramApiId != null) {
      setApiIdShown(data.telegramApiId);
      setApiId(String(data.telegramApiId));
      setApiHash("");
    }
    if (data.alreadyLinked) {
      setMessage("Telegram is already linked.");
      setPhone("");
      setCode("");
      setPassword("");
      return;
    }
    setMessage(successMsg);
    if (data.connection?.status === "linked") {
      setPhone("");
      setCode("");
      setPassword("");
    }
  }

  const linked = connection.status === "linked";
  const linking = connection.status === "linking";
  const errored = connection.status === "error";
  const awaitingCode = linking && connection.linkStep === "awaiting_code";
  const awaitingPassword = linking && connection.linkStep === "awaiting_password";
  const canStartOver = !linked && (linking || errored);

  return (
    <div>
      <h3 style={{ ...headingStyle, marginBottom: "0.5rem" }}>Telegram account</h3>
      <p style={{ color: "#555", marginTop: 0, maxWidth: "40rem" }}>
        Link a Telegram user session for multi-source topics (DD-0005). Sessions and API hash are encrypted at
        rest; never paste them into agent prompts.
      </p>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "0.75rem",
          maxWidth: "28rem",
        }}
      >
        <h3 style={{ fontSize: "1rem", margin: 0 }}>Telegram</h3>
        <p style={{ margin: 0, fontSize: "0.875rem", color: "#555" }}>
          App credentials from{" "}
          <a href="https://my.telegram.org" target="_blank" rel="noreferrer">
            my.telegram.org
          </a>
          {apiConfigured
            ? ` · saved${apiIdShown != null ? ` (api id ${apiIdShown})` : ""}`
            : " · not saved yet"}
          {linked ? " · disconnect to change" : null}
        </p>
        {linked ? (
          <p style={{ margin: 0, fontSize: "0.875rem", color: "#555" }}>
            API id/hash identify the Telegram <em>application</em>. Your user session was authorized for the
            current app — changing them would break the link until you sign in again.
          </p>
        ) : (
          <>
            <label style={fieldStyle}>
              API id
              <input
                style={inputStyle}
                value={apiId}
                onChange={(e) => setApiId(e.target.value)}
                placeholder="12345678"
                inputMode="numeric"
                autoComplete="off"
                disabled={busy || linking}
              />
            </label>
            <label style={fieldStyle}>
              API hash
              <input
                style={inputStyle}
                type="password"
                value={apiHash}
                onChange={(e) => setApiHash(e.target.value)}
                placeholder={apiConfigured ? "Leave blank to keep current hash" : "Paste API hash"}
                autoComplete="off"
                disabled={busy || linking}
              />
            </label>
            <div>
              <button
                type="button"
                style={buttonStyle}
                disabled={busy || linking || !apiId.trim() || (!apiHash.trim() && !apiConfigured)}
                onClick={() =>
                  void run(
                    "/api/admin/connections/telegram/credentials",
                    { apiId: apiId.trim(), apiHash: apiHash.trim() },
                    "API credentials saved.",
                  )
                }
              >
                Save API credentials
              </button>
            </div>
          </>
        )}

        <p style={{ margin: "0.5rem 0 0", borderTop: "1px solid #eee", paddingTop: "0.75rem" }}>
          Status: <strong>{connection.status}</strong>
          {connection.displayName ? ` · ${connection.displayName}` : null}
          {connection.linkedAt ? ` · linked ${formatJobTime(connection.linkedAt)}` : null}
        </p>
        {connection.lastError ? <p style={errorStyle}>Last error: {connection.lastError}</p> : null}

        {!linked && !awaitingCode && !awaitingPassword ? (
          <label style={fieldStyle}>
            Phone (international)
            <input
              style={inputStyle}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+79001234567"
              autoComplete="tel"
              disabled={busy || !apiConfigured}
            />
          </label>
        ) : null}

        {awaitingCode ? (
          <label style={fieldStyle}>
            Login code {connection.isCodeViaApp ? "(Telegram app)" : "(SMS)"}
            <input
              style={inputStyle}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="12345"
              autoComplete="one-time-code"
              disabled={busy}
            />
          </label>
        ) : null}

        {awaitingPassword ? (
          <>
            <p style={{ margin: 0, fontSize: "0.875rem", color: "#555" }}>
              This Telegram account has Two-Step Verification (cloud password). The login code was already
              accepted — enter that password here. If codes stop arriving after a wrong password, open Telegram →
              Settings → Devices, reset the incomplete login, then Cancel below and start again.
            </p>
            <label style={fieldStyle}>
              Cloud password (2FA){connection.passwordHint ? ` (hint: ${connection.passwordHint})` : ""}
              <input
                style={inputStyle}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={busy}
              />
            </label>
          </>
        ) : null}

        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
          {!linked && !awaitingCode && !awaitingPassword ? (
            <button
              type="button"
              style={buttonStyle}
              disabled={busy || !apiConfigured || !phone.trim()}
              onClick={() => void run("/api/admin/connections/telegram/start", { phone }, "Code sent.")}
            >
              Link Telegram
            </button>
          ) : null}
          {awaitingCode ? (
            <button
              type="button"
              style={buttonStyle}
              disabled={busy || !code.trim()}
              onClick={() => void run("/api/admin/connections/telegram/code", { code })}
            >
              Submit code
            </button>
          ) : null}
          {awaitingPassword ? (
            <button
              type="button"
              style={buttonStyle}
              disabled={busy || !password}
              onClick={() => void run("/api/admin/connections/telegram/password", { password })}
            >
              Submit cloud password
            </button>
          ) : null}
          {canStartOver ? (
            <button
              type="button"
              style={buttonStyle}
              disabled={busy}
              onClick={() =>
                void run(
                  "/api/admin/connections/telegram/cancel",
                  undefined,
                  "Link cancelled. If Telegram still blocks codes, reset the incomplete login under Settings → Devices.",
                )
              }
            >
              Cancel / start over
            </button>
          ) : null}
          {linked ? (
            <button
              type="button"
              style={buttonStyle}
              disabled={busy}
              onClick={() => {
                if (!window.confirm("Disconnect Telegram and delete the stored session?")) return;
                void run("/api/admin/connections/telegram/disconnect", undefined, "Disconnected.");
              }}
            >
              Disconnect
            </button>
          ) : null}
          <button type="button" style={buttonStyle} disabled={busy} onClick={() => void refresh()}>
            Refresh
          </button>
        </div>
        <StatusMessage message={message} error={error} />
      </div>
    </div>
  );
}

const ADMIN_TABS = [
  { id: "jobs", label: "Jobs" },
  { id: "people", label: "People" },
  { id: "prompt", label: "Prompt" },
  { id: "topics", label: "Topics" },
  { id: "schedules", label: "Schedules" },
  { id: "about", label: "About" },
  { id: "system", label: "System" },
  { id: "keys", label: "API keys" },
] as const;

type AdminTabId = (typeof ADMIN_TABS)[number]["id"];

function isAdminTabId(value: string): value is AdminTabId {
  return ADMIN_TABS.some((item) => item.id === value);
}

/** Legacy combined tab hash from older Admin UI. */
function resolveAdminTabHash(raw: string): AdminTabId | null {
  if (raw === "content") {
    return "prompt";
  }
  if (raw === "connections") {
    return "keys";
  }
  return isAdminTabId(raw) ? raw : null;
}

export function AdminClient({ data }: { data: AdminInitialData }) {
  const [tab, setTab] = useState<AdminTabId>("jobs");
  const [keysVisited, setKeysVisited] = useState(false);
  const topicsLeaveGuardRef = useRef<(() => Promise<boolean>) | null>(null);

  useEffect(() => {
    const fromHash = window.location.hash.replace(/^#/, "");
    const resolved = resolveAdminTabHash(fromHash);
    if (resolved) {
      setTab(resolved);
      if (resolved === "keys") {
        setKeysVisited(true);
      }
    }
  }, []);

  async function selectTab(next: AdminTabId) {
    if (tab === "topics" && next !== "topics" && topicsLeaveGuardRef.current) {
      const ok = await topicsLeaveGuardRef.current();
      if (!ok) {
        return;
      }
    }
    if (next === "keys") {
      setKeysVisited(true);
    }
    setTab(next);
    window.history.replaceState(null, "", `#${next}`);
  }

  const tabButtonStyle = (active: boolean) => ({
    ...buttonStyle,
    borderBottom: active ? "2px solid #222" : "2px solid transparent",
    borderRadius: 0,
    background: "transparent",
    fontWeight: active ? 600 : 400,
    color: active ? "#111" : "#666",
  });

  return (
    <main className="shell" style={{ maxWidth: "72rem" }}>
      <SiteHeader
        actions={
          <>
            <Link href="/" className="nav-link">
              Home
            </Link>
            <span className="status-inline">Signed in as {data.signedInEmail}</span>
            <SignOutButton />
          </>
        }
      />

      <section className="hero" style={{ marginBottom: "1.25rem" }}>
        <h1 style={{ maxWidth: "none", fontSize: "clamp(1.8rem, 4vw, 2.4rem)" }}>Admin</h1>
        <p>Jobs, people, prompt, topics, schedules, system, and API keys.</p>
      </section>

      <nav
        aria-label="Admin sections"
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.25rem 0.5rem",
          borderBottom: "1px solid var(--line)",
          marginBottom: "1.75rem",
        }}
      >
        {ADMIN_TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            style={tabButtonStyle(tab === item.id)}
            aria-current={tab === item.id ? "page" : undefined}
            onClick={() => void selectTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {tab === "jobs" ? <JobsSection initialJobs={data.jobs} /> : null}
      {tab === "people" ? <PeopleSection initialUsers={data.users} /> : null}
      {tab === "prompt" ? <PromptSection initialPrompt={data.prompt} /> : null}
      {tab === "topics" ? (
        <TopicsSection
          initialTopics={data.topics}
          schedules={data.schedules}
          leaveGuardRef={topicsLeaveGuardRef}
        />
      ) : null}
      {tab === "schedules" ? <SchedulesSection initialSchedules={data.schedules} /> : null}
      {tab === "about" ? <AboutSection initialAbout={data.about} /> : null}
      {tab === "system" ? <SystemSection /> : null}
      {keysVisited ? (
        <div style={{ display: tab === "keys" ? "block" : "none" }} hidden={tab !== "keys"}>
          <KeysSection
            active={tab === "keys"}
            initialTelegraph={data.telegraph}
            cursorApiKeyConfigured={data.cursorApiKeyConfigured}
            initialConnection={data.telegramConnection}
            telegramApiConfigured={data.telegramApiConfigured}
            initialTelegramApiId={data.telegramApiId}
          />
        </div>
      ) : null}
    </main>
  );
}

