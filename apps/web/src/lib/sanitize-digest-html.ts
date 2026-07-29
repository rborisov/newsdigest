const ALLOWED_TAGS = new Set([
  "p",
  "a",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "s",
  "br",
  "hr",
  "h3",
  "h4",
  "ul",
  "ol",
  "li",
  "blockquote",
]);

const VOID_TAGS = new Set(["br", "hr"]);

/**
 * Allowlist-sanitize digest HTML for safe home-board rendering.
 * Keeps Telegraph-compatible tags; strips scripts/events; allows http(s)/mailto hrefs on <a>.
 */
export function sanitizeDigestHtml(html: string): string {
  const trimmed = html.trim();
  if (!trimmed) {
    return "";
  }

  const tagPattern = /<\/?([a-zA-Z0-9]+)(\s[^>]*)?\s*\/?>/g;
  let out = "";
  let last = 0;
  let match: RegExpExecArray | null;
  let skippingUntil: string | null = null;

  while ((match = tagPattern.exec(trimmed)) !== null) {
    const full = match[0];
    const tag = match[1].toLowerCase();
    const isClose = full.startsWith("</");

    if (skippingUntil) {
      if (isClose && tag === skippingUntil) {
        skippingUntil = null;
        last = tagPattern.lastIndex;
      } else {
        last = tagPattern.lastIndex;
      }
      continue;
    }

    out += escapeText(trimmed.slice(last, match.index));

    if (!ALLOWED_TAGS.has(tag)) {
      if (!isClose && !VOID_TAGS.has(tag) && !full.endsWith("/>")) {
        skippingUntil = tag;
      }
      last = tagPattern.lastIndex;
      continue;
    }

    if (isClose) {
      out += `</${tag}>`;
    } else if (tag === "a") {
      const href = extractHref(match[2] ?? "");
      if (href) {
        out += `<a href="${escapeAttr(href)}" target="_blank" rel="noopener noreferrer">`;
      } else {
        out += "<a>";
      }
    } else if (VOID_TAGS.has(tag) || full.endsWith("/>")) {
      out += `<${tag}/>`;
    } else {
      out += `<${tag}>`;
    }

    last = tagPattern.lastIndex;
  }

  if (!skippingUntil) {
    out += escapeText(trimmed.slice(last));
  }
  return out;
}

/**
 * Drop a leading <h3> that repeats the board card topic title
 * (agents are instructed to start HTML with that heading for Telegra.ph).
 */
export function stripLeadingTopicHeading(html: string, topicName: string): string {
  const name = topicName.trim();
  if (!html.trim() || !name) {
    return html;
  }

  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `^\\s*<h3>\\s*${escaped}\\s*<\\/h3>\\s*`,
    "i",
  );
  return html.replace(pattern, "").trim();
}

function extractHref(attrString: string): string | null {
  const match = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrString);
  if (!match) {
    return null;
  }
  const raw = (match[1] ?? match[2] ?? match[3] ?? "").trim();
  if (!raw) {
    return null;
  }
  const lower = raw.toLowerCase();
  if (
    lower.startsWith("https://") ||
    lower.startsWith("http://") ||
    lower.startsWith("mailto:")
  ) {
    return raw;
  }
  if (lower.startsWith("//")) {
    return `https:${raw}`;
  }
  return null;
}

function escapeText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeAttr(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
