"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

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

export type AdminInitialData = {
  signedInEmail: string;
  users: AllowedUserRow[];
  topics: TopicRow[];
  schedules: ScheduleRow[];
  prompt: PromptConfigRow;
  telegraph: TelegraphMetaRow;
  cursorApiKeyConfigured: boolean;
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
          <input value={authorUrl} onChange={(event) => setAuthorUrl(event.target.value)} style={inputStyle} />
        </label>
        <button type="submit" disabled={pending} style={{ ...buttonStyle, alignSelf: "start" }}>
          Save Telegra.ph settings
        </button>
      </form>

      <StatusMessage message={message} error={error} />
    </section>
  );
}

export function AdminClient({ data }: { data: AdminInitialData }) {
  return (
    <main style={{ padding: "2rem", fontFamily: "system-ui, sans-serif", maxWidth: "56rem", margin: "0 auto" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "1rem", marginBottom: "2rem" }}>
        <div>
          <h1>Admin</h1>
          <p style={{ color: "#666", marginTop: "0.25rem" }}>Signed in as {data.signedInEmail}</p>
        </div>
        <Link href="/">Back to home</Link>
      </header>

      <PeopleSection initialUsers={data.users} />
      <PromptSection initialPrompt={data.prompt} />
      <TopicsSection initialTopics={data.topics} />
      <SchedulesSection initialSchedules={data.schedules} />
      <KeysSection
        initialTelegraph={data.telegraph}
        cursorApiKeyConfigured={data.cursorApiKeyConfigured}
      />
    </main>
  );
}
