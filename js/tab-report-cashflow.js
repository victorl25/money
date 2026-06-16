/* Monthly Cash Flow Report Tab */

const CashFlowReport = (() => {
  let _counter = 0;

  const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun',
                       'Jul','Aug','Sep','Oct','Nov','Dec'];
  const TYPE_ORDER  = { Income: 0, Expense: 1, Other: 2 };

  // ── Timeframe dialog ──────────────────────────────────────────────────────────

  function _selectTimeframe() {
    const today    = new Date();
    const curYear  = today.getFullYear();
    const prevYear = curYear - 1;

    return new Promise(resolve => {
      const bd  = document.getElementById('modal-backdrop');
      const ctr = document.getElementById('modal-container');

      ctr.innerHTML = `
        <div class="dlg">
          <div class="dlg-title">Monthly Cash Flow</div>
          <div class="dlg-body">
            <p style="margin:0 0 12px 0">Select a time frame:</p>
            <div style="display:flex;flex-direction:column;gap:10px;">
              <label class="dlg-checkbox-label">
                <input type="radio" name="cf-frame" value="ytd" checked>
                Year to date (${curYear})
              </label>
              <label class="dlg-checkbox-label">
                <input type="radio" name="cf-frame" value="prev">
                Previous year (${prevYear})
              </label>
              <label class="dlg-checkbox-label">
                <input type="radio" name="cf-frame" value="specific">
                Specific year&hellip;
              </label>
            </div>
          </div>
          <div class="dlg-footer">
            <button id="cf-ok"     class="btn btn-primary">OK</button>
            <button id="cf-cancel" class="btn btn-secondary">Cancel</button>
          </div>
        </div>`;
      bd.classList.remove('hidden');
      ctr.classList.remove('hidden');

      const _hide = () => {
        bd.classList.add('hidden');
        ctr.classList.add('hidden');
        ctr.innerHTML = '';
      };

      document.getElementById('cf-cancel').addEventListener('click', () => { _hide(); resolve(null); });
      document.getElementById('cf-ok').addEventListener('click', async () => {
        const val = ctr.querySelector('input[name="cf-frame"]:checked').value;
        _hide();

        if (val === 'ytd') {
          resolve({ dateFrom: `${curYear}-01-01`, dateTo: `${curYear}-12-31`,
                    year: curYear, label: 'Year to date' });

        } else if (val === 'prev') {
          resolve({ dateFrom: `${prevYear}-01-01`, dateTo: `${prevYear}-12-31`,
                    year: prevYear, label: String(prevYear) });

        } else {
          const yearStr = await Dialogs.prompt('Specific Year',
            'Enter a 4-digit year:', String(curYear));
          if (yearStr == null) { resolve(null); return; }
          const y = parseInt(yearStr.trim(), 10);
          if (isNaN(y) || y < 1900 || y > 2100) {
            await Dialogs.alert('Invalid Year', 'Please enter a valid 4-digit year (1900–2100).');
            resolve(null);
            return;
          }
          resolve({ dateFrom: `${y}-01-01`, dateTo: `${y}-12-31`,
                    year: y, label: String(y) });
        }
      });
    });
  }

  // ── Data query ────────────────────────────────────────────────────────────────

  function _query(frame) {
    const rows = DB.query(`
      SELECT c.Category_ID, c.Name AS cat_name, c.Type AS cat_type,
             CAST(strftime('%m', t.Date) AS INTEGER) AS mo,
             SUM(t.Amount) AS total
      FROM Transactions t
      JOIN Categories c ON t.Category_ID = c.Category_ID
      WHERE t.Valid = 1
        AND t.Date >= ? AND t.Date <= ?
        AND c.Active = 1
      GROUP BY c.Category_ID, c.Name, c.Type, mo
      ORDER BY c.Type, c.Name, mo
    `, [frame.dateFrom, frame.dateTo]);

    // Determine which months to show (Jan → last month with data, capped by today)
    const today   = new Date();
    const curYear = today.getFullYear();
    const curMo   = today.getMonth() + 1;
    const maxMo   = frame.year < curYear ? 12 : curMo;

    // Find the last month that actually has data, within the allowed range
    let lastDataMo = 0;
    rows.forEach(r => { if (r.mo <= maxMo && r.mo > lastDataMo) lastDataMo = r.mo; });
    const endMo = lastDataMo > 0 ? lastDataMo : maxMo;

    const months = [];
    for (let m = 1; m <= endMo; m++) months.push(m);

    // Build category map
    const catMap = {};
    for (const r of rows) {
      if (r.mo > endMo) continue;
      if (!catMap[r.Category_ID]) {
        catMap[r.Category_ID] = { name: r.cat_name, type: r.cat_type, byMonth: {}, rowTotal: 0 };
      }
      catMap[r.Category_ID].byMonth[r.mo] = r.total;
      catMap[r.Category_ID].rowTotal += r.total;
    }

    const cats = Object.values(catMap).sort((a, b) => {
      const ta = TYPE_ORDER[a.type] ?? 99;
      const tb = TYPE_ORDER[b.type] ?? 99;
      return ta !== tb ? ta - tb : a.name.localeCompare(b.name);
    });

    // Month totals (net cash flow per month)
    const monthTotals = {};
    months.forEach(m => { monthTotals[m] = 0; });
    cats.forEach(c => months.forEach(m => { monthTotals[m] += (c.byMonth[m] || 0); }));
    const grandTotal = months.reduce((s, m) => s + monthTotals[m], 0);

    return { cats, months, monthTotals, grandTotal };
  }

  // ── Formatting ────────────────────────────────────────────────────────────────

  function _fmt(val) {
    if (val === 0 || val == null) return '&mdash;';
    const s = Math.abs(val).toLocaleString('en-US', {
      minimumFractionDigits: 2, maximumFractionDigits: 2
    });
    return val < 0 ? `(${s})` : s;
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  function _render(panel, frame) {
    const { cats, months, monthTotals, grandTotal } = _query(frame);

    if (!cats.length) {
      panel.innerHTML = `
        <div class="rpt-layout">
          <div class="rpt-header">
            <div class="rpt-title">Monthly Cash Flow</div>
            <div class="rpt-subtitle">${frame.label}</div>
          </div>
          <p class="rpt-empty">No transactions found for the selected period.</p>
        </div>`;
      return;
    }

    const moNames  = months.map(m => MONTH_NAMES[m - 1]);
    const numCols  = months.length;

    let bodyHtml = '';
    for (const grp of ['Income', 'Expense', 'Other']) {
      const grpCats = cats.filter(c => c.type === grp);
      if (!grpCats.length) continue;

      bodyHtml += `
        <tr class="rpt-cf-grp">
          <td class="rpt-cf-grp-cell" colspan="${numCols + 2}">${grp}</td>
        </tr>`;

      for (const c of grpCats) {
        bodyHtml += `
          <tr class="rpt-cf-row">
            <td class="rpt-cf-cat">${c.name}</td>
            ${months.map(m => {
              const v = c.byMonth[m] || 0;
              return `<td class="rpt-cf-num${v < 0 ? ' rpt-cf-neg' : ''}">${_fmt(v)}</td>`;
            }).join('')}
            <td class="rpt-cf-num rpt-cf-rowtotal${c.rowTotal < 0 ? ' rpt-cf-neg' : ''}">${_fmt(c.rowTotal)}</td>
          </tr>`;
      }
    }

    panel.innerHTML = `
      <div class="rpt-layout">
        <div class="rpt-header">
          <div class="rpt-title">Monthly Cash Flow</div>
          <div class="rpt-subtitle">${frame.label}</div>
        </div>
        <div class="rpt-cf-scroll">
          <table class="rpt-cf-table">
            <thead>
              <tr class="rpt-cf-hdr">
                <th class="rpt-cf-cat">Category</th>
                ${moNames.map(n => `<th class="rpt-cf-num">${n}</th>`).join('')}
                <th class="rpt-cf-num rpt-cf-rowtotal">Total</th>
              </tr>
            </thead>
            <tbody>${bodyHtml}</tbody>
            <tfoot>
              <tr class="rpt-cf-netrow">
                <td class="rpt-cf-cat">Net Cash Flow</td>
                ${months.map(m => {
                  const v = monthTotals[m];
                  return `<td class="rpt-cf-num${v < 0 ? ' rpt-cf-neg' : ''}">${_fmt(v)}</td>`;
                }).join('')}
                <td class="rpt-cf-num rpt-cf-rowtotal${grandTotal < 0 ? ' rpt-cf-neg' : ''}">${_fmt(grandTotal)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>`;
  }

  // ── Public ────────────────────────────────────────────────────────────────────

  async function open() {
    if (!DB.isOpen()) {
      await Dialogs.alert('Monthly Cash Flow', 'No database is open.');
      return;
    }
    const frame = await _selectTimeframe();
    if (!frame) return;
    _counter++;
    App.Tabs.open(`rpt-cf-${_counter}`,
      `Monthly Cash Flow – ${frame.label}`,
      panel => _render(panel, frame), true);
  }

  return { open };
})();
