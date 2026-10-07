import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, ArrowRight, Boxes, ChevronLeft, ChevronRight, ImagePlus, Palette, Plus, Rocket, Star, Trash2,
} from 'lucide-react';
import { adminApi, uploadImage } from '../../services/auth.js';
import { useToast } from '../../context/ToastContext.jsx';
import { PageHeader } from '../components.jsx';
import { Alert, Field, Img, PageLoader, Spinner, StatusBadge, ErrorState } from '../../components/common/ui.jsx';
import { PriceTag } from '../../components/common/PriceTag.jsx';
import { formatINR, pct } from '../../utils/format.js';
import { compressImage, MAX_UPLOAD_BYTES } from '../../utils/image.js';
import { wholesaleOf } from '../../utils/pricing.js';

const STEPS = ['Basic information', 'Category', 'Pricing', 'Sizes', 'Box / pieces', 'Colours / Boxes', 'Inventory', 'Images', 'Status', 'Preview & publish'];

// a box exists when pieces-per-box is set (or older custom boxes);
// loose pieces exist when colours are chosen
const hasBox = (f) => f.legacy_boxes || Number(f.units_per_box) >= 1;
const hasPcs = (f) => f.color_ids.length > 0;

const EMPTY = {
  product_name: '', sku: '', slug: '', description: '', subcategory: '', category_id: '',
  mrp: '', discount_mode: 'GLOBAL', fixed_discount_percent: '',
  size_ids: [], size_mrps: {}, units_per_box: '', pcs_for_new_customers: false, legacy_boxes: false, color_ids: [], boxes: [],
  stock: {}, images: [], status: 'ACTIVE', out_of_stock: false, featured: false, sort_order: 1000,
  seo_title: '', seo_description: '',
};

let tmp = 0;
const tmpKey = () => `new-${Date.now()}-${(tmp += 1)}`;

function fromServer(res) {
  const p = res.product;
  const stock = {};
  for (const v of res.variants) {
    if (!v.inventory) continue;
    const box = v.inventory_mode === 'BOX_WISE';
    // per-size boxes: only the active box of each size (older boxes are history)
    if (box && !res.legacy_boxes && (v.status !== 'ACTIVE' || !v.size_id)) continue;
    const key = box ? (res.legacy_boxes ? v.box_id : `size:${v.size_id}`) : `${v.color_id}|${v.size_id}`;
    stock[key] = { qty: v.inventory.stock_qty, expected: v.inventory.stock_qty, reserved: v.inventory.reserved_qty, status: v.inventory.status };
  }
  return {
    ...EMPTY,
    ...p,
    mrp: p.mrp ?? '',
    fixed_discount_percent: p.fixed_discount_percent ?? '',
    discount_mode: p.discount_mode || 'GLOBAL',
    pcs_for_new_customers: p.pcs_for_new_customers === true,
    units_per_box: p.units_per_box ? String(p.units_per_box) : '',
    loaded_units: p.units_per_box ? String(p.units_per_box) : '',
    legacy_boxes: Boolean(res.legacy_boxes),
    size_mrps: Object.fromEntries((p.size_mrps || []).map((m) => [m.size_id, String(m.mrp)])),
    boxes: res.boxes.map((b) => ({
      key: b.box_id, box_id: b.box_id, sku: b.sku, size_id: b.size_id || '', units_per_box: b.units_per_box || 1,
      box_mrp: b.box_mrp ?? '', mixed_color_description: b.mixed_color_description || '', status: b.status,
    })),
    stock,
    images: res.images.map((i) => ({
      image_id: i.image_id, drive_file_id: i.drive_file_id, file_url: i.file_url, image_type: i.image_type, alt_text: i.alt_text, preview: i.url,
    })),
  };
}

function stepErrors(f) {
  const e = {};
  if (f.product_name.trim().length < 2) e.product_name = [0, 'Enter the product name'];
  if (!/^[A-Za-z0-9][A-Za-z0-9_./-]*$/.test(f.sku.trim())) e.sku = [0, 'Enter a SKU (letters, numbers, - _ . /)'];
  if (!f.category_id) e.category_id = [1, 'Choose a category'];
  if (!(Number(f.mrp) > 0)) e.mrp = [2, 'Enter MRP greater than 0'];
  if (f.discount_mode === 'CUSTOM' && !(Number(f.fixed_discount_percent) >= 0 && Number(f.fixed_discount_percent) < 100 && f.fixed_discount_percent !== '')) e.fixed_discount_percent = [2, 'Enter a discount between 0 and 99.99'];
  if (!f.size_ids.length && !(f.legacy_boxes && !f.color_ids.length)) e.size_ids = [3, 'Select at least one size'];
  if (!hasBox(f) && !f.color_ids.length) e.color_ids = [5, 'Select colours for loose pieces, or set pieces per box (step 5)'];
  if (f.legacy_boxes) {
    if (!f.boxes.length) e.boxes = [5, 'Add at least one box configuration'];
    if (f.boxes.some((b) => !(Number(b.units_per_box) >= 1))) e.boxes = [5, 'Units per box must be at least 1'];
  } else if (String(f.units_per_box).trim() !== '' && !(Number(f.units_per_box) >= 1 && Number.isInteger(Number(f.units_per_box)))) {
    e.units_per_box = [4, 'Pieces per box must be a whole number (or blank for no box)'];
  }
  return e;
}

export default function ProductWizard() {
  const { id } = useParams();
  const isNew = !id;
  const navigate = useNavigate();
  const toast = useToast();
  const [form, setForm] = useState(EMPTY);
  const [step, setStep] = useState(0);
  const [masters, setMasters] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState(null);
  const [uploading, setUploading] = useState(0);
  const fileRef = useRef(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [cats, colors, sizes, pricing, product] = await Promise.all([
          adminApi.get('/categories'), adminApi.get('/colors'), adminApi.get('/sizes'), adminApi.get('/discount-slabs'),
          isNew ? null : adminApi.get(`/products/${id}`),
        ]);
        if (!alive) return;
        setMasters({ categories: cats.items, colors: colors.items, sizes: sizes.items, pricing });
        setForm(product ? fromServer(product) : EMPTY);
        setStep(0);
      } catch (err) {
        if (alive) setLoadError(err);
      }
    })();
    return () => { alive = false; };
  }, [id, isNew]);

  const errors = useMemo(() => stepErrors(form), [form]);
  const errorSteps = new Set(Object.values(errors).map(([s]) => s));
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const toggle = (k, value) => setForm((f) => ({ ...f, [k]: f[k].includes(value) ? f[k].filter((x) => x !== value) : [...f[k], value] }));

  if (loadError) return <ErrorState error={loadError} onRetry={() => window.location.reload()} />;
  if (!masters) return <PageLoader />;

  const sizesSel = masters.sizes.filter((s) => form.size_ids.includes(s.size_id));
  const colorsSel = masters.colors.filter((c) => form.color_ids.includes(c.color_id));
  const category = masters.categories.find((c) => c.category_id === form.category_id);
  const pricing = masters.pricing;
  const pricePct = form.discount_mode === 'CUSTOM' ? Number(form.fixed_discount_percent || 0)
    : pricing.discount_mode === 'SLAB' ? (pricing.slabs.filter((s) => s.active)[0]?.discount_percent || 0) : Number(pricing.default_discount_percent);
  const err = (k) => errors[k]?.[1];
  const stockOf = (key) => form.stock[key] || { qty: 0, expected: null, reserved: 0 };
  const setStock = (key, qty) => setForm((f) => ({ ...f, stock: { ...f.stock, [key]: { ...stockOf(key), ...f.stock[key], qty: Math.max(0, Math.floor(Number(qty) || 0)) } } }));
  const units = Number(form.units_per_box) || 0;
  const pieceMrpOf = (sizeId) => (Number(form.size_mrps[sizeId]) > 0 ? Number(form.size_mrps[sizeId]) : Number(form.mrp) || 0);
  // changing pieces per box creates NEW boxes: their stock is entered fresh
  const unitsChanged = !isNew && Boolean(form.loaded_units) && form.units_per_box !== form.loaded_units;
  const boxKey = (sizeId) => (unitsChanged ? `new:${sizeId}` : `size:${sizeId}`);
  const setUnits = (v) => set('units_per_box', v);
  // box stock left 0 -> boxes are packed from the loose colours (equal pcs of each)
  const autoBoxes = (sizeId) => {
    if (!colorsSel.length) return { ok: false, reason: 'No loose colours - enter the box stock.' };
    if (units % colorsSel.length) return { ok: false, reason: `${units} pcs cannot be split equally into ${colorsSel.length} colours - enter the box stock.` };
    const per = units / colorsSel.length;
    const boxes = Math.min(...colorsSel.map((c) => {
      const st = stockOf(`${c.color_id}|${sizeId}`);
      return Math.floor(Math.max(0, st.qty - (st.reserved || 0)) / per);
    }));
    return { ok: true, per, boxes };
  };

  // ------------------------------------------------------------ images
  const addImages = async (files) => {
    for (const raw of files) {
      if (!/^image\/(jpeg|png|webp)$/.test(raw.type)) { toast.error(`${raw.name}: only JPG, PNG or WEBP.`); continue; }
      const file = await compressImage(raw);
      if (file.size > MAX_UPLOAD_BYTES) { toast.error(`${raw.name} is too large.`); continue; }
      setUploading((n) => n + 1);
      try {
        const res = await uploadImage(file, 'product');
        setForm((f) => ({
          ...f,
          images: [...f.images, { image_id: '', drive_file_id: res.file_id, file_url: res.file_url, image_type: f.images.length ? 'GALLERY' : 'MAIN', alt_text: f.product_name, preview: res.preview_url }],
        }));
      } catch (e) {
        toast.error(`${raw.name}: ${e.message}`);
      } finally {
        setUploading((n) => n - 1);
      }
    }
  };
  const moveImage = (i, d) => setForm((f) => {
    const imgs = [...f.images];
    const j = i + d;
    if (j < 0 || j >= imgs.length) return f;
    [imgs[i], imgs[j]] = [imgs[j], imgs[i]];
    return { ...f, images: imgs };
  });
  const setMain = (i) => setForm((f) => ({ ...f, images: f.images.map((img, k) => ({ ...img, image_type: k === i ? 'MAIN' : img.image_type === 'MAIN' ? 'GALLERY' : img.image_type })) }));

  // ------------------------------------------------------------ publish
  const publish = async () => {
    const first = Object.values(errors)[0];
    if (first) {
      setStep(first[0]);
      toast.error(first[1]);
      return;
    }
    const pcsStock = hasPcs(form)
      ? colorsSel.flatMap((c) => sizesSel.map((s) => {
        const st = stockOf(`${c.color_id}|${s.size_id}`);
        return { color_id: c.color_id, size_id: s.size_id, stock_qty: st.qty, expected_stock_qty: st.expected };
      }))
      : [];
    const boxStock = !hasBox(form) ? [] : form.legacy_boxes
      ? form.boxes.map((b) => {
        const st = stockOf(b.box_id || b.key);
        return { box_key: b.box_id || b.key, stock_qty: st.qty, expected_stock_qty: st.expected };
      })
      : sizesSel.map((s) => {
        const st = stockOf(boxKey(s.size_id));
        return { box_key: `size:${s.size_id}`, stock_qty: st.qty, expected_stock_qty: unitsChanged ? null : st.expected };
      });
    const stock = [...pcsStock, ...boxStock];
    const payload = {
      sku: form.sku.trim().toUpperCase(),
      product_name: form.product_name.trim(),
      slug: form.slug.trim(),
      category_id: form.category_id,
      subcategory: form.subcategory,
      description: form.description,
      mrp: Number(form.mrp),
      discount_mode: form.discount_mode,
      fixed_discount_percent: form.discount_mode === 'CUSTOM' ? Number(form.fixed_discount_percent) : null,
      pcs_for_new_customers: form.pcs_for_new_customers,
      units_per_box: hasBox(form) && !form.legacy_boxes ? Number(form.units_per_box) : null,
      size_ids: form.size_ids,
      size_mrps: form.size_ids.filter((sid) => Number(form.size_mrps[sid]) > 0).map((sid) => ({ size_id: sid, mrp: Number(form.size_mrps[sid]) })),
      color_ids: form.color_ids,
      boxes: hasBox(form) && form.legacy_boxes ? form.boxes.map((b) => ({
        box_id: b.box_id || '', key: b.key, sku: b.sku, size_id: b.size_id, units_per_box: Number(b.units_per_box),
        box_mrp: b.box_mrp === '' ? null : Number(b.box_mrp), mixed_color_description: b.mixed_color_description, status: b.status,
      })) : [],
      stock,
      images: form.images.map((img, i) => ({ image_id: img.image_id || '', drive_file_id: img.drive_file_id, file_url: img.file_url, image_type: img.image_type, alt_text: img.alt_text, sort_order: i })),
      status: form.status,
      out_of_stock: form.out_of_stock,
      featured: form.featured,
      sort_order: Number(form.sort_order) || 0,
      seo_title: form.seo_title,
      seo_description: form.seo_description,
    };
    setSaving(true);
    setServerError(null);
    try {
      const res = isNew ? await adminApi.post('/products', payload) : await adminApi.put(`/products/${id}`, payload);
      toast.success(isNew ? 'Product published.' : 'Product updated. Only this product was changed.');
      setForm(fromServer(res));
      if (isNew) navigate(`/admin/products/${res.product.product_id}`, { replace: true });
    } catch (e) {
      setServerError(e);
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  // ------------------------------------------------------------ steps
  const steps = [
    // 1 basic
    <div className="form-grid" key="s0">
      <Field label="Product name" required error={err('product_name')} className="span-2"><input className="input" value={form.product_name} onChange={(e) => set('product_name', e.target.value)} /></Field>
      <Field label="SKU" required error={err('sku')} hint="Unique product code"><input className="input" value={form.sku} onChange={(e) => set('sku', e.target.value.toUpperCase())} /></Field>
      <Field label="Product ID" hint="Generated automatically and never changes"><input className="input" value={form.product_id || '(new)'} disabled /></Field>
      <Field label="URL slug" hint="Leave blank to generate from the name" className="span-2"><input className="input" value={form.slug} onChange={(e) => set('slug', e.target.value)} placeholder="auto" /></Field>
      <Field label="Description" className="span-2"><textarea className="textarea" rows={6} value={form.description} onChange={(e) => set('description', e.target.value)} /></Field>
      <Field label="Sort order" hint="Lower numbers appear first"><input className="input" type="number" value={form.sort_order} onChange={(e) => set('sort_order', e.target.value)} /></Field>
      <label className="check" style={{ alignSelf: 'end', paddingBottom: 10 }}><input type="checkbox" checked={form.featured} onChange={(e) => set('featured', e.target.checked)} /> <Star size={16} /> Featured on homepage</label>
      <Field label="SEO title (optional)"><input className="input" value={form.seo_title} onChange={(e) => set('seo_title', e.target.value)} maxLength={120} /></Field>
      <Field label="SEO description (optional)"><input className="input" value={form.seo_description} onChange={(e) => set('seo_description', e.target.value)} maxLength={300} /></Field>
    </div>,
    // 2 category
    <div className="form-grid" key="s1">
      <Field label="Category" required error={err('category_id')}>
        <select className="select" value={form.category_id} onChange={(e) => set('category_id', e.target.value)}>
          <option value="">Select category</option>
          {masters.categories.filter((c) => c.status !== 'ARCHIVED').map((c) => (
            <option key={c.category_id} value={c.category_id}>{c.parent_category ? `${c.parent_category} › ` : ''}{c.category_name}{c.status !== 'ACTIVE' ? ' (inactive)' : ''}</option>
          ))}
        </select>
      </Field>
      <Field label="Subcategory (optional)" hint="Free text, e.g. T-shirt bra"><input className="input" value={form.subcategory} onChange={(e) => set('subcategory', e.target.value)} /></Field>
      {category && category.status !== 'ACTIVE' && <Alert type="warning" className="span-2">This category is inactive - the product will be hidden from the store until the category is reactivated.</Alert>}
      <p className="small muted span-2">Need a new category? <Link to="/admin/categories" className="link">Manage categories</Link></p>
    </div>,
    // 3 pricing
    <div className="stack" key="s2">
      <div className="form-grid">
        <Field label="MRP (per piece) ₹" required error={err('mrp')}><input className="input" inputMode="decimal" value={form.mrp} onChange={(e) => set('mrp', e.target.value.replace(/[^\d.]/g, ''))} /></Field>
        <Field label="Discount mode">
          <select className="select" value={form.discount_mode} onChange={(e) => set('discount_mode', e.target.value)}>
            <option value="GLOBAL">Follow global discount ({pricing.discount_mode === 'SLAB' ? 'slab system' : `fixed ${pct(pricing.default_discount_percent)}`})</option>
            <option value="CUSTOM">Product-specific fixed discount</option>
          </select>
        </Field>
        {form.discount_mode === 'CUSTOM' && (
          <Field label="Product discount %" required error={err('fixed_discount_percent')}><input className="input" inputMode="decimal" value={form.fixed_discount_percent} onChange={(e) => set('fixed_discount_percent', e.target.value.replace(/[^\d.]/g, ''))} /></Field>
        )}
      </div>
      {Number(form.mrp) > 0 && (
        <div className="card card-pad" style={{ background: 'var(--ink-50)' }}>
          <h4 className="mb-1">Wholesale price preview (calculated by the server at checkout)</h4>
          {form.discount_mode === 'GLOBAL' && pricing.discount_mode === 'SLAB' ? (
            <table className="table">
              <thead><tr><th>Slab</th><th className="right">Discount</th><th className="right">Wholesale price</th></tr></thead>
              <tbody>
                {pricing.slabs.filter((s) => s.active).map((s) => (
                  <tr key={s.slab_id}><td>{formatINR(s.min_amount)} {s.max_amount === null ? '+' : `– ${formatINR(s.max_amount)}`}</td><td className="right">{pct(s.discount_percent)}</td><td className="right num">{formatINR(wholesaleOf(form.mrp, s.discount_percent))}</td></tr>
                ))}
              </tbody>
            </table>
          ) : (
            <PriceTag mrp={Number(form.mrp)} percent={pricePct} mode="SHOW_BOTH" size="lg" />
          )}
          <p className="tiny soft mb-0 mt-1">Wholesale price is never stored as permanent truth - it is derived from MRP and the discount settings. Existing orders keep their saved prices.</p>
        </div>
      )}
    </div>,
    // 4 sizes
    <div className="stack" key="s3">
      <p className="muted mb-0">Select the sizes of this product. {hasBox(form) && !form.legacy_boxes ? 'One box is made for each size.' : ''}</p>
      {err('size_ids') && <Alert type="error">{err('size_ids')}</Alert>}
      <div className="pick-grid">
        {masters.sizes.map((s) => (
          <button key={s.size_id} type="button" className={`pick ${s.status !== 'ACTIVE' ? 'is-inactive' : ''}`} aria-pressed={form.size_ids.includes(s.size_id)} onClick={() => toggle('size_ids', s.size_id)}>
            {s.size_name}
          </button>
        ))}
      </div>
      <div className="row"><button type="button" className="btn btn-sm" onClick={() => set('size_ids', masters.sizes.filter((s) => s.status === 'ACTIVE').map((s) => s.size_id))}>Select all active</button><button type="button" className="btn btn-sm btn-ghost" onClick={() => set('size_ids', [])}>Clear</button></div>
      {sizesSel.length > 0 && (
        <div className="card card-pad" style={{ background: 'var(--ink-50)' }}>
          <h4 className="mb-1">Size-wise MRP per piece (optional)</h4>
          <p className="small muted">Only if bigger sizes cost more (e.g. 80-90 ₹62, 95-100 ₹70). Leave blank to use the product MRP {Number(form.mrp) > 0 ? formatINR(form.mrp) : ''} for that size. Box prices follow automatically.</p>
          <div className="form-grid-3">
            {sizesSel.map((s) => (
              <Field key={s.size_id} label={`Size ${s.size_name} MRP ₹`}>
                <input className="input" inputMode="decimal" placeholder={form.mrp ? String(form.mrp) : 'Product MRP'} value={form.size_mrps[s.size_id] ?? ''} onChange={(e) => set('size_mrps', { ...form.size_mrps, [s.size_id]: e.target.value.replace(/[^\d.]/g, '') })} />
              </Field>
            ))}
          </div>
        </div>
      )}
    </div>,
    // 5 box / pieces
    <div className="stack" key="s4">
      <Alert type="info">Existing customers can always choose: <strong>full box</strong> or <strong>loose pieces</strong>. New customers buy full boxes - unless you open loose pieces for this article below.</Alert>
      {!form.legacy_boxes && (
        <div className="form-grid">
          <Field label="Pieces in one box" error={err('units_per_box')} hint="Same for every size; one box per size, assorted colours. Box price = pieces × piece MRP. Blank = no box for this article.">
            <input className="input" type="number" min={1} step={1} placeholder="e.g. 6" value={form.units_per_box} onChange={(e) => setUnits(e.target.value.replace(/[^\d]/g, ''))} />
          </Field>
          {units > 0 && Number(form.mrp) > 0 && (
            <div className="field">
              <span className="field-label">Example</span>
              <div className="small">Box of {units} pcs × {formatINR(Number(form.mrp))} = <strong>MRP {formatINR(units * Number(form.mrp))}</strong> → wholesale {formatINR(wholesaleOf(units * Number(form.mrp), pricePct))}</div>
            </div>
          )}
        </div>
      )}
      {unitsChanged && <Alert type="warning">Pieces per box changed from {form.loaded_units} to {form.units_per_box || 'no box'}: new boxes are created (old boxes are kept inactive for order history). Enter the box stock again in step 7.</Alert>}
      {form.legacy_boxes && (
        <Alert type="info">This product has older custom box configurations (step 6). <button type="button" className="link" onClick={() => setForm((f) => ({ ...f, legacy_boxes: false }))}>Switch to one box per size</button></Alert>
      )}
      <h4 className="mb-0">Loose pieces for NEW customers</h4>
      <div className="choice-grid">
        <button type="button" className="choice" aria-pressed={!form.pcs_for_new_customers} onClick={() => set('pcs_for_new_customers', false)}>
          <Boxes /><span><strong>Not allowed</strong><span className="small muted">New customers buy full boxes only (normal rule).</span></span>
        </button>
        <button type="button" className="choice" aria-pressed={form.pcs_for_new_customers} onClick={() => set('pcs_for_new_customers', true)}>
          <Palette /><span><strong>Allowed for this article</strong><span className="small muted">E.g. when the stock left cannot make a full box - new customers may buy loose pieces too.</span></span>
        </button>
      </div>
      {!hasBox(form) && !form.pcs_for_new_customers && <Alert type="warning">No box and loose pieces not allowed for new customers: only existing customers can buy this article.</Alert>}
      {!isNew && <Alert type="info">Changes keep old variants and stock (set inactive), so past orders remain intact and you can switch back.</Alert>}
    </div>,
    // 6 colours / boxes
    <div className="stack" key="s5">
      {(
        <>
          <h4 className="mb-0">Colours for loose pieces</h4>
          <p className="muted mb-0">Customers buying loose pieces choose from these colours (existing customers always can; new customers only if allowed in step 5). Boxes come in assorted colours.</p>
          {err('color_ids') && <Alert type="error">{err('color_ids')}</Alert>}
          <div className="pick-grid">
            {masters.colors.map((c) => (
              <button key={c.color_id} type="button" className={`pick ${c.status !== 'ACTIVE' ? 'is-inactive' : ''}`} aria-pressed={form.color_ids.includes(c.color_id)} onClick={() => toggle('color_ids', c.color_id)}>
                <i className="swatch-dot swatch-dot-sm" style={{ background: c.hex_code || '#ddd' }} /> {c.color_name}
              </button>
            ))}
          </div>
          <p className="small muted">Missing a colour? <Link to="/admin/colors" className="link">Manage color master</Link></p>
        </>
      )}
      {hasBox(form) && !form.legacy_boxes && (
        <>
          <h4 className="mb-0">Boxes (one per size, assorted colours)</h4>
          {!sizesSel.length || !(units > 0) ? <Alert type="warning">Select sizes (step 4) and pieces per box (step 5) first.</Alert> : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Size</th><th>Pieces</th><th className="right">Box MRP</th><th className="right">Wholesale / box</th></tr></thead>
                <tbody>
                  {sizesSel.map((s) => (
                    <tr key={s.size_id}>
                      <td className="cell-main">Size {s.size_name}</td>
                      <td>{units} pcs × {formatINR(pieceMrpOf(s.size_id))}</td>
                      <td className="right num">{formatINR(units * pieceMrpOf(s.size_id))}</td>
                      <td className="right num">{formatINR(wholesaleOf(units * pieceMrpOf(s.size_id), pricePct))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      {hasBox(form) && form.legacy_boxes && (
        <>
          {err('boxes') && <Alert type="error">{err('boxes')}</Alert>}
          {form.boxes.map((b, i) => (
            <div key={b.key} className="card card-pad">
              <div className="row-between mb-1"><strong>Box {i + 1}</strong>{b.box_id ? <span className="badge badge-outline">{b.box_id}</span> : <span className="badge badge-brand">New</span>}</div>
              <div className="form-grid-3">
                <Field label="Box SKU" hint="Blank = automatic"><input className="input" value={b.sku} onChange={(e) => set('boxes', form.boxes.map((x) => (x.key === b.key ? { ...x, sku: e.target.value.toUpperCase() } : x)))} /></Field>
                <Field label="Units per box" required><input className="input" type="number" min={1} value={b.units_per_box} onChange={(e) => set('boxes', form.boxes.map((x) => (x.key === b.key ? { ...x, units_per_box: e.target.value } : x)))} /></Field>
                <Field label="Size (optional)">
                  <select className="select" value={b.size_id} onChange={(e) => set('boxes', form.boxes.map((x) => (x.key === b.key ? { ...x, size_id: e.target.value } : x)))}>
                    <option value="">No specific size</option>
                    {masters.sizes.map((s) => <option key={s.size_id} value={s.size_id}>{s.size_name}</option>)}
                  </select>
                </Field>
                <Field label="Box MRP ₹" hint={`Blank = units × MRP (${formatINR((Number(form.mrp) || 0) * (Number(b.units_per_box) || 1))})`}><input className="input" inputMode="decimal" value={b.box_mrp} onChange={(e) => set('boxes', form.boxes.map((x) => (x.key === b.key ? { ...x, box_mrp: e.target.value.replace(/[^\d.]/g, '') } : x)))} /></Field>
                <Field label="Mixed colour description"><input className="input" value={b.mixed_color_description} placeholder="Assorted colours" onChange={(e) => set('boxes', form.boxes.map((x) => (x.key === b.key ? { ...x, mixed_color_description: e.target.value } : x)))} /></Field>
                <Field label="Status">
                  <select className="select" value={b.status} onChange={(e) => set('boxes', form.boxes.map((x) => (x.key === b.key ? { ...x, status: e.target.value } : x)))}>
                    <option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option>
                  </select>
                </Field>
              </div>
              {!b.box_id && <button type="button" className="btn btn-sm btn-ghost mt-1" onClick={() => set('boxes', form.boxes.filter((x) => x.key !== b.key))}><Trash2 /> Remove</button>}
            </div>
          ))}
          <button type="button" className="btn" onClick={() => set('boxes', [...form.boxes, { key: tmpKey(), box_id: '', sku: '', size_id: '', units_per_box: 12, box_mrp: '', mixed_color_description: 'Assorted colours', status: 'ACTIVE' }])}><Plus /> Add box configuration</button>
        </>
      )}
    </div>,
    // 7 inventory
    <div className="stack" key="s6">
      {hasPcs(form) && (
        !colorsSel.length || !sizesSel.length ? <Alert type="warning">Select sizes (step 4) and colours (step 6) first.</Alert> : (
          <>
            <h4 className="mb-0">Loose pieces stock</h4>
            <p className="muted mb-0">Available pieces for each colour + size. 0 = out of stock for that combination only.</p>
            <div className="matrix-wrap">
              <table className="matrix">
                <thead><tr><th className="row-head">Colour \ Size</th>{sizesSel.map((s) => <th key={s.size_id}>{s.size_name}</th>)}</tr></thead>
                <tbody>
                  {colorsSel.map((c) => (
                    <tr key={c.color_id}>
                      <th className="row-head"><span className="row"><i className="swatch-dot swatch-dot-sm" style={{ background: c.hex_code || '#ddd' }} />{c.color_name}</span></th>
                      {sizesSel.map((s) => {
                        const key = `${c.color_id}|${s.size_id}`;
                        const st = stockOf(key);
                        return (
                          <td key={key}>
                            <input type="number" min={0} value={st.qty} onChange={(e) => setStock(key, e.target.value)} className={`${st.qty === 0 ? 'is-zero' : ''} ${st.expected !== null && st.expected !== undefined && st.qty !== st.expected ? 'is-dirty' : ''}`} aria-label={`${c.color_name} size ${s.size_name}`} />
                            {st.reserved > 0 && <span className="cell-meta">{st.reserved} reserved</span>}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="row wrap">
              <button type="button" className="btn btn-sm" onClick={() => { const n = window.prompt('Set every cell to:', '10'); if (n !== null) colorsSel.forEach((c) => sizesSel.forEach((s) => setStock(`${c.color_id}|${s.size_id}`, n))); }}>Fill all…</button>
            </div>
          </>
        )
      )}
      {hasBox(form) && !form.legacy_boxes && sizesSel.length > 0 && units > 0 && (
        <>
          <h4 className="mb-0">Box stock (number of boxes per size)</h4>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Box</th><th className="right">Available boxes</th></tr></thead>
              <tbody>
                {sizesSel.map((s) => {
                  const key = boxKey(s.size_id);
                  const st = stockOf(key);
                  return (
                    <tr key={key}>
                      <td className="cell-main">Size {s.size_name} · box of {units} pcs</td>
                      <td className="right">
                        <input className="input input-sm" style={{ width: 110, textAlign: 'right' }} type="number" min={0} value={st.qty} onChange={(e) => setStock(key, e.target.value)} aria-label={`Boxes of size ${s.size_name}`} />
                        {st.reserved > 0 && <div className="cell-sub">{st.reserved} reserved</div>}
                        {!st.qty && !st.reserved && (() => {
                          const a = autoBoxes(s.size_id);
                          return a.ok
                            ? <div className="cell-sub auto-ok">Auto: {a.boxes} box{a.boxes === 1 ? '' : 'es'} from loose stock ({a.per} pc{a.per === 1 ? '' : 's'} of each colour)</div>
                            : <div className="cell-sub auto-warn">{a.reason}</div>;
                        })()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="muted small mb-0">Leave a size at <b>0</b> to pack boxes from the loose stock: each box takes the same number of pieces of every colour, and the box count follows the colour with the least stock. Enter a number only for boxes you have already packed.</p>
          <div className="row wrap">
            <button type="button" className="btn btn-sm" onClick={() => { const n = window.prompt('Boxes for every size:', '10'); if (n !== null) sizesSel.forEach((s) => setStock(boxKey(s.size_id), n)); }}>Fill all boxes…</button>
          </div>
        </>
      )}
      {hasBox(form) && form.legacy_boxes && (
        !form.boxes.length ? <Alert type="warning">Add box configurations in step 6 first.</Alert> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Box</th><th>Units</th><th>Mixed colours</th><th className="right">Available boxes</th></tr></thead>
              <tbody>
                {form.boxes.map((b, i) => {
                  const key = b.box_id || b.key;
                  const st = stockOf(key);
                  return (
                    <tr key={key}>
                      <td className="cell-main">Box {i + 1} {b.sku && <span className="cell-sub">{b.sku}</span>}</td>
                      <td>{b.units_per_box} pcs</td>
                      <td className="small">{b.mixed_color_description}</td>
                      <td className="right">
                        <input className="input input-sm" style={{ width: 110, textAlign: 'right' }} type="number" min={0} value={st.qty} onChange={(e) => setStock(key, e.target.value)} />
                        {st.reserved > 0 && <div className="cell-sub">{st.reserved} reserved</div>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>,
    // 8 images
    <div className="stack" key="s7">
      <p className="muted mb-0">Images are stored in Google Drive (PRODUCTS folder). The first image marked MAIN is the thumbnail.</p>
      <div className="img-tiles">
        {form.images.map((img, i) => (
          <div className="img-tile" key={`${img.drive_file_id}-${i}`}>
            {img.image_type === 'MAIN' && <span className="badge badge-brand">Main</span>}
            <div className="ph"><Img src={img.preview || `/api/admin/media/${encodeURIComponent(img.drive_file_id)}`} alt={img.alt_text} label={form.product_name} /></div>
            <div style={{ padding: '6px 6px 0' }}><input className="input input-sm" value={img.alt_text} placeholder="Alt text" onChange={(e) => set('images', form.images.map((x, k) => (k === i ? { ...x, alt_text: e.target.value } : x)))} /></div>
            <div className="tile-bar">
              <button type="button" className="btn btn-sm btn-icon" onClick={() => moveImage(i, -1)} aria-label="Move left"><ChevronLeft /></button>
              <button type="button" className="btn btn-sm btn-icon" onClick={() => setMain(i)} aria-label="Set as main" title="Set as main"><Star /></button>
              <button type="button" className="btn btn-sm btn-icon" onClick={() => set('images', form.images.filter((_, k) => k !== i))} aria-label="Remove image"><Trash2 /></button>
              <button type="button" className="btn btn-sm btn-icon" onClick={() => moveImage(i, 1)} aria-label="Move right"><ChevronRight /></button>
            </div>
          </div>
        ))}
        <button type="button" className="upload-tile" onClick={() => fileRef.current?.click()} disabled={uploading > 0}>
          {uploading > 0 ? <><Spinner /> Uploading {uploading}…</> : <><ImagePlus /> Add images</>}
        </button>
      </div>
      <input ref={fileRef} type="file" multiple accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => { addImages([...e.target.files]); e.target.value = ''; }} />
    </div>,
    // 9 status
    <div className="stack" key="s8">
      <div className="choice-grid">
        {[['ACTIVE', 'Active', 'Visible and orderable on the website'], ['INACTIVE', 'Inactive', 'Hidden from customers; can be reactivated'], ['ARCHIVED', 'Archived', 'Retired product; kept for history']].map(([v, l, d]) => (
          <button key={v} type="button" className="choice" aria-pressed={form.status === v} onClick={() => set('status', v)}><span><strong>{l}</strong><span className="small muted">{d}</span></span></button>
        ))}
      </div>
      <label className="check"><input type="checkbox" checked={form.out_of_stock} onChange={(e) => set('out_of_stock', e.target.checked)} /> Mark the entire product out of stock (overrides variant stock)</label>
    </div>,
    // 10 preview
    <div className="adm-grid-2" key="s9">
      <div className="p-card" style={{ maxWidth: 280 }}>
        <div className="p-card-media"><Img src={form.images[0]?.preview} label={form.product_name} alt="" /></div>
        <div className="p-card-body">
          <span className="p-card-cat">{category?.category_name}</span>
          <span className="p-card-name">{form.product_name || 'Product name'}</span>
          {Number(form.mrp) > 0 && <PriceTag mrp={Number(form.mrp)} percent={pricePct} mode="SHOW_BOTH" />}
        </div>
      </div>
      <div className="stack">
        <dl className="kv">
          <dt>SKU</dt><dd>{form.sku || '—'}</dd>
          <dt>Category</dt><dd>{category?.category_name || '—'}</dd>
          <dt>MRP</dt><dd>{formatINR(form.mrp)}{sizesSel.some((s) => Number(form.size_mrps[s.size_id]) > 0) && ` (size-wise: ${sizesSel.map((s) => `${s.size_name} ${formatINR(Number(form.size_mrps[s.size_id]) || form.mrp)}`).join(', ')})`}</dd>
          <dt>Discount</dt><dd>{form.discount_mode === 'CUSTOM' ? `Product-specific ${pct(form.fixed_discount_percent)}` : 'Global'}</dd>
          <dt>Selling</dt><dd>{[hasBox(form) && (form.legacy_boxes ? `${form.boxes.length} box configs` : `Boxes of ${form.units_per_box} pcs × ${sizesSel.length} sizes`), hasPcs(form) && `Loose pieces (${colorsSel.length} colours × ${sizesSel.length} sizes)`].filter(Boolean).join(' + ') || '—'}</dd>
          <dt>New customers</dt><dd>{form.pcs_for_new_customers ? 'Boxes and loose pieces' : hasBox(form) ? 'Boxes only' : 'Cannot buy (no box)'}</dd>
          <dt>Images</dt><dd>{form.images.length}</dd>
          <dt>Status</dt><dd><StatusBadge kind="record" status={form.status} /> {form.out_of_stock && <StatusBadge kind="record" status="OUT_OF_STOCK" />}</dd>
        </dl>
        {Object.keys(errors).length > 0 && <Alert type="error">Fix: {Object.values(errors).map(([, m]) => m).join(' · ')}</Alert>}
        {serverError && <Alert type="error">{serverError.message}{serverError.details?.conflicts && ' Reload the page to see current stock.'}</Alert>}
        <button type="button" className="btn btn-primary btn-lg" onClick={publish} disabled={saving || uploading > 0}>{saving ? <Spinner small /> : <Rocket />} {isNew ? 'Publish product' : 'Save & publish changes'}</button>
        <p className="tiny soft mb-0">Publishing updates only this product's rows in Google Sheets. Other products, categories and inventory are never rewritten.</p>
      </div>
    </div>,
  ];

  return (
    <>
      <PageHeader
        title={isNew ? 'Add product' : form.product_name || 'Edit product'}
        subtitle={isNew ? 'Create a product in 10 steps' : `${form.sku} · ${form.product_id}`}
        actions={(
          <>
            <Link to="/admin/products" className="btn"><ArrowLeft /> Products</Link>
            {!isNew && form.slug && form.status === 'ACTIVE' && <a className="btn" href={`/product/${form.slug}`} target="_blank" rel="noopener noreferrer">View on store</a>}
            <button type="button" className="btn btn-primary" onClick={publish} disabled={saving || uploading > 0}>{saving && <Spinner small />} {isNew ? 'Publish' : 'Save changes'}</button>
          </>
        )}
      />
      <div className="wizard">
        <nav className="wiz-steps" aria-label="Steps">
          {STEPS.map((s, i) => (
            <button key={s} type="button" className={`wiz-step ${errorSteps.has(i) ? 'has-error' : ''}`} aria-current={step === i ? 'step' : undefined} onClick={() => setStep(i)}>
              <i>{i + 1}</i>{s}
            </button>
          ))}
        </nav>
        <section className="card card-pad">
          <h2 className="card-title">Step {step + 1} · {STEPS[step]}</h2>
          {steps[step]}
          <div className="wiz-foot">
            <button type="button" className="btn" disabled={step === 0} onClick={() => setStep(step - 1)}><ArrowLeft /> Back</button>
            {step < STEPS.length - 1 && <button type="button" className="btn btn-dark" onClick={() => setStep(step + 1)}>Next <ArrowRight /></button>}
          </div>
        </section>
      </div>
    </>
  );
}
