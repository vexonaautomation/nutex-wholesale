import { MasterTable } from '../MasterTable.jsx';
import { Field } from '../../components/common/ui.jsx';

export default function Sizes() {
  return (
    <MasterTable
      title="Size master"
      subtitle="Sizes are shown in this order on product pages. Each product selects only the sizes it offers."
      endpoint="/sizes"
      idField="size_id"
      nameField="size_name"
      entity="Size"
      emptyForm={{ size_name: '' }}
      columns={[{ key: 'size_name', label: 'Size', render: (r) => <span className="cell-main">{r.size_name}</span> }, { key: 'size_id', label: 'ID', render: (r) => <span className="cell-sub">{r.size_id}</span> }]}
      toPayload={(f) => ({ size_name: f.size_name })}
      renderForm={(f, set) => (
        <Field label="Size name" required hint="e.g. 34, 36, Free Size"><input className="input" value={f.size_name} onChange={(e) => set('size_name', e.target.value)} autoFocus /></Field>
      )}
    />
  );
}
