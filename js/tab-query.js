/* Query Tab — arbitrary SQL execution */

const QueryTab = (() => {
  let _counter = 0;
  const _instances = {};

  function build(tabId, panel) {
    panel.innerHTML = `
      <div class="qry-layout">
        <div class="qry-sql-zone">
          <div class="qry-toolbar">
            <label class="qry-label">SQL</label>
            <button id="qry-run-${tabId}" class="btn btn-primary qry-run-btn">Run</button>
          </div>
          <textarea id="qry-sql-${tabId}" class="qry-textarea" spellcheck="false"
            placeholder="SELECT * FROM Accounts;"></textarea>
        </div>
        <div id="qry-table-${tabId}" class="qry-table-zone"></div>
      </div>`;

    const inst   = { id: tabId, table: null };
    _instances[tabId] = inst;

    const sqlEl  = document.getElementById(`qry-sql-${tabId}`);
    const runBtn = document.getElementById(`qry-run-${tabId}`);

    function runQuery() {
      const sql = sqlEl.value.trim();
      if (!sql) return;
      _renderResults(inst, tabId, sql);
    }

    runBtn.addEventListener('click', runQuery);
    sqlEl.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); runQuery(); }
    });
  }

  function _renderResults(inst, tabId, sql) {
    const container = document.getElementById(`qry-table-${tabId}`);

    // Destroy previous Tabulator instance before clearing DOM
    if (inst.table) { inst.table.destroy(); inst.table = null; }
    container.innerHTML = '';

    let rows;
    try {
      rows = DB.query(sql);
    } catch (err) {
      container.innerHTML =
        `<div class="qry-message qry-error">${err.message}</div>`;
      return;
    }

    if (!rows.length) {
      container.innerHTML =
        '<div class="qry-message">Query executed. No rows returned.</div>';
      return;
    }

    inst.table = new Tabulator(`#qry-table-${tabId}`, {
      data:               rows,
      height:             '100%',
      layout:             'fitColumns',
      virtualDom:         true,
      autoColumns:        true,
      headerSortTristate: true,
      autoColumnsDefinitions: [{ headerSortTristate: true }],
    });
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  function open() {
    _counter++;
    const tabId = `qry-${_counter}`;
    App.Tabs.open(tabId, 'Query', panel => build(tabId, panel), true);
  }

  function removeInstance(tabId) {
    const inst = _instances[tabId];
    if (inst && inst.table) inst.table.destroy();
    delete _instances[tabId];
  }

  return { open, removeInstance };
})();
