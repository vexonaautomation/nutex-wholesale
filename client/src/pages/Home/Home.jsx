import { Link } from 'react-router-dom';
import {
  ArrowRight, Boxes, IndianRupee, LockKeyhole, MessageCircle, PackageSearch, QrCode, Ruler, Truck,
} from 'lucide-react';
import { useStore } from '../../context/StoreContext.jsx';
import { api } from '../../services/api.js';
import { useAsync, useSeo } from '../../hooks/index.js';
import { ProductCard, ProductGridSkeleton } from '../../components/ProductCard/ProductCard.jsx';
import { Img } from '../../components/common/ui.jsx';
import { WhatsAppIcon } from '../../components/common/Icons.jsx';
import { formatINR } from '../../utils/format.js';
import { waLink, waNumber } from '../../utils/whatsapp.js';

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
  const { settings, categories, groups } = useStore();
  // Settings > online payment OFF: no QR step, the team confirms each order
  const onlinePay = settings?.online_payment_enabled !== false;
  const featured = useAsync(() => api.get('/api/products?featured=true&limit=8'), []);
  const company = settings?.company_name || 'Nutex Apparel Limited';
  useSeo({
    title: `${company} | Wholesale Bras, Panties & Lingerie`,
    description: `Wholesale ordering from ${company}: bras, panties, lingerie sets, camisoles and men's innerwear at wholesale prices.`,
  });
  const wa = waNumber(settings);

  return (
    <>
      {/* HERO: Nutex banner - direct manufacturer to wholesale */}
      <section className="hero-nx" aria-label={`${company} - direct manufacturer to wholesale`}>
        <div className="hero-nx-main">
          <img className="hero-nx-photo" src="/hero/hero-model.webp" alt="" width="843" height="985" fetchpriority="high" />
          <div className="container hero-nx-inner">
            <div className="hero-nx-copy">
              <div className="hero-nx-logo">
                <img src={settings?.company_logo_url || '/hero/hero-logo.png'} alt={company} />
              </div>
              <p className="hero-nx-brand">Nutex Inner Buddy</p>
              <p className="hero-nx-since">Since 1951</p>
              <h1 className="hero-nx-title">
                <span>Direct</span>
                <span>Manufacturer</span>
                <span className="is-red">To Wholesale</span>
              </h1>
              <p className="hero-nx-sub">Quality Innerwear. Trusted Since Generations.</p>
              <div className="hero-nx-cta">
                <Link to="/shop" className="hero-nx-btn is-red">Explore collection <ArrowRight /></Link>
                {wa
                  ? <a className="hero-nx-btn is-outline" href={waLink(wa, 'Hello Nutex Team, I have a wholesale enquiry.')} target="_blank" rel="noopener noreferrer">Wholesale enquiry</a>
                  : <Link to="/contact" className="hero-nx-btn is-outline">Wholesale enquiry</Link>}
              </div>
              <p className="hero-nx-note">Manufacturing heritage since 1951</p>
            </div>
          </div>
        </div>
        <ul className="hero-nx-strip">
          <li>Bulk orders &amp; wholesale supply</li>
          <li>Quality fabrication</li>
          <li>Built on decades of experience</li>
        </ul>
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
            <div className="benefit"><div className="benefit-icon"><IndianRupee /></div><h3>Clear wholesale pricing</h3><p>Your cart shows the exact wholesale value before you place the order.</p></div>
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
            <div className="step"><h3>Reach the minimum</h3><p>Your cart shows your wholesale total and how much is left to reach {settings ? formatINR(settings.minimum_order_value) : 'the minimum'}.</p></div>
            <div className="step"><h3>Checkout</h3><p>Enter business and delivery details. Your order number is created instantly.</p></div>
            {onlinePay ? (
              <>
                <div className="step"><h3>Pay with UPI QR</h3><p>Scan our payment QR and pay the exact order amount from any UPI app.</p></div>
                <div className="step"><h3>Upload the payment screenshot</h3><p>Your order is locked and our team verifies the payment.</p></div>
              </>
            ) : (
              <>
                <div className="step"><h3>Order received</h3><p>You see a confirmation with your order number - nothing is paid on the website.</p></div>
                <div className="step"><h3>We confirm with you</h3><p>Our team contacts you on WhatsApp or phone to confirm the order and payment.</p></div>
              </>
            )}
            <div className="step"><h3>Packed &amp; dispatched</h3><p>Track status and courier details from the order tracking page.</p></div>
          </div>
        </div>
      </section>

      {/* PAYMENT PROCESS (only when the online UPI QR payment is switched on) */}
      {onlinePay && (
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
      )}
    </>
  );
}
