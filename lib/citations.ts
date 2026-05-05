// lib/citations.ts
//
// Inline-citation pre-processor. The chat system prompt asks the model to
// mark each claim drawn from a reference with `[N]` (1-indexed source
// number). We rewrite those `[N]` tokens into markdown links pointing at
// `#cite-<N>` anchors so ReactMarkdown renders them as clickable elements;
// the AssistantBlock's components.a override intercepts those hrefs and
// scrolls the matching SourcesPanel entry into view.
//
// We escape the brackets inside the link text so ReactMarkdown shows
// `[1]` instead of just `1`. Without escaping, the inner brackets would
// be parsed as link reference syntax.

const CITATION_RE = /\[(\d+)\]/g;

export function processInlineCitations(content: string, sourceCount: number): string {
  if (!content || sourceCount <= 0) return content;

  // Avoid replacing inside fenced code blocks; the LLM can legitimately
  // emit `[1]` inside a snippet (e.g. array indexing) and we'd corrupt
  // the syntax by linkifying it.
  const segments = splitOnFencedCodeBlocks(content);
  return segments
    .map(seg =>
      seg.kind === "code" ? seg.text : seg.text.replace(CITATION_RE, (whole, n) => {
        const idx = Number(n);
        if (!Number.isInteger(idx) || idx < 1 || idx > sourceCount) return whole;
        return `[\\[${idx}\\]](#cite-${idx})`;
      })
    )
    .join("");
}

interface Segment {
  kind: "text" | "code";
  text: string;
}

function splitOnFencedCodeBlocks(content: string): Segment[] {
  const out: Segment[] = [];
  const re = /```[\s\S]*?```/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    if (m.index > lastIndex) {
      out.push({ kind: "text", text: content.slice(lastIndex, m.index) });
    }
    out.push({ kind: "code", text: m[0] });
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < content.length) {
    out.push({ kind: "text", text: content.slice(lastIndex) });
  }
  return out;
}

// Parse a #cite-N href. Returns the 1-indexed citation number or null.
export function parseCitationHref(href: string | undefined | null): number | null {
  if (!href) return null;
  const m = href.match(/^#cite-(\d+)$/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isInteger(n) && n > 0 ? n : null;
}
