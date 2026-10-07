import { Link } from 'react-router-dom';
import { Boxes } from 'lucide-react';
import { useStore } from '../../context/StoreContext.jsx';
import { useCart } from '../../context/CartContext.jsx';
import { PriceTag } from '../common/PriceTag.jsx';
import { Img } from '../common/ui.jsx';
import { displayDiscountPercent } from '../../utils/pricing.js';

// "30–40", "80-90 / 95-100", "45-55 to 95-100" (size names may contain hyphens)
function sizeRange(sizes) {
  const names = sizes.map((s) => s.size_name);
  if (names.length <= 3) return names.join(' / ');
  return `${names[0]}${names.some((n) => n.includes('-')) ? ' to ' : '–'}${names[names.length - 1]}`;
}

export function ProductCard({ product }) {
  const { settings } = useStore();
  const { quote } = useCart();
  const percent = displayDiscountPercent(product, settings, quote);
  const canBox = product.can_box ?? product.inventory_mode === 'BOX_WISE';
  const canPcs = product.can_pcs ?? product.inventory_mode !== 'BOX_WISE';
  const units = product.box_min_units === product.box_max_units ? product.box_min_units : null;
  const [first, second] = product.images || [];
  const sizes = product.sizes || [];
  return (
    <article className={`p-card ${product.in_stock ? '' : 'is-oos'}`}>
      <Link to={`/product/${product.slug}`} className="p-card-media" aria-label={product.name}>
        <div className="p-card-badges">
          {!product.in_stock && <span className="badge badge-dark">Out of stock</span>}
          {canBox && <span className="badge badge-gold"><Boxes /> {units ? `Box of ${units} pcs` : 'Box'}{canPcs ? '' : ' only'}</span>}
          {product.featured && product.in_stock && <span className="badge badge-brand">Featured</span>}
        </div>
        <Img src={first?.url} alt={first?.alt || product.name} label={product.name} />
        {second && <img className="alt" src={second.url} alt="" loading="lazy" aria-hidden="true" />}
      </Link>
      <div className="p-card-body">
        <span className="p-card-cat">{product.category_name}</span>
        <Link to={`/product/${product.slug}`} className="p-card-name">{product.name}</Link>
        <PriceTag mrp={product.mrp_min ?? product.mrp} percent={percent} mode={settings?.price_display_mode} unit={canBox ? 'pc' : ''} from={product.mrp_max > product.mrp_min} />
        <div className="p-card-meta">
          {!canPcs ? (
            <span>Assorted colours</span>
          ) : (
            <span className="dot-row">
              {product.colors.slice(0, 5).map((c) => <i key={c.color_id} className="swatch-dot swatch-dot-sm" style={{ background: c.hex_code || '#ddd' }} title={c.color_name} />)}
              {product.colors.length > 5 && <span>+{product.colors.length - 5}</span>}
            </span>
          )}
          {sizes.length > 0 && <span>{sizeRange(sizes)}</span>}
        </div>
      </div>
    </article>
  );
}

export function ProductGridSkeleton({ count = 8 }) {
  return (
    <div className="product-grid">
      {Array.from({ length: count }, (_, i) => (
        <div key={i}>
          <div className="skeleton" style={{ aspectRatio: '1 / 1', borderRadius: 14 }} />
          <div className="skeleton mt-1" style={{ height: 12, width: '50%' }} />
          <div className="skeleton mt-1" style={{ height: 16, width: '85%' }} />
          <div className="skeleton mt-1" style={{ height: 16, width: '40%' }} />
        </div>
      ))}
    </div>
  );
}
