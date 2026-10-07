export function ColorSelector({ colors, value, onChange, availability = {} }) {
  return (
    <div className="swatches" role="group" aria-label="Choose colour">
      {colors.map((c) => {
        const available = availability[c.color_id] !== false;
        return (
          <button
            key={c.color_id}
            type="button"
            className={`swatch ${available ? '' : 'is-unavailable'}`}
            aria-pressed={value === c.color_id}
            onClick={() => onChange(c.color_id)}
            title={available ? c.color_name : `${c.color_name} - out of stock`}
          >
            <span
              className="swatch-dot"
              style={{ background: c.swatch_url ? `url(${c.swatch_url}) center/cover` : c.hex_code || '#ddd' }}
            />
            {c.color_name}
          </button>
        );
      })}
    </div>
  );
}
