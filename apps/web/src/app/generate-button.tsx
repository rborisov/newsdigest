"use client";

import { useCallback, useEffect, useState } from "react";

type JobSummary = {
  id: string;
  status: string;
};

export function GenerateButton() {
  const [status, setStatus] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [activeJob, setActiveJob] = useState<JobSummary | null>(null);

  const refreshActive = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/jobs");
      if (!response.ok) {
        return;
      }
      const data = (await response.json()) as { jobs?: JobSummary[] };
      const active =
        data.jobs?.find((job) => job.status === "pending" || job.status === "running") ?? null;
      setActiveJob(active);
      if (!active && status?.includes("in progress")) {
        setStatus(null);
      }
    } catch {
      // ignore polling errors
    }
  }, [status]);

  useEffect(() => {
    void refreshActive();
  }, [refreshActive]);

  useEffect(() => {
    if (!activeJob) {
      return;
    }
    const timer = window.setInterval(() => {
      void refreshActive();
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [activeJob, refreshActive]);

  async function handleGenerate() {
    if (activeJob || pending) {
      return;
    }

    setPending(true);
    setStatus(null);

    try {
      const response = await fetch("/api/generate", { method: "POST" });
      const data = (await response.json()) as {
        message?: string;
        error?: string;
        jobId?: string;
      };

      if (!response.ok) {
        setStatus(data.error ?? "Generation failed.");
        await refreshActive();
        return;
      }

      setStatus(data.message ?? "Generation triggered.");
      if (data.jobId) {
        setActiveJob({ id: data.jobId, status: "running" });
      } else {
        await refreshActive();
      }
    } catch {
      setStatus("Generation failed.");
    } finally {
      setPending(false);
    }
  }

  const busy = pending || Boolean(activeJob);
  const label = pending
    ? "Starting…"
    : activeJob
      ? `In progress (${activeJob.status})…`
      : "Generate now";

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem" }}>
      <button type="button" onClick={handleGenerate} disabled={busy} title={activeJob ? `Job ${activeJob.id}` : undefined}>
        {label}
      </button>
      {status ? <span style={{ color: "#666", fontSize: "0.875rem" }}>{status}</span> : null}
    </span>
  );
}
