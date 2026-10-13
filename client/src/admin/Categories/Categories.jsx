import { MasterTable } from '../MasterTable.jsx';
import { SingleImageUpload } from '../components.jsx';
import { Field, Img } from '../../components/common/ui.jsx';

const EMPTY = { category_name: '', parent_category: '', slug: '', description: '', image_file_id: '', seo_title: '', seo_description: '', packing_charge: '' };
const hasOwnRate = (v) => v !== '' && v !== null && v !== undefined;

export default function Categories() {
  return (
    <MasterTable
      title="Categories"
      subtitle="New categories appear on the website automatically. Use parent group (e.g. WOMEN, PANTIES, MEN) for menu grouping."
      endpoint="/categories"
      idField="category_id"
      nameField="category_name"
      entity="Category"
      allowArchive
      emptyForm={EMPTY}
      columns={[
        {
          key: 'category_name',
          label: 'Category',
          render: (r) => (
            <div className="row">
              <div className="thumb"><Img src={r.image_file_id ? `/api/admin/media/${encodeURIComponent(r.image_file_id)}` : ''} label={r.category_name} alt="" /></div>
              <div><div className="cell-main">{r.category_name}</div><div className="cell-sub">/category/{r.slug}</div></div>
            </div>
          ),
        },
        { key: 'parent_category', label: 'Group', render: (r) => r.parent_category || <span className="soft">—</span> },
        { key: 'description', label: 'Description', render: (r) => <span className="small muted">{(r.description || '').slice(0, 80)}</span> },
        {
          key: 'packing_charge',
          label: 'Packing ₹ / pc',
          className: 'right',
          render: (r) => (hasOwnRate(r.packing_charge)
            ? <strong className="num">₹{r.packing_charge}</strong>
            : <span className="small muted">₹{r.packing_charge_auto ?? 0} <span className="soft">auto</span></span>),
        },
      ]}
      toPayload={(f) => ({
        category_name: f.category_name, parent_category: f.parent_category, slug: f.slug, description: f.description,
        image_file_id: f.image_file_id, seo_title: f.seo_title, seo_description: f.seo_description,
        packing_charge: hasOwnRate(f.packing_charge) && String(f.packing_charge).trim() !== '' ? Number(f.packing_charge) : '',
      })}
      renderForm={(f, set) => (
        <div className="form-grid">
          <Field label="Category name" required className="span-2"><input className="input" value={f.category_name} onChange={(e) => set('category_name', e.target.value)} /></Field>
          <Field label="Parent group" hint="e.g. WOMEN, PANTIES, MEN"><input className="input" value={f.parent_category} onChange={(e) => set('parent_category', e.target.value.toUpperCase())} /></Field>
          <Field label="URL slug" hint="Blank = generated from name"><input className="input" value={f.slug} onChange={(e) => set('slug', e.target.value)} /></Field>
          <Field label="Description" className="span-2"><textarea className="textarea" value={f.description} onChange={(e) => set('description', e.target.value)} /></Field>
          <div className="span-2"><SingleImageUpload label="Category image" purpose="category" value={f.image_file_id} onChange={(id) => set('image_file_id', id)} /></div>
          <Field label="Packing charge ₹ per piece (per set for sets)" className="span-2" hint="Taken off when the customer ticks “Do you wish to less packing charges?” at checkout. A box counts its pieces. Blank = automatic from the name: Set ₹4, Bra / Panty ₹2, others ₹0.">
            <input className="input" style={{ maxWidth: 160 }} inputMode="decimal" placeholder="Auto" value={f.packing_charge ?? ''} onChange={(e) => set('packing_charge', e.target.value.replace(/[^\d.]/g, ''))} />
          </Field>
          <Field label="SEO title"><input className="input" value={f.seo_title} onChange={(e) => set('seo_title', e.target.value)} /></Field>
          <Field label="SEO description"><input className="input" value={f.seo_description} onChange={(e) => set('seo_description', e.target.value)} /></Field>
        </div>
      )}
    />
  );
}
