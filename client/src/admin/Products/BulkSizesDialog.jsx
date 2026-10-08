import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { adminApi } from '../../services/auth.js';
import { useToast } from '../../context/ToastContext.jsx';
import { Alert, Spinner } from '../../components/common/ui.jsx';
import { Modal } from '../../components/common/Modal.jsx';
import { SIZE_PRESETS, presetSizeIds, missingPresetSizes } from './sizePresets.js';

const MODES = [
  { key: 'replace', label: 'Set exactly these sizes', hint: 'Sizes not ticked are switched off for these products.' },
  { key: 'add', label: 'Add these sizes', hint: 'Keeps each product\'s current sizes and adds the ticked ones.' },
  { key: 'remove', label: 'Remove these sizes', hint: 'Switches off only the ticked sizes.' },
];

// Bulk "Sizes": change the sizes of many products at once (e.g. a whole category).
export function BulkSizesDialog({ open, products, onClose, onDone }) {
  const toast = useToast();
  const [sizes, setSizes] = useState([]);
  const [picked, setPicked] = useState(() => new Set());
  const [mode, setMode] = useState('replace');
  const [newSize, setNewSize] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const loadSizes = async () => {
    const res = await adminApi.get('/sizes');
    const active = (res.items || []).filter((s) => s.status === 'ACTIVE');
    setSizes(active);
    return active;
  };
  useEffect(() => { if (open) loadSizes().catch((err) => toast.error(err.message)); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (id) => setPicked((cur) => { const next = new Set(cur); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const addSize = async () => {
    const name = newSize.trim();
    if (!name) return;
    const existing = sizes.find((s) => s.size_name.toLowerCase() === name.toLowerCase());
    if (existing) { setPicked((cur) => new Set([...cur, existing.size_id])); setNewSize(''); return; }
    setBusy(true);
    try {
      await adminApi.post('/sizes', { size_name: name });
      const list = await loadSizes();
      const created = list.find((s) => s.size_name.toLowerCase() === name.toLowerCase());
      if (created) setPicked((cur) => new Set([...cur, created.size_id]));
      setNewSize('');
      toast.success(`Size ${name} added.`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  // a preset size missing from the size list (e.g. 28): add it, then tick the preset
  const addPreset = async (key) => {
    setBusy(true);
    try {
      const names = missingPresetSizes(sizes, key);
      for (const n of names) await adminApi.post('/sizes', { size_name: n });
      const list = await loadSizes();
      setPicked(new Set(presetSizeIds(list, key)));
      toast.success(`Size ${names.join(', ')} added.`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    if (!picked.size) { toast.error('Tick at least one size.'); return; }
    setBusy(true);
    try {
      const res = await adminApi.post('/products/bulk-sizes', {
        product_ids: products.map((p) => p.product_id),
        size_ids: [...picked],
        mode,
      });
      setResult(res);
      toast.success(`Sizes saved for ${res.updated.length} product(s).`);
      onDone();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };
  const close = () => { setResult(null); setPicked(new Set()); setMode('replace'); onClose(); };

  return (
    <Modal
      open={open}
      title={result ? 'Sizes saved' : `Sizes · ${products.length} product(s)`}
      onClose={close}
      footer={result ? <button type="button" className="btn btn-primary" onClick={close}>Done</button> : (
        <>
          <button type="button" className="btn" onClick={close}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={apply} disabled={busy || !picked.size}>{busy && <Spinner small />} Apply to {products.length} product(s)</button>
        </>
      )}
    >
      {result ? (
        <div className="stack">
          <Alert type="success">Updated {result.updated.length} · already like this {result.unchanged.length} · skipped {result.skipped.length}</Alert>
          {result.skipped.length > 0 && <Alert type="warning">{result.skipped.map((x) => x.reason).join(' · ')}</Alert>}
          <p className="small muted mb-0">New sizes start with 0 stock - enter their pieces in Inventory (or Bulk update with Excel).</p>
        </div>
      ) : (
        <div className="stack">
          <div className="choice-grid">
            {MODES.map((m) => (
              <button key={m.key} type="button" className="choice" aria-pressed={mode === m.key} onClick={() => setMode(m.key)}>
                <span><strong>{m.label}</strong><span className="small muted">{m.hint}</span></span>
              </button>
            ))}
          </div>
          <div className="row wrap">
            {SIZE_PRESETS.map((p) => (
              <button key={p.key} type="button" className="btn btn-sm" onClick={() => setPicked(new Set(presetSizeIds(sizes, p.key)))}>{p.label}: {p.from}–{p.to}</button>
            ))}
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setPicked(new Set())}>Clear</button>
            {SIZE_PRESETS.map((p) => {
              const miss = sizes.length ? missingPresetSizes(sizes, p.key) : [];
              return miss.length ? <button key={`add-${p.key}`} type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={() => addPreset(p.key)}><Plus /> Add size {miss.join(', ')}</button> : null;
            })}
          </div>
          <div className="pick-grid">
            {sizes.map((s) => (
              <button key={s.size_id} type="button" className="pick" aria-pressed={picked.has(s.size_id)} onClick={() => toggle(s.size_id)}>{s.size_name}</button>
            ))}
          </div>
          <div className="row wrap" style={{ gap: 8 }}>
            <input className="input" style={{ maxWidth: 220 }} placeholder="Custom size, e.g. 42 or 5XL" value={newSize} onChange={(e) => setNewSize(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addSize(); } }} />
            <button type="button" className="btn btn-sm" onClick={addSize} disabled={busy || !newSize.trim()}><Plus /> Add size</button>
          </div>
          <p className="tiny soft mb-0">Bras &amp; sets usually start at 28, panties at 32. New sizes get pieces (and a box, if the product has boxes) with 0 stock. Removed sizes are switched off, never deleted - their stock and old orders stay. Prices, colours and images are not changed.</p>
        </div>
      )}
    </Modal>
  );
}
