"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useCallback, useEffect, useState } from "react";

import { SiteHeader } from "@/app/site-header";
import { SignOutButton } from "@/app/sign-out-button";

type AllowedUserRow = {
  id: string;
  email: string;
  isAdmin: boolean;
};

type TopicRow = {
  id: string;
  name: string;
  keywords: string;
  enabled: boolean;
  sortOrder: number;
};

type ScheduleRow = {
  id: string;
  name: string;
  cronExpr: string;
  timezone: string;
  enabled: boolean;
};

type PromptConfigRow = {
  template: string;
  periodHours: number;
};

type TelegraphMetaRow = {
  accessTokenConfigured: boolean;
  authorName: string;
  authorUrl: string;
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
  telegraph: TelegraphMetaRow;
  cursorApiKeyConfigured: boolean;
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
  if (step.kind === "merge_publish") {
    return "merge → publish";
  }
  return step.topicName ? `draft: ${step.topicName}` : "topic draft";
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
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "1rem" }}>
        <h2 style={headingStyle}>Generation jobs</h2>
        <button type="button" style={buttonStyle} onClick={() => void loadJobs()} disabled={refreshing}>
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>
      <p style={messageStyle}>
        Auto-refreshes every 5s while a job is pending/running, otherwise every 30s. Each Generate runs
        one short agent per enabled topic (draft), then one merge/publish step. Expand a job for step
        status and logs. Server:{" "}
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
        Placeholders: {"{{TOPICS}}"}, {"{{PERIOD_HOURS}}"}, {"{{DATE}}"}, {"{{EXCLUDE_STORIES}}"}
      </p>

      <form onSubmit={handleSave} style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginTop: "1rem" }}>
        <label style={fieldStyle}>
          Lookback period (hours)
          <input
            type="number"
            min={1}
            max={168}
            required
            value={periodHours}
            onChange={(event) => setPeriodHours(event.target.value)}
            style={{ ...inputStyle, maxWidth: "8rem" }}
          />
        </label>
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
        <button type="submit" disabled={pending} style={{ ...buttonStyle, alignSelf: "start" }}>
          Save prompt
        </button>
      </form>

      <StatusMessage message={message} error={error} />
    </section>
  );
}

function TopicsSection({ initialTopics }: { initialTopics: TopicRow[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [keywords, setKeywords] = useState("");
  const [sortOrder, setSortOrder] = useState("0");
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  async function handleAdd(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setMessage(undefined);
    setError(undefined);

    const result = await adminFetch("/api/admin/topics", {
      method: "POST",
      body: JSON.stringify({
        name,
        keywords,
        sortOrder: Number(sortOrder),
      }),
    });

    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }

    setName("");
    setKeywords("");
    setSortOrder("0");
    setMessage("Topic added.");
    router.refresh();
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

    setMessage("Topic deleted.");
    router.refresh();
  }

  return (
    <section style={sectionStyle}>
      <h2 style={headingStyle}>Topics</h2>

      <form onSubmit={handleAdd} style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "end", marginTop: "1rem" }}>
        <label style={fieldStyle}>
          Name
          <input required value={name} onChange={(event) => setName(event.target.value)} style={inputStyle} />
        </label>
        <label style={fieldStyle}>
          Keywords
          <input value={keywords} onChange={(event) => setKeywords(event.target.value)} style={inputStyle} />
        </label>
        <label style={fieldStyle}>
          Sort order
          <input
            type="number"
            value={sortOrder}
            onChange={(event) => setSortOrder(event.target.value)}
            style={{ ...inputStyle, maxWidth: "6rem" }}
          />
        </label>
        <button type="submit" disabled={pending} style={buttonStyle}>
          Add topic
        </button>
      </form>

      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={cellStyle}>Name</th>
            <th style={cellStyle}>Keywords</th>
            <th style={cellStyle}>Order</th>
            <th style={cellStyle}>Enabled</th>
            <th style={cellStyle}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {initialTopics.length === 0 ? (
            <tr>
              <td colSpan={5} style={cellStyle}>No topics yet.</td>
            </tr>
          ) : (
            initialTopics.map((topic) => (
              <tr key={topic.id}>
                <td style={cellStyle}>{topic.name}</td>
                <td style={cellStyle}>{topic.keywords || "—"}</td>
                <td style={cellStyle}>{topic.sortOrder}</td>
                <td style={cellStyle}>{topic.enabled ? "Yes" : "No"}</td>
                <td style={cellStyle}>
                  <button type="button" style={buttonStyle} onClick={() => toggleEnabled(topic)}>
                    {topic.enabled ? "Disable" : "Enable"}
                  </button>{" "}
                  <button type="button" style={buttonStyle} onClick={() => removeTopic(topic)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      <StatusMessage message={message} error={error} />
    </section>
  );
}

function SchedulesSection({ initialSchedules }: { initialSchedules: ScheduleRow[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [cronExpr, setCronExpr] = useState("");
  const [timezone, setTimezone] = useState("UTC");
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  async function handleAdd(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setMessage(undefined);
    setError(undefined);

    const result = await adminFetch("/api/admin/schedules", {
      method: "POST",
      body: JSON.stringify({ name, cronExpr, timezone }),
    });

    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }

    setName("");
    setCronExpr("");
    setTimezone("UTC");
    setMessage("Schedule added.");
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
    if (!window.confirm(`Delete schedule "${schedule.name}"?`)) {
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

    setMessage("Schedule deleted.");
    router.refresh();
  }

  return (
    <section style={sectionStyle}>
      <h2 style={headingStyle}>Schedules</h2>

      <form onSubmit={handleAdd} style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "end", marginTop: "1rem" }}>
        <label style={fieldStyle}>
          Name
          <input required value={name} onChange={(event) => setName(event.target.value)} style={inputStyle} />
        </label>
        <label style={fieldStyle}>
          Cron
          <input required value={cronExpr} onChange={(event) => setCronExpr(event.target.value)} style={inputStyle} placeholder="0 9 * * *" />
        </label>
        <label style={fieldStyle}>
          Timezone
          <input value={timezone} onChange={(event) => setTimezone(event.target.value)} style={inputStyle} />
        </label>
        <button type="submit" disabled={pending} style={buttonStyle}>
          Add schedule
        </button>
      </form>

      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={cellStyle}>Name</th>
            <th style={cellStyle}>Cron</th>
            <th style={cellStyle}>Timezone</th>
            <th style={cellStyle}>Enabled</th>
            <th style={cellStyle}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {initialSchedules.length === 0 ? (
            <tr>
              <td colSpan={5} style={cellStyle}>No schedules yet.</td>
            </tr>
          ) : (
            initialSchedules.map((schedule) => (
              <tr key={schedule.id}>
                <td style={cellStyle}>{schedule.name}</td>
                <td style={cellStyle}>{schedule.cronExpr}</td>
                <td style={cellStyle}>{schedule.timezone}</td>
                <td style={cellStyle}>{schedule.enabled ? "Yes" : "No"}</td>
                <td style={cellStyle}>
                  <button type="button" style={buttonStyle} onClick={() => toggleEnabled(schedule)}>
                    {schedule.enabled ? "Disable" : "Enable"}
                  </button>{" "}
                  <button type="button" style={buttonStyle} onClick={() => removeSchedule(schedule)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      <StatusMessage message={message} error={error} />
    </section>
  );
}

function KeysSection({
  initialTelegraph,
  cursorApiKeyConfigured,
}: {
  initialTelegraph: TelegraphMetaRow;
  cursorApiKeyConfigured: boolean;
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
    </section>
  );
}

const ADMIN_TABS = [
  { id: "jobs", label: "Jobs" },
  { id: "people", label: "People" },
  { id: "content", label: "Prompt & topics" },
  { id: "keys", label: "API keys" },
] as const;

type AdminTabId = (typeof ADMIN_TABS)[number]["id"];

function isAdminTabId(value: string): value is AdminTabId {
  return ADMIN_TABS.some((item) => item.id === value);
}

export function AdminClient({ data }: { data: AdminInitialData }) {
  const [tab, setTab] = useState<AdminTabId>("jobs");

  useEffect(() => {
    const fromHash = window.location.hash.replace(/^#/, "");
    if (isAdminTabId(fromHash)) {
      setTab(fromHash);
    }
  }, []);

  function selectTab(next: AdminTabId) {
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
    <main className="shell" style={{ maxWidth: "56rem" }}>
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
        <p>Jobs, people, prompt, topics, and API keys.</p>
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
            onClick={() => selectTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {tab === "jobs" ? <JobsSection initialJobs={data.jobs} /> : null}
      {tab === "people" ? <PeopleSection initialUsers={data.users} /> : null}
      {tab === "content" ? (
        <>
          <PromptSection initialPrompt={data.prompt} />
          <TopicsSection initialTopics={data.topics} />
          <SchedulesSection initialSchedules={data.schedules} />
        </>
      ) : null}
      {tab === "keys" ? (
        <KeysSection
          initialTelegraph={data.telegraph}
          cursorApiKeyConfigured={data.cursorApiKeyConfigured}
        />
      ) : null}
    </main>
  );
}

