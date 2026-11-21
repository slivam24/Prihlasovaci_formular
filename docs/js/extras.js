/* Doplňující otázky ve formuláři a na stránce změn: vykreslení, načtení odpovědí, součet ceny.
 * Typy: checkboxes, select, quantity (počet kusů – obědy, lůžka), text, textarea. */
(function (global) {
  'use strict';

  const esc = global.escapeHtml;
  const R = global.Rules;

  function priceTag(x, i) {
    const p = R.optionPrice(x, i);
    return p != null ? ` <span class="price">${esc(R.formatMoney(p))}${x.type === 'quantity' && x.unit ? ' / ' + esc(x.unit) : ''}</span>` : '';
  }

  function field(x, value, modes) {
    const name = 'x_' + x.id;
    const help = x.help ? `<span class="hint">${esc(x.help)}</span>` : '';
    const data = modes ? ` data-modes="${esc(modes)}"` : '';
    const opts = x.options || [];
    if (x.type === 'checkboxes') {
      const vals = Array.isArray(value) ? value : [];
      return `<fieldset class="extra"${data}><legend>${esc(x.label)}</legend>${help}
        ${opts.map((o, i) => `<label class="check"><input type="checkbox" name="${esc(name)}" value="${esc(o)}" ${vals.includes(o) ? 'checked' : ''}> ${esc(o)}${priceTag(x, i)}</label>`).join('')}
      </fieldset>`;
    }
    if (x.type === 'select') {
      return `<label class="block extra"${data}>${esc(x.label)}
        <select name="${esc(name)}"><option value="">—</option>
          ${opts.map((o, i) => {
            const p = R.optionPrice(x, i);
            return `<option value="${esc(o)}" ${o === value ? 'selected' : ''}>${esc(o)}${p != null ? ' – ' + esc(R.formatMoney(p)) : ''}</option>`;
          }).join('')}</select>${help}
      </label>`;
    }
    if (x.type === 'quantity') {
      const vals = value && typeof value === 'object' ? value : {};
      return `<fieldset class="extra extra-qty"${data}><legend>${esc(x.label)}</legend>${help}
        ${opts.map((o, i) => `<label class="qty-row">
          <span class="qty-name">${esc(o)}${priceTag(x, i)}</span>
          <input type="number" min="0" max="999" inputmode="numeric" name="${esc(name)}" data-option="${esc(o)}" value="${parseInt(vals[o], 10) || 0}">
          ${x.unit ? `<span class="small muted">${esc(x.unit)}</span>` : ''}
        </label>`).join('')}
      </fieldset>`;
    }
    if (x.type === 'text') {
      return `<label class="block extra"${data}>${esc(x.label)}<input name="${esc(name)}" maxlength="500" value="${esc(value || '')}">${help}</label>`;
    }
    return `<label class="block extra"${data}>${esc(x.label)}<textarea name="${esc(name)}" rows="3" maxlength="2000">${esc(value || '')}</textarea>${help}</label>`;
  }

  /** Odpověď na jednu otázku z formuláře. */
  function readOne(root, x) {
    const name = 'x_' + x.id;
    const els = Array.from(root.querySelectorAll(`[name="${CSS.escape(name)}"]`));
    if (x.type === 'checkboxes') return els.filter((i) => i.checked).map((i) => i.value);
    if (x.type === 'quantity') {
      const out = {};
      els.forEach((i) => {
        const n = Math.min(999, Math.max(0, parseInt(i.value, 10) || 0));
        if (n) out[i.dataset.option] = n;
      });
      return out;
    }
    return els[0] ? (els[0].value || '').trim() : '';
  }

  function read(root, extras) {
    const out = {};
    (extras || []).forEach((x) => { out[x.id] = readOne(root, x); });
    return out;
  }

  function hasPrices(extras) {
    return (extras || []).some((x) => (x.prices || []).some((p) => typeof p === 'number'));
  }

  /** Součet ceny doplňků (a volitelně startovného z getFees) – element totalEl se průběžně aktualizuje. */
  function bindTotal(root, getExtras, totalEl, getFees) {
    const update = () => {
      const extras = getExtras();
      const extrasSum = hasPrices(extras) ? R.extrasTotal(extras, read(root, extras)) : 0;
      const fees = getFees ? getFees() : 0;
      const total = extrasSum + fees;
      totalEl.hidden = !total;
      if (!total) return;
      totalEl.innerHTML = getFees
        ? `K úhradě na místě: <strong>${esc(R.formatMoney(total))}</strong>` +
          (fees && extrasSum ? ` <span class="small muted">(startovné ${esc(R.formatMoney(fees))}, doplňky ${esc(R.formatMoney(extrasSum))})</span>` : '')
        : `Celkem za doplňky: <strong>${esc(R.formatMoney(total))}</strong>`;
    };
    root.addEventListener('input', update);
    root.addEventListener('change', update);
    update();
    return update;
  }

  global.Extras = { field, read, readOne, bindTotal, hasPrices };
})(window);
