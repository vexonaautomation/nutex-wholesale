import fs from 'node:fs';
import path from 'node:path';
import { getCatalog, isProductVisible, mediaUrl, productImages } from './catalogService.js';
import { RECORD_STATUS } from '../config/constants.js';
import { config, ROOT_DIR } from '../config/env.js';

export const CLIENT_DIST = path.join(ROOT_DIR, 'client', 'dist');
const INDEX_FILE = path.join(CLIENT_DIST, 'index.html');

let template = null;
function indexTemplate() {
  if (template === null || !config.isProd) {
    template = fs.existsSync(INDEX_FILE) ? fs.readFileSync(INDEX_FILE, 'utf8') : '';
  }
  return template;
}

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const clip = (s, n) => (String(s || '').length > n ? `${String(s).slice(0, n - 1)}…` : String(s || ''));

export function baseUrl(req) {
  return config.frontendUrl || `${req.protocol}://${req.get('host')}`;
}

async function metaFor(req) {
  const catalog = await getCatalog();
  const s = catalog.settings;
  const company = s.company_name || 'Nutex Apparel Limited';
  const url = `${baseUrl(req)}${req.path}`;
  const meta = {
    title: `${company} | Wholesale Bras, Panties & Lingerie`,
    description: clip(`${company} wholesale ordering: bras, panties, lingerie sets, camisoles and men's innerwear at wholesale prices. Minimum order ₹${Number(s.minimum_order_value).toLocaleString('en-IN')}.`, 160),
    image: s.company_logo_file_id ? `${baseUrl(req)}${mediaUrl(s.company_logo_file_id)}` : '',
    url,
    type: 'website',
    noindex: req.path.startsWith('/admin') || req.path.startsWith('/order') || req.path.startsWith('/checkout') || req.path.startsWith('/cart'),
  };
  const productMatch = req.path.match(/^\/product\/([^/]+)/);
  const categoryMatch = req.path.match(/^\/category\/([^/]+)/);
  if (productMatch) {
    const p = catalog.productsBySlug.get(decodeURIComponent(productMatch[1]));
    if (p && isProductVisible(catalog, p)) {
      const img = productImages(catalog, p)[0];
      meta.title = clip(p.seo_title || `${p.product_name} | Wholesale | ${company}`, 70);
      meta.description = clip(p.seo_description || p.description || `${p.product_name} (SKU ${p.sku}) available at wholesale prices from ${company}.`, 160);
      if (img) meta.image = `${baseUrl(req)}${img.url}`;
      meta.type = 'product';
    }
  } else if (categoryMatch) {
    const c = catalog.categoriesBySlug.get(decodeURIComponent(categoryMatch[1]));
    if (c && c.status === RECORD_STATUS.ACTIVE) {
      meta.title = clip(c.seo_title || `${c.category_name} Wholesale | ${company}`, 70);
      meta.description = clip(c.seo_description || c.description || `Shop ${c.category_name} at wholesale prices from ${company}.`, 160);
      if (c.image_file_id) meta.image = `${baseUrl(req)}${mediaUrl(c.image_file_id)}`;
    }
  }
  return meta;
}

/** Serves the SPA with page-specific <title>/description/OpenGraph tags (for WhatsApp/Google previews). */
export async function renderIndex(req) {
  const html = indexTemplate();
  if (!html) return null;
  let meta;
  try {
    meta = await metaFor(req);
  } catch {
    return html; // catalog unavailable - plain SPA shell still works
  }
  const tags = [
    `<title>${esc(meta.title)}</title>`,
    `<meta name="description" content="${esc(meta.description)}" />`,
    `<link rel="canonical" href="${esc(meta.url)}" />`,
    `<meta property="og:type" content="${meta.type}" />`,
    `<meta property="og:title" content="${esc(meta.title)}" />`,
    `<meta property="og:description" content="${esc(meta.description)}" />`,
    `<meta property="og:url" content="${esc(meta.url)}" />`,
    meta.image ? `<meta property="og:image" content="${esc(meta.image)}" />` : '',
    `<meta name="twitter:card" content="${meta.image ? 'summary_large_image' : 'summary'}" />`,
    meta.noindex ? '<meta name="robots" content="noindex,nofollow" />' : '',
  ].filter(Boolean).join('\n    ');
  return html.replace(/<!--seo:start-->[\s\S]*?<!--seo:end-->/, `<!--seo:start-->\n    ${tags}\n    <!--seo:end-->`);
}

export async function sitemapXml(req) {
  const catalog = await getCatalog();
  const root = baseUrl(req);
  const urls = ['/', '/shop', '/track-order', '/contact', '/policies/wholesale-terms', '/policies/shipping-policy'];
  for (const c of catalog.categories) if (c.status === RECORD_STATUS.ACTIVE) urls.push(`/category/${c.slug}`);
  const lastmod = {};
  for (const p of catalog.products) {
    if (isProductVisible(catalog, p)) {
      urls.push(`/product/${p.slug}`);
      lastmod[`/product/${p.slug}`] = (p.updated_at || '').slice(0, 10);
    }
  }
  const body = urls.map((u) => `  <url><loc>${esc(root + u)}</loc>${lastmod[u] ? `<lastmod>${lastmod[u]}</lastmod>` : ''}</url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

export function robotsTxt(req) {
  return `User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\nDisallow: /order/\nDisallow: /checkout\nDisallow: /cart\n\nSitemap: ${baseUrl(req)}/sitemap.xml\n`;
}
