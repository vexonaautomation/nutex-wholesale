import { Link, useParams } from 'react-router-dom';
import { useStore } from '../../context/StoreContext.jsx';
import { useSeo } from '../../hooks/index.js';
import { POLICY_PAGES } from '../../constants/index.js';
import { LEGAL_TEMPLATES, fillTemplate } from '../../utils/legal.js';
import { Markdown } from '../../components/common/Markdown.jsx';
import { EmptyState, PageLoader } from '../../components/common/ui.jsx';

export default function Legal() {
  const { slug } = useParams();
  const { settings } = useStore();
  const page = POLICY_PAGES.find((p) => p.slug === slug);
  useSeo({ title: page ? `${page.title} | ${settings?.company_name || 'Nutex'}` : 'Policy', description: page ? `${page.title} for wholesale orders.` : undefined });
  if (!page) return <div className="container page"><EmptyState title="Page not found" action={<Link to="/" className="btn">Go home</Link>} /></div>;
  if (!settings) return <PageLoader />;
  const text = fillTemplate(settings[page.key] || LEGAL_TEMPLATES[page.key], settings);
  return (
    <div className="container page" style={{ maxWidth: 860 }}>
      <nav className="crumbs"><Link to="/">Home</Link><span>/</span><span>{page.title}</span></nav>
      <Markdown text={text} />
      <div className="divider" />
      <div className="chips">
        {POLICY_PAGES.filter((p) => p.slug !== slug).map((p) => <Link key={p.slug} to={`/policies/${p.slug}`} className="chip">{p.title}</Link>)}
      </div>
    </div>
  );
}
