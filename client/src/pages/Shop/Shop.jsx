import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { SlidersHorizontal, SearchX, X } from 'lucide-react';
import { useStore } from '../../context/StoreContext.jsx';
import { api, qs } from '../../services/api.js';
import { useAsync, useSeo } from '../../hooks/index.js';
import { ProductCard, ProductGridSkeleton } from '../../components/ProductCard/ProductCard.jsx';
import { EmptyState, ErrorState } from '../../components/common/ui.jsx';
import { Drawer } from '../../components/common/Modal.jsx';

const SORTS = [
  ['featured', 'Featured'],
  ['newest', 'Newest'],
  ['price_asc', 'MRP: low to high'],
  ['price_desc', 'MRP: high to low'],
  ['name', 'Name A–Z'],
];

function Filters({ category, params, setParam }) {
  const { groups, sizes, colors } = useStore();
  return (
    <div>
      <div className="filter-block">
        <h4>Categories</h4>
        <div className="filter-list">
          <Link to="/shop" className={!category ? 'active' : ''}>All products</Link>
          {groups.flatMap((g) => g.categories).map((c) => (
            <Link key={c.category_id} to={`/category/${c.slug}`} className={category?.slug === c.slug ? 'active' : ''}>
              <span>{c.name}</span><span className="soft">{c.product_count}</span>
            </Link>
          ))}
        </div>
      </div>
      {sizes.length > 0 && (
        <div className="filter-block">
          <h4>Size</h4>
          <div className="chips">
            {sizes.map((s) => (
              <button key={s.size_id} type="button" className="chip" aria-pressed={params.get('size') === s.size_id} onClick={() => setParam('size', params.get('size') === s.size_id ? '' : s.size_id)}>
                {s.size_name}
              </button>
            ))}
          </div>
        </div>
      )}
      {colors.length > 0 && (
        <div className="filter-block">
          <h4>Colour</h4>
          <div className="chips">
            {colors.map((c) => (
              <button key={c.color_id} type="button" className="chip" aria-pressed={params.get('color') === c.color_id} onClick={() => setParam('color', params.get('color') === c.color_id ? '' : c.color_id)}>
                <i className="swatch-dot swatch-dot-sm" style={{ background: c.hex_code || '#ddd' }} /> {c.color_name}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="filter-block">
        <label className="check">
          <input type="checkbox" checked={params.get('in_stock') === 'true'} onChange={(e) => setParam('in_stock', e.target.checked ? 'true' : '')} />
          In stock only
        </label>
      </div>
    </div>
  );
}

export default function Shop({ category = null }) {
  const [params, setParams] = useSearchParams();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const { settings } = useStore();
  const page = Number(params.get('page') || 1);
  const query = {
    category: category?.slug,
    q: params.get('q'),
    size: params.get('size'),
    color: params.get('color'),
    in_stock: params.get('in_stock'),
    sort: params.get('sort') || 'featured',
    page,
    limit: 24,
  };
  const { data, loading, error, reload } = useAsync(() => api.get(`/api/products${qs(query)}`), [JSON.stringify(query)]);

  const company = settings?.company_name || 'Nutex';
  useSeo({
    title: category ? `${category.seo_title || `${category.name} Wholesale`} | ${company}` : `Shop Wholesale Innerwear | ${company}`,
    description: category?.seo_description || category?.description || `Browse ${company}'s wholesale catalogue of bras, panties, lingerie sets, camisoles and men's innerwear.`,
  });

  const setParam = (k, v) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    if (k !== 'page') next.delete('page');
    setParams(next, { replace: true });
  };
  const activeFilters = ['q', 'size', 'color', 'in_stock'].filter((k) => params.get(k));
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;

  return (
    <div className="container page">
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link to="/">Home</Link><span>/</span>
        {category ? <><Link to="/shop">Shop</Link><span>/</span><span>{category.name}</span></> : <span>Shop</span>}
      </nav>
      <h1 className="page-title">{category ? category.name : params.get('q') ? `Results for “${params.get('q')}”` : 'All products'}</h1>
      {category?.description && <p className="muted" style={{ maxWidth: 720 }}>{category.description}</p>}

      <div className="shop-layout mt-3">
        <aside className="filters" aria-label="Filters"><Filters category={category} params={params} setParam={setParam} /></aside>
        <div>
          <div className="toolbar">
            <div className="row wrap">
              <button type="button" className="btn btn-sm mobile-only" onClick={() => setFiltersOpen(true)}><SlidersHorizontal /> Filters</button>
              <span className="small muted">{data ? `${data.total} products` : ' '}</span>
              {activeFilters.map((k) => (
                <button key={k} type="button" className="badge badge-outline" onClick={() => setParam(k, '')} style={{ cursor: 'pointer' }}>
                  {k === 'q' ? `“${params.get('q')}”` : k === 'in_stock' ? 'In stock' : k === 'size' ? 'Size' : 'Colour'} <X />
                </button>
              ))}
            </div>
            <select className="select" value={query.sort} onChange={(e) => setParam('sort', e.target.value)} aria-label="Sort products">
              {SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          {loading ? <ProductGridSkeleton /> : error ? <ErrorState error={error} onRetry={reload} /> : !data.items.length ? (
            <EmptyState icon={SearchX} title="No products found" action={<Link to="/shop" className="btn">View all products</Link>}>
              Try removing a filter or searching for a different product name or SKU.
            </EmptyState>
          ) : (
            <>
              <div className="product-grid">{data.items.map((p) => <ProductCard key={p.product_id} product={p} />)}</div>
              {totalPages > 1 && (
                <div className="row mt-4" style={{ justifyContent: 'center' }}>
                  <button type="button" className="btn btn-sm" disabled={page <= 1} onClick={() => setParam('page', String(page - 1))}>Previous</button>
                  <span className="small muted">Page {page} of {totalPages}</span>
                  <button type="button" className="btn btn-sm" disabled={page >= totalPages} onClick={() => setParam('page', String(page + 1))}>Next</button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
      <Drawer open={filtersOpen} onClose={() => setFiltersOpen(false)} title="Filters" side="left" footer={<button type="button" className="btn btn-primary btn-block" onClick={() => setFiltersOpen(false)}>Show products</button>}>
        <Filters category={category} params={params} setParam={setParam} />
      </Drawer>
    </div>
  );
}
