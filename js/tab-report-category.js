/* Spend by Category Report Tab */

const SpendByCategoryReport = (() => {
  let _counter = 0;

  const TIME_FRAMES = {
    ytd:  'Year to date',
    prev: 'Previous year',
    all:  'All time',
  };

  function getDateRange(frame) {
    const year = new Date().getFullYear();
    if (frame === 'ytd')  return { from: `${year}-01-01`,     to: `${year}-12-31` };
    if (frame === 'prev') return { from: `${year - 1}-01-01`, to: `${year - 1}-12-31` };
    return { from: null, to: null };
  }

  function build(panel, frame) {
    const frameLabel = TIME_FRAMES[frame] || frame;
    const range = getDateRange(frame);

    let sql = `
      SELECT c.Category_ID, c.Name, SUM(-t.Amount) AS Spend
      FROM Transactions t
      JOIN Categories c ON t.Category_ID = c.Category_ID
      WHERE t.Valid = 1 AND c.Type = 'Expense'`;
    const params = [];
    if (range.from) { sql += ' AND t.Date >= ?'; params.push(range.from); }
    if (range.to)   { sql += ' AND t.Date <= ?'; params.push(range.to); }
    sql += ' GROUP BY t.Category_ID, c.Name ORDER BY Spend DESC';

    const rows  = DB.query(sql, params);
    const grand = rows.reduce((s, r) => s + (r.Spend || 0), 0);

    const fmt    = v => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(v);
    const fmtPct = v => grand !== 0 ? (v / grand * 100).toFixed(1) + '%' : '—';

    const dataRows = rows.length
      ? rows.map(r => `
        <tr>
          <td class="rpt-col-name">
            <a class="cell-link" data-cat-id="${r.Category_ID}" data-cat-name="${r.Name}">${r.Name}</a>
          </td>
          <td class="rpt-col-num">${fmt(r.Spend)}</td>
          <td class="rpt-col-num">${fmtPct(r.Spend)}</td>
        </tr>`).join('')
      : `<tr><td colspan="3" class="rpt-empty">No expense transactions found for this period.</td></tr>`;

    panel.innerHTML = `
      <div class="rpt-layout">
        <div class="rpt-header">
          <div class="rpt-title">Spend by Category</div>
          <div class="rpt-subtitle">${frameLabel}</div>
        </div>
        <table class="rpt-table">
          <thead>
            <tr>
              <th class="rpt-col-name">Category</th>
              <th class="rpt-col-num">Spend</th>
              <th class="rpt-col-num">% of Total</th>
            </tr>
          </thead>
          <tbody>${dataRows}</tbody>
          ${rows.length ? `
          <tfoot>
            <tr class="rpt-total-row">
              <td class="rpt-col-name">Grand Total</td>
              <td class="rpt-col-num">${fmt(grand)}</td>
              <td class="rpt-col-num">100.0%</td>
            </tr>
          </tfoot>` : ''}
        </table>
      </div>`;

    panel.querySelector('.rpt-table').addEventListener('click', e => {
      const link = e.target.closest('.cell-link[data-cat-id]');
      if (!link) return;
      const catId   = parseInt(link.dataset.catId, 10);
      const catName = link.dataset.catName;
      TransactionsTab.openForCategoryFiltered(catId, catName, range.from, range.to, frame);
    });
  }

  async function open() {
    if (!DB.isOpen()) { await Dialogs.alert('Spend by Category', 'No database is open.'); return; }

    const frame = await Dialogs.selectTimeframe();
    if (!frame) return;

    _counter++;
    const tabId     = `rpt-cat-${_counter}`;
    const tabLabel  = `Spend by Category \u2013 ${TIME_FRAMES[frame]}`;
    App.Tabs.open(tabId, tabLabel, panel => build(panel, frame), true);
  }

  return { open };
})();
