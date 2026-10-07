import { Link } from 'react-router-dom';
import {
  ArrowRight, BadgeCheck, BadgePercent, Boxes, LockKeyhole, MessageCircle, PackageSearch, QrCode, Ruler, ShieldCheck, Target, Truck,
} from 'lucide-react';
import { useStore } from '../../context/StoreContext.jsx';
import { api } from '../../services/api.js';
import { useAsync, useSeo } from '../../hooks/index.js';
import { ProductCard, ProductGridSkeleton } from '../../components/ProductCard/ProductCard.jsx';
import { Img } from '../../components/common/ui.jsx';
import { WhatsAppIcon } from '../../components/common/Icons.jsx';
import { formatINR, pct } from '../../utils/format.js';
import { discountHeadline, maxSlabPercent, wholesaleOf } from '../../utils/pricing.js';
import { waLink, waNumber } from '../../utils/whatsapp.js';
import { useCustomer } from '../../context/CustomerContext.jsx';
import { ExistingCustomerPrompt } from '../../components/ExistingCustomerLogin/ExistingCustomerLogin.jsx';

const titleCase = (s) => s.charAt(0) + s.slice(1).toLowerCase();

function GroupSection({ group }) {
  const { data, loading } = useAsync(() => api.get(`/api/products?parent=${encodeURIComponent(group.name)}&limit=4`), [group.name]);
  if (!loading && !data?.items?.length) return null;
  return (
    <section className="section">
      <div className="container">
        <div className="section-head">
          <div>
            <span className="eyebrow">{titleCase(group.name)}</span>
            <h2>{titleCase(group.name)} collection</h2>
          </div>
          <Link to={`/category/${group.categories[0]?.slug}`} className="btn btn-sm">View all <ArrowRight /></Link>
        </div>
        <div className="group-cats">
          {group.categories.map((c) => <Link key={c.category_id} to={`/category/${c.slug}`} className="chip">{c.name}</Link>)}
        </div>
        {loading ? <ProductGridSkeleton count={4} /> : (
          <div className="product-grid">{data.items.map((p) => <ProductCard key={p.product_id} product={p} />)}</div>
        )}
      </div>
    </section>
  );
}

export default function Home() {
  const { settings, categories, groups, slabs } = useStore();
  const featured = useAsync(() => api.get('/api/products?featured=true&limit=8'), []);
  const customer = useCustomer();
  const company = settings?.company_name || 'Nutex Apparel Limited';
  useSeo({
    title: `${company} | Wholesale Bras, Panties & Lingerie`,
    description: `Wholesale ordering from ${company}: bras, panties, lingerie sets, camisoles and men's innerwear at wholesale prices.`,
  });
  const slabMode = settings?.discount_mode === 'SLAB';
  const examplePct = slabMode ? maxSlabPercent(slabs) : Number(settings?.default_discount_percent || 0);
  const exampleMrp = 500;
  const wa = waNumber(settings);

  return (
    <>
      {/* HERO */}
      <section className="hero">
        <div className="container hero-inner">
          <div>
            <span className="eyebrow">{company} · Wholesale</span>
            <h1>{settings?.hero_title || 'Wholesale innerwear, direct from Nutex'}</h1>
            <p className="hero-sub">{settings?.hero_subtitle}</p>
            <div className="hero-cta">
              <Link to="/shop" className="btn btn-primary btn-lg">Shop wholesale catalogue <ArrowRight /></Link>
              <a href="#how-it-works" className="btn btn-lg">How ordering works</a>
            </div>
            {settings && (
              <div className="hero-facts">
                {customer.isExisting
                  ? <span className="fact" style={{ borderColor: '#c4e7d3', color: 'var(--success-700)' }}><BadgeCheck /> Existing customer · no minimum</span>
                  : <span className="fact"><Target /> Minimum order {formatINR(settings.minimum_order_value)}</span>}
                <span className="fact"><BadgePercent /> {discountHeadline(settings, slabs)}</span>
                <span className="fact"><QrCode /> Pay by UPI QR</span>
              </div>
            )}
            {settings && !customer.isExisting && (
              <div className="mt-2" style={{ maxWidth: 520 }}><ExistingCustomerPrompt /></div>
            )}
          </div>
          {settings && (
            <div className="price-card" aria-label="Wholesale pricing example">
              <div className="pc-head">
                <span className="eyebrow">Pricing example</span>
                <span className="badge badge-success">{slabMode ? `Up to ${pct(examplePct)}` : pct(examplePct)} OFF</span>
              </div>
              <div className="pc-row"><span className="muted">Product MRP</span><span className="pc-mrp num">{formatINR(exampleMrp)}</span></div>
              <div className="pc-row"><span className="muted">Wholesale discount</span><strong>{pct(examplePct)}</strong></div>
              <div className="pc-row">
                <span className="muted">You pay per piece</span>
                <span className="pc-big num">{formatINR(wholesaleOf(exampleMrp, examplePct))}</span>
              </div>
              <div className="pc-note">
                Illustration only. Final prices are calculated by our system in your cart.
                Orders need a final payable value of at least <strong>{formatINR(settings.minimum_order_value)}</strong>.
              </div>
            </div>
          )}
        </div>
      </section>

      {/* SHOP BY CATEGORY */}
      {categories.length > 0 && (
        <section className="section">
          <div className="container">
            <div className="section-head">
              <div>
                <span className="eyebrow">Shop by category</span>
                <h2>Our wholesale collections</h2>
              </div>
              <Link to="/shop" className="btn btn-sm">All products <ArrowRight /></Link>
            </div>
            <div className="cat-grid">
              {categories.map((c) => (
                <Link key={c.category_id} to={`/category/${c.slug}`} className="cat-card">
                  <div className="cat-img"><Img src={c.image_url} alt={c.name} label={c.name} /></div>
                  <div className="cat-body">
                    <h3>{c.name}</h3>
                    <span>{c.product_count} {c.product_count === 1 ? 'product' : 'products'}</span>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* FEATURED */}
      {(featured.loading || featured.data?.items?.length > 0) && (
        <section className="section section-muted">
          <div className="container">
            <div className="section-head">
              <div>
                <span className="eyebrow">Featured</span>
                <h2>Featured products</h2>
              </div>
            </div>
            {featured.loading ? <ProductGridSkeleton count={4} /> : (
              <div className="product-grid">{featured.data.items.map((p) => <ProductCard key={p.product_id} product={p} />)}</div>
            )}
          </div>
        </section>
      )}

      {/* GROUPS: Women / Panties / Men ... (dynamic from category parent groups) */}
      {groups.map((g) => <GroupSection key={g.name} group={g} />)}

      {/* MINIMUM ORDER + DISCOUNT */}
      {settings && (
        <section className="section section-blush">
          <div className="container two-col" style={{ alignItems: 'stretch' }}>
            <div className="card card-pad">
              <span className="eyebrow">Wholesale pricing</span>
              <h2 className="display" style={{ fontSize: 28, margin: '8px 0 10px' }}>{discountHeadline(settings, slabs)}</h2>
              {slabMode ? (
                <>
                  <p className="muted">Your discount depends on your cart value. The bigger the order, the bigger the discount.</p>
                  <table className="slab-table">
                    <thead><tr><th>Cart value</th><th style={{ textAlign: 'right' }}>Discount</th></tr></thead>
                    <tbody>
                      {slabs.map((s) => (
                        <tr key={s.slab_id}>
                          <td>{formatINR(s.min_amount)} {s.max_amount === null ? 'and above' : `– ${formatINR(s.max_amount)}`}</td>
                          <td>{pct(s.discount_percent)} OFF</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              ) : (
                <p className="muted">A flat {pct(settings.default_discount_percent)} discount on MRP applies to every product, and your cart shows the exact amount before you order.</p>
              )}
            </div>
            <div className="card card-pad">
              <span className="eyebrow">Minimum order</span>
              <h2 className="display" style={{ fontSize: 28, margin: '8px 0 10px' }}>{formatINR(settings.minimum_order_value)} minimum wholesale order</h2>
              <p className="muted">The minimum is checked on your <strong>final payable value after discount</strong>. Your cart shows exactly how much more is needed.</p>
              <div className="info-tile mt-2"><ShieldCheck /> Checkout unlocks automatically once your final payable total reaches {formatINR(settings.minimum_order_value)}.</div>
              <div className="info-tile mt-1">
                <BadgeCheck />
                <div>
                  <strong>Existing Nutex customers:</strong> {Number(settings.existing_customer_minimum_order_value) > 0 ? `minimum order only ${formatINR(settings.existing_customer_minimum_order_value)}` : 'no minimum order - buy even a single piece'}.{' '}
                  {customer.isExisting ? <span style={{ color: 'var(--success-700)', fontWeight: 600 }}>You are verified.</span> : <button type="button" className="link" onClick={customer.openLogin}>Verify with WhatsApp</button>}
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* BENEFITS */}
      <section className="section">
        <div className="container">
          <div className="section-head">
            <div>
              <span className="eyebrow">Why order here</span>
              <h2>Built for wholesale buyers</h2>
            </div>
          </div>
          <div className="benefits">
            <div className="benefit"><div className="benefit-icon"><BadgePercent /></div><h3>Wholesale pricing upfront</h3><p>See MRP, discount and your final wholesale value before you place the order.</p></div>
            <div className="benefit"><div className="benefit-icon"><Ruler /></div><h3>Order size-wise</h3><p>Pick a colour and enter quantities for every size in one step.</p></div>
            <div className="benefit"><div className="benefit-icon"><Boxes /></div><h3>Mix-colour boxes</h3><p>Selected styles are supplied as assorted colour boxes - just choose the number of boxes.</p></div>
            <div className="benefit"><div className="benefit-icon"><LockKeyhole /></div><h3>Locked orders</h3><p>Once you submit payment details, your order is locked so nothing changes by mistake.</p></div>
            <div className="benefit"><div className="benefit-icon"><PackageSearch /></div><h3>Track every order</h3><p>Follow payment verification, packing and dispatch with your order number.</p></div>
            <div className="benefit"><div className="benefit-icon"><MessageCircle /></div><h3>WhatsApp support</h3><p>Questions about sizes, stock or payment? Our team is a message away.</p></div>
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="section section-muted" id="how-it-works">
        <div className="container">
          <div className="section-head">
            <div>
              <span className="eyebrow">How ordering works</span>
              <h2>From catalogue to dispatch</h2>
            </div>
          </div>
          <div className="steps">
            <div className="step"><h3>Browse &amp; select</h3><p>Choose products, colours and sizes - or mix-colour boxes.</p></div>
            <div className="step"><h3>Reach the minimum</h3><p>Your cart shows the discount and how much is left to reach {settings ? formatINR(settings.minimum_order_value) : 'the minimum'}.</p></div>
            <div className="step"><h3>Checkout</h3><p>Enter business and delivery details. Your order number is created instantly.</p></div>
            <div className="step"><h3>Pay with UPI QR</h3><p>Scan our payment QR and pay the exact order amount from any UPI app.</p></div>
            <div className="step"><h3>Upload the payment screenshot</h3><p>Your order is locked and our team verifies the payment.</p></div>
            <div className="step"><h3>Packed &amp; dispatched</h3><p>Track status and courier details from the order tracking page.</p></div>
          </div>
        </div>
      </section>

      {/* PAYMENT PROCESS */}
      <section className="section">
        <div className="container two-col" style={{ alignItems: 'center' }}>
          <div>
            <span className="eyebrow">Payment process</span>
            <h2 className="display" style={{ fontSize: 30, margin: '8px 0 12px' }}>Simple, verified UPI payments</h2>
            <p className="muted">After checkout you will see our company UPI QR code and the exact amount for your order. Pay from any UPI app, then upload the payment screenshot (the UTR / transaction ID is optional). Our team verifies every payment before processing the order.</p>
            <div className="stack mt-2">
              <div className="info-tile"><QrCode /> Only pay using the QR code and UPI ID shown on your order’s payment page.</div>
              <div className="info-tile"><LockKeyhole /> Submitting payment details locks your order. Need a change? Contact us on WhatsApp.</div>
              <div className="info-tile"><Truck /> After verification your order moves to processing, packing and dispatch.</div>
            </div>
          </div>
          {wa && (
            <div className="wa-band">
              <div>
                <h2>Need help with your order?</h2>
                <p>{settings?.support_message}</p>
              </div>
              <a className="btn btn-whatsapp btn-lg" href={waLink(wa, 'Hello Nutex Team, I have a wholesale enquiry.')} target="_blank" rel="noopener noreferrer"><WhatsAppIcon /> WhatsApp us</a>
            </div>
          )}
        </div>
      </section>
    </>
  );
}
