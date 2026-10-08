import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  BookOpen, CheckCircle2, FolderTree, Layers, Palette, Rocket, Shirt,
} from 'lucide-react';
import { adminApi } from '../../services/auth.js';
import { useAsync } from '../../hooks/index.js';
import { useToast } from '../../context/ToastContext.jsx';
import { PageHeader, Stat } from '../components.jsx';
import {
  Alert, ErrorState, Field, PageLoader, Spinner,
} from '../../components/common/ui.jsx';
import { formatINR } from '../../utils/format.js';

const imgUrl = (rel) => `/api/admin/catalog-import/images/${rel}`;

function mrpLabel(p) {
  if (!p.size_mrp) return formatINR(p.mrp);
  const values = Object.values(p.size_mrp);
  return `${formatINR(Math.min(...values))} – ${formatINR(Math.max(...values))}`;
}

export default function CatalogImport() {
  const { data, loading, error, reload } = useAsync(() => adminApi.get('/catalog-import'), []);
  const toast = useToast();
  const [stock, setStock] = useState('0');
  // per category: how the products are sold and pieces per box (Nutex decides)
  const [selling, setSelling] = useState({});
  const [activate, setActivate] = useState(true);
  const [job, setJob] = useState(null);
  const [starting, setStarting] = useState(false);
  const [cat, setCat] = useState('');

  useEffect(() => { if (data?.job) setJob(data.job); }, [data]);
  useEffect(() => {
    if (!data?.summary) return;
    setSelling((cur) => Object.fromEntries(data.summary.categories.map((c) => [c.slug, cur[c.slug] || { units_per_box: '', pcs_for_new_customers: false }])));
  }, [data]);
  const setRow = (slug, patch) => setSelling((cur) => ({ ...cur, [slug]: { ...cur[slug], ...patch } }));

  // poll while an import is running
  const running = job?.status === 'running';
  useEffect(() => {
    if (!running) return undefined;
    const t = setInterval(async () => {
      try {
        const res = await adminApi.get('/catalog-import/status');
        setJob(res.job);
        if (res.job.status !== 'running') {
          if (res.job.status === 'done') toast.success(`Catalogue import finished: ${res.job.created} products created.`);
          else toast.error('Catalogue import stopped. Run it again to continue.');
          reload();
        }
      } catch { /* keep polling */ }
    }, 1500);
    return () => clearInterval(t);
  }, [running, reload, toast]);

  const products = useMemo(() => (data?.products || []).filter((p) => !cat || p.category === cat), [data, cat]);

  if (loading && !data) return <PageLoader />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  const { summary, plan } = data;
  const nothingToDo = plan.products_to_create === 0 && plan.existing_without_image === 0 && !plan.category_images_to_add.length;

  const start = async () => {
    // categories new customers could not buy at all (no box, pieces not opened)
    const closed = summary.categories.filter((c) => !(Number(selling[c.slug]?.units_per_box) >= 1) && !selling[c.slug]?.pcs_for_new_customers);
    if (closed.length && !window.confirm(`No box size for: ${closed.map((c) => c.name).join(', ')}.\nNew customers will not be able to buy these (existing customers can buy loose pieces). Continue?`)) return;
    setStarting(true);
    try {
      const payload = Object.fromEntries(Object.entries(selling).map(([slug, r]) => [slug, { units_per_box: Number(r.units_per_box) >= 1 ? Number(r.units_per_box) : null, pcs_for_new_customers: Boolean(r.pcs_for_new_customers) }]));
      const res = await adminApi.post('/catalog-import', {
        stock_per_variant: Number(stock) || 0, selling: payload, activate,
      });
      setJob(res.job);
      toast.success('Import started - you can keep this page open to watch progress.');
    } catch (e) {
      toast.error(e.message);
    } finally {
      setStarting(false);
    }
  };

  const percent = job?.total ? Math.round((job.done / job.total) * 100) : 0;

  return (
    <>
      <PageHeader
        title="Nutex catalogue import"
        subtitle={summary.source}
        actions={<Link to="/admin/products" className="btn"><Shirt /> Products</Link>}
      />

      <div className="stat-grid cols-4 mb-3">
        <Stat label="Products in catalogue" value={summary.products} icon={BookOpen} />
        <Stat label="Colour + size variants" value={summary.variants} icon={Layers} />
        <Stat label="Categories" value={summary.categories.length} icon={FolderTree} />
        <Stat label="Colours used" value={summary.colors} icon={Palette} />
      </div>

      <div className="adm-grid-2 mb-3">
        <section className="card card-pad">
          <h3 className="card-title">What the import will do</h3>
          <ul className="small" style={{ paddingLeft: 18, margin: 0, lineHeight: 1.7 }}>
            <li><strong>{plan.products_to_create}</strong> new products with <strong>{plan.variants_to_create}</strong> colour + size variants, one catalogue image each.</li>
            <li><strong>{plan.products_existing}</strong> products already exist (matched by SKU) - <strong>skipped</strong>, nothing about them is changed{plan.existing_without_image ? `, except ${plan.existing_without_image} without any image get their catalogue image` : ''}.</li>
            <li>New sizes: {plan.sizes_to_create.length ? plan.sizes_to_create.join(', ') : 'none'}.</li>
            <li>New colours: {plan.colors_to_create.length ? `${plan.colors_to_create.length} (${plan.colors_to_create.join(', ')})` : 'none'}.</li>
            <li>New categories: {plan.categories_to_create.length ? plan.categories_to_create.join(', ') : 'none'}{plan.category_images_to_add.length ? ` · cover images for ${plan.category_images_to_add.length} categories` : ''}.</li>
            <li>The Nutex logo and bra size chart are set only if those settings are still empty.</li>
          </ul>
          <p className="tiny soft mt-1 mb-0">Additive only: no row is deleted or overwritten. Safe to run again - it continues with whatever is missing.</p>
        </section>

        <section className="card card-pad stack">
          <h3 className="card-title">Run the import</h3>
          {!data.drive_enabled && <Alert type="warning">Google Drive is not connected - products will be created without images. Connect Drive first (GOOGLE_DRIVE_FOLDER_ID), or run the import again later to attach images.</Alert>}
          {plan.inactive_categories.length > 0 && <Alert type="warning">Inactive categories: {plan.inactive_categories.join(', ')} - their products stay hidden until you reactivate them.</Alert>}
          {summary.to_check.length > 0 && (
            <Alert type="info">
              Please check after import: {summary.to_check.map((c) => `${c.name} - ${c.check}`).join(' ')}
            </Alert>
          )}
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Category</th><th>Pcs / box</th><th>Pcs for new customers</th></tr></thead>
              <tbody>
                {summary.categories.map((c) => {
                  const r = selling[c.slug] || { units_per_box: '', pcs_for_new_customers: false };
                  return (
                    <tr key={c.slug}>
                      <td className="cell-main">{c.name}<div className="cell-sub">{c.products} products</div></td>
                      <td>
                        <input className="input input-sm" style={{ width: 80 }} type="number" min={1} placeholder="e.g. 6" value={r.units_per_box} onChange={(e) => setRow(c.slug, { units_per_box: e.target.value.replace(/[^\d]/g, '') })} disabled={running} aria-label={`Pieces per box for ${c.name}`} />
                      </td>
                      <td>
                        <label className="check small"><input type="checkbox" checked={Boolean(r.pcs_for_new_customers)} onChange={(e) => setRow(c.slug, { pcs_for_new_customers: e.target.checked })} disabled={running} /> Allow</label>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="tiny soft mb-0">One box per size, assorted colours; box price = pieces × piece MRP; blank = no box. Existing customers can always buy a box or loose pieces. New customers buy boxes only - tick "Allow" to let them buy loose pieces too. Change later in Products → select → Box / pieces.</p>
          <div className="form-grid">
            <Field label="Starting stock: pieces per colour + size" hint="0 = enter real stock later in Inventory; e.g. 50 to test ordering. Boxes are packed from these pieces.">
              <input className="input" type="number" min={0} max={100000} value={stock} onChange={(e) => setStock(e.target.value)} disabled={running} />
            </Field>
          </div>
          <label className="check"><input type="checkbox" checked={activate} onChange={(e) => setActivate(e.target.checked)} disabled={running} /> Publish products immediately (Active). Untick to import as Inactive and publish later.</label>
          <button type="button" className="btn btn-primary btn-lg" onClick={start} disabled={running || starting || nothingToDo}>
            {running || starting ? <Spinner small /> : nothingToDo ? <CheckCircle2 /> : <Rocket />}
            {running ? 'Importing…' : nothingToDo ? 'Everything is already imported' : `Import ${plan.products_to_create} products`}
          </button>
          {job && job.status !== 'idle' && (
            <div className="stack" style={{ gap: 8 }}>
              <div className="row-between small"><strong>{job.phase}</strong><span>{job.done}/{job.total} · created {job.created} · skipped {job.skipped}</span></div>
              <div className={`progress ${job.status === 'done' ? 'is-complete' : ''}`}><span style={{ width: `${job.status === 'done' ? 100 : percent}%` }} /></div>
              {job.errors.length > 0 && <Alert type="warning">{job.errors.slice(-5).join(' · ')}</Alert>}
              <pre className="tiny" style={{ maxHeight: 160, overflow: 'auto', background: 'var(--ink-50)', padding: 10, borderRadius: 8, whiteSpace: 'pre-wrap', margin: 0 }}>{job.log.join('\n')}</pre>
              {job.status === 'done' && <Link to="/admin/products" className="btn">View products</Link>}
            </div>
          )}
        </section>
      </div>

      <section className="card card-pad">
        <div className="row-between wrap mb-2">
          <h3 className="card-title mb-0">Catalogue preview - one product per catalogue page</h3>
          <select className="select" style={{ width: 'auto' }} value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Category">
            <option value="">All categories ({data.products.length})</option>
            {summary.categories.map((c) => <option key={c.slug} value={c.slug}>{c.name} ({c.products})</option>)}
          </select>
        </div>
        <div className="catalog-grid">
          {products.map((p) => (
            <article key={p.sku} className="catalog-tile">
              <div className="ph">
                {p.image && <img src={imgUrl(p.image)} alt={p.name} loading="lazy" />}
                {p.exists && <span className="badge badge-success">In store</span>}
              </div>
              <div className="catalog-tile-body">
                <strong>{p.name}</strong>
                <span className="tiny soft">SKU {p.sku} · MRP {mrpLabel(p)}</span>
                <span className="dot-row" title={p.colors.join(', ')}>
                  {p.colors.map((c) => <i key={c} className="swatch-dot swatch-dot-sm" style={{ background: data.color_hex[c] || '#ddd' }} />)}
                  <span className="tiny soft">{p.colors.length} colour{p.colors.length > 1 ? 's' : ''}</span>
                </span>
                <span className="tiny soft">Sizes {p.sizes.join(', ')}</span>
              </div>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}
