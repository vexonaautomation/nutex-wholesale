import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDown, ArrowRight, ChevronDown, Sparkles } from 'lucide-react';
import { api } from '../../services/api.js';
import { useAsync, useSeo } from '../../hooks/index.js';
import { useStore } from '../../context/StoreContext.jsx';
import { ProductCard, ProductGridSkeleton } from '../../components/ProductCard/ProductCard.jsx';
import { WhatsAppIcon } from '../../components/common/Icons.jsx';
import { waLink, waNumber } from '../../utils/whatsapp.js';
import '@fontsource/cormorant/500.css';
import '@fontsource/cormorant/600.css';
import '@fontsource/cormorant/500-italic.css';
import '@fontsource/cormorant/600-italic.css';
import './online.css';

// One chapter per kind of article, each with its cover page from the
// "ONLINE COLLECTION" catalogue. Unknown categories go to "More styles".
const CHAPTERS = [
  { key: 'sets', slugs: ['lingerie-set'], title: 'Lingerie', accent: 'Sets', tagline: 'Matching bra and panty sets - everyday cotton, lace, satin and prints.', cover: '/online/sets.webp' },
  { key: 'padded', slugs: ['padded-bra'], title: 'Padded', accent: 'Bras', tagline: 'Soft foam cups, a smooth shape and a confident fit.', cover: '/online/padded.webp' },
  { key: 'sports', slugs: ['sports-bra'], title: 'Sports', accent: 'Bras', tagline: 'Breathable, stretchy support for active days - tube bras too.', cover: '/online/sports.webp' },
  { key: 'tshirt', slugs: ['t-shirt-bra'], title: 'T-Shirt', accent: 'Bras', tagline: 'Seamless under any outfit, comfortable all day.', cover: '/online/tshirt.webp' },
  { key: 'everyday', slugs: ['everyday-bra'], title: 'Everyday', accent: 'Bras', tagline: 'Comfort made for every day - cotton, lace and C-cup styles.', cover: '/online/everyday.webp' },
  { key: 'camisole', slugs: ['camisole-collection'], title: 'Camisoles', accent: '& Shapewear', chip: 'Camisoles', tagline: 'Vests, inners and slim shapewear.', cover: '/online/camisole.webp' },
  { key: 'panty', slugs: ['everyday-panty'], title: 'Everyday', accent: 'Panties', tagline: 'Soft, breathable panties in cotton, lace and prints.', cover: '/online/panty.webp' },
];
const MORE = { key: 'more', slugs: [], title: 'More', accent: 'Styles', tagline: 'More pieces from the online catalogue.', cover: '/online/catalogue.webp' };
const FIRST_ROWS = 6;
const two = (n) => String(n).padStart(2, '0');

// Soft fade-in on scroll; nothing moves for people who prefer reduced motion.
function useReveal(root, deps) {
  useEffect(() => {
    const el = root.current;
    if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return undefined;
    el.classList.add('ocx-anim');
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          e.target.classList.add('is-in');
          io.unobserve(e.target);
        }
      }
    }, { rootMargin: '0px 0px -8% 0px' });
    el.querySelectorAll('[data-reveal]:not(.is-in)').forEach((n) => io.observe(n));
    return () => io.disconnect();
  }, deps); // re-run when new chapters render
}

function Seal() {
  return (
    <svg className="ocx-seal" viewBox="0 0 200 200" aria-hidden="true">
      <defs><path id="ocx-seal-path" d="M100,100 m-78,0 a78,78 0 1,1 156,0 a78,78 0 1,1 -156,0" /></defs>
      <text><textPath href="#ocx-seal-path">NUTEX · ONLINE COLLECTION · SINCE 1951 ·</textPath></text>
      <circle cx="100" cy="100" r="46" />
      <text x="100" y="114" textAnchor="middle" className="ocx-seal-n">N</text>
    </svg>
  );
}

function Chapter({ chapter, index }) {
  const [open, setOpen] = useState(false);
  const shown = open ? chapter.items : chapter.items.slice(0, FIRST_ROWS);
  return (
    <section id={`ocx-${chapter.key}`} className={`ocx-chapter ${index % 2 ? 'is-flip' : ''}`} aria-labelledby={`ocx-${chapter.key}-title`}>
      <div className="container ocx-chapter-inner">
        <figure className="ocx-cover" data-reveal>
          <img src={chapter.cover} alt={`${chapter.title} ${chapter.accent} - Nutex catalogue cover`} loading="lazy" width="734" height="1100" />
          <figcaption>
            <span className="ocx-num">{two(index + 1)}</span>
            <span className="ocx-ccount">{chapter.items.length} {chapter.items.length === 1 ? 'style' : 'styles'}</span>
          </figcaption>
        </figure>
        <header className="ocx-chapter-head" data-reveal>
          <span className="ocx-kicker">Chapter {two(index + 1)}</span>
          <h2 id={`ocx-${chapter.key}-title`}>{chapter.title} <em>{chapter.accent}</em></h2>
          <p>{chapter.tagline}</p>
        </header>
        <div className="product-grid ocx-grid">
          {shown.map((p) => <div key={p.product_id} data-reveal><ProductCard product={p} /></div>)}
        </div>
        {chapter.items.length > FIRST_ROWS && (
          <div className="ocx-more">
            <button type="button" className="ocx-btn is-ghost" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
              {open ? 'Show fewer' : `View all ${chapter.items.length} styles`} <ChevronDown className={open ? 'is-up' : ''} />
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

/** Online Collection: every article of the online catalogue, chapter by chapter. */
export default function Online() {
  useSeo({
    title: 'Online Collection | Nutex Wholesale',
    description: 'The Nutex Online Collection: lingerie sets, padded, sports, T-shirt and everyday bras, camisoles and panties - wholesale.',
  });
  const { settings } = useStore();
  const wa = waNumber(settings);
  const { data, loading } = useAsync(() => api.get('/api/products?collection=online&limit=100&sort=featured'), []);
  const root = useRef(null);
  const [active, setActive] = useState('');

  const chapters = useMemo(() => {
    const items = data?.items || [];
    const list = CHAPTERS.map((c) => ({ ...c, items: items.filter((p) => c.slugs.includes(p.category_slug)) }));
    const known = new Set(CHAPTERS.flatMap((c) => c.slugs));
    const rest = items.filter((p) => !known.has(p.category_slug));
    if (rest.length) list.push({ ...MORE, items: rest });
    return list.filter((c) => c.items.length);
  }, [data]);
  const total = data?.total ?? 0;

  useReveal(root, [chapters]);

  // highlight the chip of the chapter on screen
  useEffect(() => {
    if (!chapters.length || typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver((entries) => {
      const seen = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (seen) setActive(seen.target.id.replace('ocx-', ''));
    }, { rootMargin: '-35% 0px -55% 0px' });
    chapters.forEach((c) => { const el = document.getElementById(`ocx-${c.key}`); if (el) io.observe(el); });
    return () => io.disconnect();
  }, [chapters]);

  const goTo = (key) => {
    const el = document.getElementById(key ? `ocx-${key}` : 'ocx-shop');
    if (!el) return;
    const smooth = !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' });
  };

  return (
    <div className="ocx" ref={root}>
      {/* HERO */}
      <section className="ocx-hero">
        <div className="ocx-frame" aria-hidden="true" />
        <div className="container ocx-hero-inner">
          <div className="ocx-hero-copy">
            <span className="ocx-kicker"><Sparkles /> Nutex Sangini · Online</span>
            <h1>
              <span className="ocx-the">The</span>
              Online <em>Collection</em>
            </h1>
            <p className="ocx-lead">
              Every style from our online catalogue in one place - lingerie sets, padded, sports, T-shirt and everyday bras, camisoles and panties. Made by Nutex, ready for your shop.
            </p>
            <dl className="ocx-stats">
              <div><dt>{loading ? '…' : total}</dt><dd>Styles</dd></div>
              <div><dt>{loading ? '…' : chapters.length}</dt><dd>Collections</dd></div>
              <div><dt>28–44</dt><dd>Bra sizes</dd></div>
            </dl>
            <div className="ocx-cta">
              <button type="button" className="ocx-btn is-red" onClick={() => goTo('')}>Explore the collection <ArrowDown /></button>
              {wa && (
                <a className="ocx-btn is-ghost" href={waLink(wa, 'Hello Nutex Team, I have an enquiry about the Online Collection.')} target="_blank" rel="noopener noreferrer">
                  <WhatsAppIcon /> Wholesale enquiry
                </a>
              )}
            </div>
          </div>
          <div className="ocx-fan" aria-hidden="true">
            <img src="/online/sets.webp" alt="" width="734" height="1100" />
            <img src="/online/padded.webp" alt="" width="734" height="1100" />
            <img src="/online/panty.webp" alt="" width="734" height="1100" />
            <Seal />
          </div>
        </div>
      </section>

      {/* CHAPTERS (the chip bar sticks only while the chapters are on screen) */}
      <div id="ocx-shop" className="ocx-shop">
        {/* CHAPTER CHIPS */}
        {chapters.length > 0 && (
          <nav className="ocx-chips" aria-label="Online Collection chapters">
            <div className="container ocx-chips-inner">
              <button type="button" className={`ocx-chip ${!active ? 'is-on' : ''}`} onClick={() => goTo('')}>All <span className="n">{total}</span></button>
              {chapters.map((c) => (
                <button key={c.key} type="button" className={`ocx-chip ${active === c.key ? 'is-on' : ''}`} aria-current={active === c.key ? 'true' : undefined} onClick={() => goTo(c.key)}>
                  {c.chip || `${c.title} ${c.accent}`} <span className="n">{c.items.length}</span>
                </button>
              ))}
            </div>
          </nav>
        )}
        {loading && <div className="container ocx-loading"><ProductGridSkeleton count={6} /></div>}
        {!loading && !chapters.length && (
          <div className="container ocx-empty">
            <h2>The Online Collection is being prepared</h2>
            <p>Our team is adding the online styles right now. Meanwhile, browse the full wholesale catalogue.</p>
            <Link to="/shop" className="ocx-btn is-red">Shop all products <ArrowRight /></Link>
          </div>
        )}
        {chapters.map((c, i) => <Chapter key={c.key} chapter={c} index={i} />)}
      </div>

      {/* CLOSING */}
      <section className="ocx-final">
        <div className="container ocx-final-inner" data-reveal>
          <img src="/online/catalogue.webp" alt="Nutex online catalogue cover" loading="lazy" width="1100" height="1100" />
          <div>
            <span className="ocx-kicker">Since 1951</span>
            <h2>Stock the whole <em>collection</em></h2>
            <p>Mix any styles, colours and sizes in one wholesale order. Boxes and loose pieces, delivered from the manufacturer.</p>
            <div className="ocx-cta">
              <Link to="/shop" className="ocx-btn is-red">Shop all products <ArrowRight /></Link>
              {wa && (
                <a className="ocx-btn is-ghost" href={waLink(wa, 'Hello Nutex Team, I have an enquiry about the Online Collection.')} target="_blank" rel="noopener noreferrer">
                  <WhatsAppIcon /> WhatsApp us
                </a>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
