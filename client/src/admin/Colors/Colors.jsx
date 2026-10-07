import { MasterTable } from '../MasterTable.jsx';
import { SingleImageUpload } from '../components.jsx';
import { Field } from '../../components/common/ui.jsx';

const EMPTY = { color_name: '', color_code: '', hex_code: '#000000', swatch_image: '' };

export default function Colors() {
  return (
    <MasterTable
      title="Color master"
      subtitle="Colors used by color-wise products. Each product chooses which of these colors it offers."
      endpoint="/colors"
      idField="color_id"
      nameField="color_name"
      entity="Color"
      emptyForm={EMPTY}
      columns={[
        {
          key: 'color_name',
          label: 'Color',
          render: (r) => (
            <span className="row">
              <i className="swatch-dot" style={{ background: r.swatch_image ? `url(/api/admin/media/${encodeURIComponent(r.swatch_image)}) center/cover` : r.hex_code || '#ddd' }} />
              <span className="cell-main">{r.color_name}</span>
            </span>
          ),
        },
        { key: 'color_code', label: 'Code' },
        { key: 'hex_code', label: 'Hex', render: (r) => <code className="small">{r.hex_code}</code> },
      ]}
      toPayload={(f) => ({ color_name: f.color_name, color_code: f.color_code, hex_code: f.hex_code, swatch_image: f.swatch_image })}
      renderForm={(f, set) => (
        <div className="form-grid">
          <Field label="Color name" required><input className="input" value={f.color_name} onChange={(e) => set('color_name', e.target.value)} /></Field>
          <Field label="Color code" hint="Used in variant SKUs, e.g. BLK"><input className="input" value={f.color_code} onChange={(e) => set('color_code', e.target.value.toUpperCase())} maxLength={20} /></Field>
          <Field label="Hex color">
            <div className="row">
              <input type="color" value={/^#[0-9a-f]{6}$/i.test(f.hex_code) ? f.hex_code : '#000000'} onChange={(e) => set('hex_code', e.target.value.toUpperCase())} style={{ width: 48, height: 40, border: 0, background: 'none' }} />
              <input className="input" value={f.hex_code} onChange={(e) => set('hex_code', e.target.value.toUpperCase())} maxLength={7} />
            </div>
          </Field>
          <div className="span-2"><SingleImageUpload label="Swatch image (optional - for prints)" purpose="color" value={f.swatch_image} onChange={(id) => set('swatch_image', id)} /></div>
        </div>
      )}
    />
  );
}
