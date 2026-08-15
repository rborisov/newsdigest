export const DEFAULT_FAQ_PROMPT = `You maintain a living FAQ for one news topic.

Write answers in the same language as the evidence when possible.
Prefer short, factual answers that are true *now*, not a news digest.
Ignore ads, fluff, and personal data.
Use only the provided evidence; if unsure, say what is unknown.
Each entry must be a clear question and a clear answer.`;

/** Stable URL slug: name fragment + topic id prefix. */
export function buildFaqSlug(topicName: string, topicId: string): string {
  const base = topicName
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  const idPart = topicId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 10) || "topic";
  return `${base || "faq"}-${idPart}`.toLowerCase();
}

export function normalizeQuestionKey(question: string): string {
  return question
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

export function tokenizeForOverlap(text: string): Set<string> {
  const tokens = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
  return new Set(tokens);
}

export function tokenOverlapScore(a: string, b: string): number {
  const left = tokenizeForOverlap(a);
  const right = tokenizeForOverlap(b);
  if (left.size === 0 || right.size === 0) return 0;
  let hit = 0;
  for (const token of left) {
    if (right.has(token)) hit += 1;
  }
  return hit / Math.min(left.size, right.size);
}

/** Extract explicit Q/A pairs from free text when present. */
export function extractExplicitQaPairs(text: string): Array<{ question: string; answer: string }> {
  const pairs: Array<{ question: string; answer: string }> = [];
  const patterns = [
    /(?:^|\n)\s*(?:Q|Question|Вопрос)\s*[:.\-–—]\s*([\s\S]+?)\s*(?:\n|\r)\s*(?:A|Answer|Ответ)\s*[:.\-–—]\s*([\s\S]+?)(?=(?:\n\s*(?:Q|Question|Вопрос)\s*[:.\-–—])|$)/gi,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const question = (match[1] ?? "").trim();
      const answer = (match[2] ?? "").trim();
      if (question.length >= 8 && answer.length >= 8) {
        pairs.push({ question, answer });
      }
    }
  }
  return pairs;
}

export type FaqRefreshCandidate = {
  question: string;
  questionKey: string;
  answer: string;
  evidence: Array<{ sourceKind: string; externalId: string; url?: string | null; at?: string | null }>;
  confidence: number;
};

/**
 * Build FAQ candidates from question-quality seeds + kept evidence (no LLM).
 */
export function buildFaqCandidatesFromIngest(input: {
  questions: Array<{ text: string; externalId: string; url?: string | null; publishedAt?: Date | null }>;
  kept: Array<{ text: string; externalId: string; url?: string | null; publishedAt?: Date | null }>;
  keywords?: string;
}): FaqRefreshCandidate[] {
  const keywordBlob = (input.keywords ?? "").trim();
  const out: FaqRefreshCandidate[] = [];
  const seen = new Set<string>();

  for (const kept of input.kept) {
    for (const pair of extractExplicitQaPairs(kept.text)) {
      const key = normalizeQuestionKey(pair.question);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push({
        question: pair.question,
        questionKey: key,
        answer: pair.answer,
        evidence: [
          {
            sourceKind: "telegram",
            externalId: kept.externalId,
            url: kept.url,
            at: kept.publishedAt?.toISOString() ?? null,
          },
        ],
        confidence: 0.7,
      });
    }
  }

  for (const question of input.questions) {
    const q = question.text.trim().replace(/\?+\s*$/, "?").trim();
    if (q.length < 8) continue;
    const key = normalizeQuestionKey(q);
    if (!key || seen.has(key)) continue;

    let best: { text: string; score: number; item: (typeof input.kept)[number] } | null = null;
    for (const kept of input.kept) {
      const score =
        tokenOverlapScore(q, kept.text) +
        (keywordBlob ? tokenOverlapScore(keywordBlob, kept.text) * 0.25 : 0);
      if (score < 0.18) continue;
      if (!best || score > best.score) {
        best = { text: kept.text.trim(), score, item: kept };
      }
    }
    if (!best) continue;
    seen.add(key);
    out.push({
      question: q.endsWith("?") ? q : `${q}?`,
      questionKey: key,
      answer: best.text.slice(0, 1200),
      evidence: [
        {
          sourceKind: "telegram",
          externalId: question.externalId,
          url: question.url,
          at: question.publishedAt?.toISOString() ?? null,
        },
        {
          sourceKind: "telegram",
          externalId: best.item.externalId,
          url: best.item.url,
          at: best.item.publishedAt?.toISOString() ?? null,
        },
      ],
      confidence: Math.min(0.95, 0.35 + best.score),
    });
  }

  return out.slice(0, 40);
}
