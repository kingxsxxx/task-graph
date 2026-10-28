export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}
function inline(value) {
  let text = escapeHtml(value);
  text = text.replace(/\[([^\]]+)\]\(([^\s)]+)\)/g, (_, label, url) => {
    if (!/^https?:\/\//i.test(url)) return label;
    return `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  });
  return text.replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}
export function renderMarkdown(source) {
  const lines = String(source ?? '').replace(/\r\n/g, '\n').split('\n');
  const output = []; let code = null, paragraph = [], list = null;
  const flushParagraph = () => { if (paragraph.length) { output.push(`<p>${paragraph.map(inline).join('<br>')}</p>`); paragraph = []; } };
  const closeList = () => { if (list) { output.push(`</${list}>`); list = null; } };
  for (const line of lines) {
    if (line.startsWith('```')) {
      flushParagraph(); closeList();
      if (code === null) code = []; else { output.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`); code = null; }
      continue;
    }
    if (code !== null) { code.push(line); continue; }
    if (!line.trim()) { flushParagraph(); closeList(); continue; }
    const heading = line.match(/^(#{1,6})\s+(.+)$/), bullet = line.match(/^\s*[-*]\s+(.+)$/), ordered = line.match(/^\s*\d+\.\s+(.+)$/);
    if (heading) { flushParagraph(); closeList(); const level = heading[1].length; output.push(`<h${level}>${inline(heading[2])}</h${level}>`); }
    else if (bullet || ordered) {
      flushParagraph(); const type = bullet ? 'ul' : 'ol'; if (list !== type) { closeList(); output.push(`<${type}>`); list = type; }
      output.push(`<li>${inline((bullet ?? ordered)[1])}</li>`);
    } else if (/^>\s?/.test(line)) { flushParagraph(); closeList(); output.push(`<blockquote>${inline(line.replace(/^>\s?/, ''))}</blockquote>`); }
    else if (/^---+$/.test(line.trim())) { flushParagraph(); closeList(); output.push('<hr>'); }
    else { closeList(); paragraph.push(line); }
  }
  flushParagraph(); closeList(); if (code !== null) output.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
  return output.join('\n');
}
