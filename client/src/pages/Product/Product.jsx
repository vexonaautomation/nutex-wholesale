import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  BadgeCheck, Boxes, CheckCircle2, Info, Lock, PackageX, Ruler, ShoppingBag, Target,
} from 'lucide-react';
import { api } from '../../services/api.js';
import { useAsync, useSeo } from '../../hooks/index.js';
import { useStore } from '../../context/StoreContext.jsx';
import { useCart } from '../../context/CartContext.jsx';
import { ProductGallery } from '../../components/ProductGallery/ProductGallery.jsx';
import { ColorSelector } from '../../components/ColorSelector/ColorSelector.jsx';
import { SizeSelector } from '../../components/SizeSelector/SizeSelector.jsx';
import { QuantitySelector } from '../../components/QuantitySelector/QuantitySelector.jsx';
import { ProductCard } from '../../components/ProductCard/ProductCard.jsx';
import { PriceTag } from '../../components/common/PriceTag.jsx';
import { Modal } from '../../components/common/Modal.jsx';
import { EmptyState, ErrorState, PageLoader } from '../../components/common/ui.jsx';
import { formatINR, pct } from '../../utils/format.js';
import { displayDiscountPercent, priceModeFor, wholesaleOf } from '../../utils/pricing.js';
import { useCustomer } from '../../context/CustomerContext.jsx';
import { ExistingCustomerPrompt } from '../../components/ExistingCustomerLogin/ExistingCustomerLogin.jsx';

const sub = { textTransform: 'none', letterSpacing: 0 };

export default function Product() {
  const { slug } = useParams();
  const { data, loading, error, reload } = useAsync(() => api.get(`/api/products/${encodeURIComponent(slug)}`), [slug]);
  const { settings } = useStore();
  const cart = useCart();
  const customer = useCustomer();
  const navigate = useNavigate();
  const [color, setColor] = useState(null);
  const [buyAs, setBuyAs] = useState('BOX');
  const [sizeChart, setSizeChart] = useState(false);

  const product = data?.product;
  const percent = displayDiscountPercent(product, settings, cart.quote);
  // before the login: full MRP only (the cart shows the wholesale price)
  const priceMode = priceModeFor(settings, customer.isExisting);
  const mrpOnly = priceMode === 'SHOW_MRP';
  // Existing customers always choose box or loose pieces. New customers buy full
  // boxes - loose pieces only where Nutex opened them for this article.
  const pcsAllowed = customer.isExisting || settings?.pcs_for_existing_customers_only === false || product?.pcs_for_new_customers === true;
  const canBox = Boolean(product?.can_box);
  const canPcs = Boolean(product?.can_pcs);
  const pcsOpen = canPcs && pcsAllowed;

  useSeo({
    title: product ? `${product.seo_title || product.name} | Wholesale | ${settings?.company_name || 'Nutex'}` : undefined,
    description: product ? (product.seo_description || product.description || `${product.name} at wholesale prices.`).slice(0, 160) : undefined,
  });

  const pcsVariants = useMemo(() => (product?.variants || []).filter((v) => v.kind === 'PCS'), [product]);
  const colorAvailability = useMemo(() => {
    const m = {};
    for (const v of pcsVariants) if (v.color_id) m[v.color_id] = m[v.color_id] || v.purchasable;
    return m;
  }, [pcsVariants]);

  useEffect(() => {
    if (!product) return;
    // everyone starts with boxes; existing customers switch to pieces themselves
    setBuyAs(pcsOpen && !canBox ? 'PCS' : 'BOX');
    const firstAvailable = product.colors.find((c) => colorAvailability[c.color_id]) || product.colors[0];
    setColor(firstAvailable?.color_id || null);
  }, [product, pcsOpen, canBox, colorAvailability]);

  const inCart = useMemo(() => Object.fromEntries(cart.items.map((i) => [i.variant_id, i.qty])), [cart.items]);

  if (loading) return <PageLoader />;
  if (error) {
    return (
      <div className="container page">
        {error.status === 404
          ? <EmptyState icon={PackageX} title="Product is currently unavailable" action={<Link to="/shop" className="btn btn-primary">Browse products</Link>}>This product may be out of stock or no longer listed.</EmptyState>
          : <ErrorState error={error} onRetry={reload} />}
      </div>
    );
  }

  const mode = buyAs === 'PCS' && pcsOpen ? 'PCS' : canBox ? 'BOX' : null;
  const isBox = mode === 'BOX';
  const sizeOrder = new Map(product.sizes.map((s, i) => [s.size_id, i]));
  const bySize = (a, b) => (sizeOrder.get(a.size_id) ?? 0) - (sizeOrder.get(b.size_id) ?? 0);
  const priceVaries = product.mrp_max > product.mrp_min;
  // the catalogue size chart is a bra chart (28-42): show it for bra sizes only
  const isBraSize = (n) => /^\d{2}$/.test(n) && Number(n) >= 28 && Number(n) <= 56 && Number(n) % 2 === 0;
  const showSizeChart = Boolean(settings?.size_chart_url) && product.sizes.length > 0 && product.sizes.every((s) => isBraSize(s.size_name));
  const colorVariants = pcsVariants.filter((v) => v.color_id === color).sort(bySize);
  const boxVariants = (product.variants || []).filter((v) => v.kind === 'BOX').sort(bySize);
  const units = product.box_min_units === product.box_max_units ? product.box_min_units : null;
  // quantities typed here go straight into the cart (no "Add to cart" needed):
  // search the next product and these stay in the cart
  const setLine = (variantId, n) => cart.setLineQty(variantId, product.product_id, n);
  const selected = product.variants.filter((v) => inCart[v.variant_id] > 0).map((v) => [v.variant_id, inCart[v.variant_id]]);
  const selectedBoxes = selected.filter(([vid]) => product.variants.find((x) => x.variant_id === vid)?.kind === 'BOX').reduce((s, [, n]) => s + n, 0);
  const selectedUnits = selected.reduce((s, [, n]) => s + n, 0);
  const selectedPieces = selected.reduce((s, [vid, n]) => s + n * (product.variants.find((x) => x.variant_id === vid)?.units_per_box || 1), 0);
  const selectedValue = selected.reduce((s, [vid, n]) => {
    const v = product.variants.find((x) => x.variant_id === vid);
    return s + (mrpOnly ? v?.unit_mrp || 0 : wholesaleOf(v?.unit_mrp || 0, percent)) * n;
  }, 0);
  const switchTo = (m) => setBuyAs(m);

  const sizeChartLink = showSizeChart && <button type="button" className="link small" style={{ ...sub, display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }} onClick={() => setSizeChart(true)}><Ruler size={15} /> Size chart</button>;

  return (
    <div className="container page">
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link to="/">Home</Link><span>/</span>
        <Link to={`/category/${product.category_slug}`}>{product.category_name}</Link><span>/</span>
        <span>{product.name}</span>
      </nav>
      <div className="pdp">
        <ProductGallery images={product.images} name={product.name} />
        <div className="pdp-info">
          <span className="eyebrow">{product.category_name}{product.subcategory ? ` · ${product.subcategory}` : ''}</span>
          <h1>{product.name}</h1>
          <div className="pdp-sku">SKU {product.sku}</div>
          <div className="mt-2">
            <PriceTag mrp={priceVaries ? product.mrp_min : product.mrp} percent={percent} mode={priceMode} size="lg" unit={canBox ? 'pc' : ''} from={priceVaries} />
            {mrpOnly && <p className="small muted mt-1 mb-0">Your wholesale price is shown in the cart.</p>}
            {canBox && <p className="small muted mt-1 mb-0">Price per piece. {units ? `One box = ${units} pcs, so a box costs ${units} × the piece price.` : 'Box price = pieces in the box × piece price.'}</p>}
            {priceVaries && <p className="small muted mt-1 mb-0">Price depends on size - see the price next to each size below.</p>}
            {settings?.discount_mode === 'SLAB' && product.discount.mode !== 'CUSTOM' && (
              <p className="small muted mt-1 mb-0">Slab pricing: your discount depends on your total cart value. Final price is shown in the cart.</p>
            )}
          </div>
          {!product.in_stock && <div className="alert alert-error mt-2"><PackageX /> This product is currently out of stock.</div>}

          {(canBox || canPcs) && (
            <div className="pdp-block mt-2">
              <h3>Buy as</h3>
              <div className="buy-as" role="group" aria-label="Buy as">
                {canBox && (
                  <button type="button" className="buy-as-opt" aria-pressed={mode === 'BOX'} onClick={() => switchTo('BOX')}>
                    <Boxes /><span><strong>Full box{units ? ` (${units} pcs)` : ''}</strong><span className="small muted">Assorted colours, per size</span></span>
                  </button>
                )}
                {canPcs && (
                  <button type="button" className="buy-as-opt" aria-pressed={mode === 'PCS'} disabled={!pcsAllowed} onClick={() => switchTo('PCS')}>
                    {pcsAllowed ? <BadgeCheck /> : <Lock />}
                    <span><strong>Loose pieces</strong><span className="small muted">{pcsAllowed ? 'Choose colour, size and quantity' : 'For existing customers'}</span></span>
                  </button>
                )}
              </div>
              {canPcs && !pcsAllowed && (
                <p className="small muted mt-1 mb-0">
                  New customers order full boxes. After your first order you can also buy loose pieces in any colour.
                  {' '}Already bought from Nutex? <button type="button" className="link" onClick={customer.openLogin}>Verify on WhatsApp</button>
                </p>
              )}
            </div>
          )}

          {!mode && (
            <div className="alert alert-info mt-2">
              <Lock /> This article is sold in loose pieces to existing customers only.
              {' '}<button type="button" className="link" onClick={customer.openLogin}>Verify as existing customer on WhatsApp</button>
            </div>
          )}

          {mode === 'PCS' && product.colors.length > 0 && (
            <div className="pdp-block">
              <h3>Colour <span className="soft small" style={sub}>{product.colors.find((c) => c.color_id === color)?.color_name}</span></h3>
              <ColorSelector colors={product.colors} value={color} onChange={setColor} availability={colorAvailability} />
            </div>
          )}

          {mode === 'PCS' && (
            <div className="pdp-block">
              <h3>
                <span>Sizes &amp; quantity <span className="soft small" style={sub}>pieces</span></span>
                {sizeChartLink}
              </h3>
              <SizeSelector variants={colorVariants} quantities={inCart} onChange={setLine} showPrice={priceVaries} percent={percent} mode={priceMode} />
            </div>
          )}

          {mode === 'BOX' && (
            <div className="pdp-block">
              <h3><span>Boxes by size <span className="soft small" style={sub}>number of boxes</span></span>{sizeChartLink}</h3>
              <p className="small muted"><span className="mix-tag"><Boxes size={16} /> MIX COLOR BOX</span> - colours in a box are assorted (no colour choice).</p>
              <div className="stack">
                {boxVariants.map((v) => {
                  const inCartQty = inCart[v.variant_id] || 0;
                  const max = Math.max(0, v.available_qty);
                  return (
                    <div key={v.variant_id} className={`box-row ${inCartQty ? 'has-qty' : ''} ${v.purchasable ? '' : 'is-oos'}`}>
                      <div>
                        <div style={{ fontWeight: 700 }}>{v.size_name ? `Size ${v.size_name} · ` : ''}Box of {v.units_per_box} pcs</div>
                        <div className="small mt-1">
                          <PriceTag mrp={v.unit_mrp} percent={percent} mode={priceMode} unit="box" />
                        </div>
                        <div className="small soft">
                          {mrpOnly ? `MRP ${formatINR(v.piece_mrp)}` : formatINR(wholesaleOf(v.piece_mrp, percent))} per piece · {v.mixed_color_description || 'Assorted colours'}
                        </div>
                        <div className="small soft">{v.purchasable ? `${v.available_qty} boxes available${inCartQty ? ' · in cart' : ''}` : 'Out of stock'}</div>
                      </div>
                      <QuantitySelector value={inCartQty} max={max} disabled={(!v.purchasable || max === 0) && !inCartQty} onChange={(n) => setLine(v.variant_id, n)} label={`Number of boxes${v.size_name ? ` for size ${v.size_name}` : ''}`} />
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {mode && (
            <div className={`add-bar ${selectedUnits ? 'is-saved' : ''}`}>
              <div>
                <div style={{ fontWeight: 700 }}>
                  {selectedUnits
                    ? <><CheckCircle2 size={16} className="saved-tick" /> In your {cart.editing ? 'order' : 'cart'}: {selectedBoxes ? `${selectedBoxes} box(es) · ` : ''}{selectedPieces} pcs</>
                    : 'Enter quantities'}
                </div>
                <div className="small muted">
                  {selectedUnits
                    ? `${mrpOnly ? `MRP value ${formatINR(selectedValue)} · wholesale price in the cart` : `Approx. ${formatINR(selectedValue)} at ${pct(percent)} off`} · saved automatically - search the next product`
                    : `Quantities go straight into your ${cart.editing ? 'order' : 'cart'} - no need to press Add.`}
                </div>
              </div>
              <div className="row" style={{ gap: 8 }}>
                <Link to="/cart" className="btn"><ShoppingBag /> View {cart.editing ? 'order' : 'cart'}</Link>
                {!cart.editing && <Link to="/checkout" className={`btn btn-primary ${cart.quote?.can_checkout ? '' : 'is-disabled'}`} aria-disabled={!cart.quote?.can_checkout} onClick={(e) => { if (!cart.quote?.can_checkout) { e.preventDefault(); navigate('/cart'); } }}>Checkout</Link>}
              </div>
            </div>
          )}

          {settings && (customer.isExisting ? (
            <div className="mt-2"><ExistingCustomerPrompt /></div>
          ) : (
            <div className="info-tile mt-2">
              <Target />
              <div>
                Minimum wholesale order: <strong>{formatINR(settings.minimum_order_value)}</strong> final value after discount. Mix any products to reach it.
                {' '}Existing customer? <button type="button" className="link" onClick={customer.openLogin}>Verify on WhatsApp - no minimum, loose pieces allowed</button>
              </div>
            </div>
          ))}

          {product.description && (
            <div className="pdp-block mt-2">
              <h3>Description</h3>
              <div className="prose" style={{ whiteSpace: 'pre-line' }}>{product.description}</div>
            </div>
          )}
          <div className="pdp-block">
            <h3>Details</h3>
            <dl className="kv">
              <dt>SKU</dt><dd>{product.sku}</dd>
              <dt>Category</dt><dd>{product.category_name}</dd>
              <dt>Supplied as</dt>
              <dd>{[canBox && `Boxes of ${units || `${product.box_min_units}–${product.box_max_units}`} pcs (assorted colours)`, canPcs && `Loose pieces${settings?.pcs_for_existing_customers_only === false || product.pcs_for_new_customers ? '' : ' (existing customers)'}`].filter(Boolean).join(' · ')}</dd>
              {product.sizes.length > 0 && <><dt>Sizes</dt><dd>{product.sizes.map((s) => s.size_name).join(', ')}</dd></>}
              {product.colors.length > 0 && <><dt>Colours</dt><dd>{product.colors.map((c) => c.color_name).join(', ')}</dd></>}
            </dl>
          </div>
          <div className="info-tile"><Info /> Prices and stock are re-checked when you place the order.</div>
        </div>
      </div>

      {showSizeChart && (
        <Modal open={sizeChart} title="Size chart" onClose={() => setSizeChart(false)} size="lg">
          <img className="size-chart-img" src={settings.size_chart_url} alt="Nutex bra size chart: underbust, overbust and waist in inches" />
        </Modal>
      )}

      {data.related?.length > 0 && (
        <section className="mt-4" style={{ paddingTop: 32 }}>
          <div className="section-head"><div><span className="eyebrow">More from {product.category_name}</span><h2>You may also like</h2></div></div>
          <div className="product-grid">{data.related.slice(0, 4).map((p) => <ProductCard key={p.product_id} product={p} />)}</div>
        </section>
      )}
    </div>
  );
}
