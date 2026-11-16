// Small safe Markdown renderer for bounty descriptions and rules.
//
// The API's text is Markdown. We escape HTML first, then render a useful
// subset: fenced code, headings, bold, italic, inline code, links, lists,
// blockquotes and rules. Links open in a new tab with rel="noopener".

import { esc } from './format.js';

function inline(text) {
  // Inline code first, so its contents are never re-processed.
  const codes = [];
  let out = text.replace(/`([^`\n]+)`/g, (_m, code) => {
    codes.push(code);
    return '\u0000' + (codes.length - 1) + '\u0000';
  });
  out = out
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    // Triple asterisks first, so ***x*** does not fall through to the bold pass.
    .replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>')
    // Bold may contain italic markers (**a *b* c**), so allow * inside.
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>');
  out = out.replace(/\u0000(\d+)\u0000/g, (_m, i) => '<code>' + codes[Number(i)] + '</code>');
  return out;
}

/** Render Markdown text to safe HTML. Empty or non-string input renders ''. */
export function renderMarkdown(md) {
  if (!md || typeof md !== 'string') return '';
  const lines = esc(md).replace(/\r\n/g, '\n').split('\n');
  const html = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    // Fenced code block.
    if (/^```/.test(line)) {
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      html.push('<pre><code>' + buf.join('\n') + '</code></pre>');
      continue;
    }
    // Headings.
    const head = line.match(/^(#{1,3})\s+(.*)$/);
    if (head) {
      const level = head[1].length;
      html.push('<h' + (level + 1) + '>' + inline(head[2]) + '</h' + (level + 1) + '>');
      i++;
      continue;
    }
    // Horizontal rule.
    if (/^---+$/.test(line.trim())) {
      html.push('<hr>');
      i++;
      continue;
    }
    // Blockquote.
    if (/^&gt;\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^&gt;\s?/.test(lines[i])) buf.push(lines[i++].replace(/^&gt;\s?/, ''));
      html.push('<blockquote>' + inline(buf.join(' ')) + '</blockquote>');
      continue;
    }
    // Unordered list.
    if (/^[-*]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) items.push('<li>' + inline(lines[i++].replace(/^[-*]\s+/, '')) + '</li>');
      html.push('<ul>' + items.join('') + '</ul>');
      continue;
    }
    // Ordered list.
    if (/^\d+[.)]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\d+[.)]\s+/.test(lines[i])) items.push('<li>' + inline(lines[i++].replace(/^\d+[.)]\s+/, '')) + '</li>');
      html.push('<ol>' + items.join('') + '</ol>');
      continue;
    }
    // Blank line: paragraph break.
    if (line.trim() === '') {
      i++;
      continue;
    }
    // Paragraph: gather consecutive plain lines.
    const buf = [line];
    i++;
    while (i < lines.length && lines[i].trim() !== '' && !/^(#{1,3}\s|```|[-*]\s|\d+[.)]\s|&gt;\s?|---+$)/.test(lines[i])) {
      buf.push(lines[i]);
      i++;
    }
    html.push('<p>' + inline(buf.join(' ')) + '</p>');
  }
  return html.join('\n');
}
