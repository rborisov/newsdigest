import { sanitizeDigestHtml } from "./sanitize-digest-html";

export function renderAboutMarkdown(md: string): string {
  const trimmed = md.trim();
  if (!trimmed) return "";
  const html = markdownToHtml(trimmed);
  return sanitizeDigestHtml(html);
}

function markdownToHtml(src: string): string {
  const blocks = src.split(/\n\s*\n/);
  const parts: string[] = [];

  for (const block of blocks) {
    const trimmedBlock = block.trim();
    if (!trimmedBlock) continue;

    const lines = trimmedBlock.split("\n");

    if (isUnorderedListBlock(lines)) {
      const items = lines
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => `<li>${renderInline(line.replace(/^[-*] /, ""))}</li>`)
        .join("");
      parts.push(`<ul>${items}</ul>`);
    } else if (isOrderedListBlock(lines)) {
      const items = lines
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => `<li>${renderInline(line.replace(/^\d+\. /, ""))}</li>`)
        .join("");
      parts.push(`<ol>${items}</ol>`);
    } else {
      const content = lines.map((line) => line.trim()).join(" ");
      parts.push(`<p>${renderInline(content)}</p>`);
    }
  }

  return parts.join("");
}

function isUnorderedListBlock(lines: string[]): boolean {
  const trimmed = lines.map((line) => line.trim()).filter(Boolean);
  return trimmed.length > 0 && trimmed.every((line) => /^[-*] /.test(line));
}

function isOrderedListBlock(lines: string[]): boolean {
  const trimmed = lines.map((line) => line.trim()).filter(Boolean);
  return trimmed.length > 0 && trimmed.every((line) => /^\d+\. /.test(line));
}

function renderInline(src: string): string {
  let result = "";
  let i = 0;

  while (i < src.length) {
    const rest = src.slice(i);

    const linkMatch = /^\[([^\]]+)\]\(([^)]+)\)/.exec(rest);
    if (linkMatch) {
      result += `<a href="${linkMatch[2].trim()}">${linkMatch[1]}</a>`;
      i += linkMatch[0].length;
      continue;
    }

    const boldMatch = /^\*\*([^*]+)\*\*/.exec(rest);
    if (boldMatch) {
      result += `<strong>${boldMatch[1]}</strong>`;
      i += boldMatch[0].length;
      continue;
    }

    const italicStarMatch = /^\*([^*]+)\*/.exec(rest);
    if (italicStarMatch) {
      result += `<em>${italicStarMatch[1]}</em>`;
      i += italicStarMatch[0].length;
      continue;
    }

    const italicUndMatch = /^_([^_]+)_/.exec(rest);
    if (italicUndMatch) {
      result += `<em>${italicUndMatch[1]}</em>`;
      i += italicUndMatch[0].length;
      continue;
    }

    const nextSpecial = rest.search(/[\[*_]/);
    if (nextSpecial === -1) {
      result += rest;
      break;
    }
    if (nextSpecial === 0) {
      result += rest[0];
      i += 1;
      continue;
    }
    result += rest.slice(0, nextSpecial);
    i += nextSpecial;
  }

  return result;
}
