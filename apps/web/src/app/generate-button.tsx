"use client";

import { useState } from "react";

export function GenerateButton() {
  const [status, setStatus] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleGenerate() {
    setPending(true);
    setStatus(null);

    try {
      const response = await fetch("/api/generate", { method: "POST" });
      const data = (await response.json()) as { message?: string; error?: string };

      if (!response.ok) {
        setStatus(data.error ?? "Generation failed.");
        return;
      }

      setStatus(data.message ?? "Generation triggered.");
    } catch {
      setStatus("Generation failed.");
    } finally {
      setPending(false);
    }
  }

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem" }}>
      <button type="button" onClick={handleGenerate} disabled={pending}>
        {pending ? "Generating…" : "Generate now"}
      </button>
      {status ? <span style={{ color: "#666", fontSize: "0.875rem" }}>{status}</span> : null}
    </span>
  );
}
