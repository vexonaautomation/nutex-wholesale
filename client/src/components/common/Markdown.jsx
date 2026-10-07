// Minimal, safe Markdown renderer for admin-editable policy pages.
// Builds React elements (no dangerouslySetInnerHTML), so stored text can
// never inject HTML/scripts.
function inline(text, keyBase) {
  const parts = String(text).split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) => (p.startsWith('**') && p.endsWith('**')
    ? <strong key={`${keyBase}-${i}`}>{p.slice(2, -2)}</strong>
    : p));
}

export function Markdown({ text }) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  const out = [];
  let list = null;
  let para = [];
  const flushPara = () => {
    if (para.length) out.push(<p key={`p${out.length}`}>{inline(para.join(' '), out.length)}</p>);
    para = [];
  };
  const flushList = () => {
    if (list) {
      const Tag = list.ordered ? 'ol' : 'ul';
      out.push(<Tag key={`l${out.length}`}>{list.items.map((it, i) => <li key={i}>{inline(it, `${out.length}-${i}`)}</li>)}</Tag>);
    }
    list = null;
  };
  for (const raw of lines) {
    const line = raw.trim();
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    const ul = line.match(/^[-*]\s+(.*)$/);
    const ol = line.match(/^\d+[.)]\s+(.*)$/);
    if (!line) {
      flushPara();
      flushList();
    } else if (h) {
      flushPara();
      flushList();
      const Tag = h[1].length === 1 ? 'h1' : h[1].length === 2 ? 'h2' : 'h3';
      out.push(<Tag key={`h${out.length}`} className={Tag === 'h1' ? 'page-title' : undefined}>{inline(h[2], out.length)}</Tag>);
    } else if (ul || ol) {
      flushPara();
      const ordered = Boolean(ol);
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { ordered, items: [] };
      }
      list.items.push((ul || ol)[1]);
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara();
  flushList();
  return <div className="prose">{out}</div>;
}
