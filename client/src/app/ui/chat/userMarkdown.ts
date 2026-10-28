/**
 * A user prompt as Markdown that renders the way it was typed in the composer
 * (F2), where a newline is a newline. CommonMark would fold a single newline
 * into a space and read words after an opening fence as its language, so:
 * a line followed by another non-blank line ends in a hard break, and a fence
 * whose info string has spaces (```` ```then a code block ````) keeps those
 * words as the block's first line. Code inside fences is left untouched.
 */
const FENCE_RE = /^( *)(`{3,}|~{3,})(.*)$/;

/** An opening fence, unless it is a backtick run with a backtick after it (inline code). */
function openingFence(line: string): RegExpExecArray | null {
  const m = FENCE_RE.exec(line);
  return m && !(m[2][0] === '`' && m[3].includes('`')) ? m : null;
}

export function userMarkdown(text: string): string {
  const lines = text.split('\n');
  const out: string[] = [];
  let fence: string | null = null;
  lines.forEach((line, i) => {
    if (fence) {
      out.push(line);
      const m = FENCE_RE.exec(line);
      if (m && m[2][0] === fence[0] && m[2].length >= fence.length && !m[3].trim()) fence = null;
      return;
    }
    const open = openingFence(line);
    if (open) {
      fence = open[2];
      const info = open[3].trim();
      out.push(...(/\s/.test(info) ? [open[1] + open[2], open[1] + info] : [line]));
      return;
    }
    const next = lines[i + 1];
    const breaks = line.trim() && next?.trim() && !openingFence(next);
    out.push(breaks ? `${line.replace(/ +$/, '')}  ` : line);
  });
  return out.join('\n');
}
