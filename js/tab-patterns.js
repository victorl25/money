/* Patterns Tab */

const PatternsTab = (() => {
  const TAB_ID = 'patterns';
  let _table       = null;
  let _selectedRow = null;
  let _formDirty   = false;
  let _isNewMode   = false;

  function loadData() {
    return DB.query(`
      SELECT pp.Pattern_ID, pp.Pattern, p.Payee_ID, p.Name AS Payee_Name
      FROM Patterns pp
      JOIN Payees p ON pp.Payee_ID = p.Payee_ID
      WHERE pp.Active = 1 AND p.Active = 1
      ORDER BY pp.Pattern`
    );
  }

  function payeeNameFormatter(cell) {
    const name = cell.getValue();
    const id   = cell.getRow().getData().Payee_ID;
    return `<a class="cell-link" data-payee-id="${id}">${name}</a>`;
  }

  // ── Payee autocomplete ─────────────────────────────────────────────────────

  function attachPayeeAutocomplete(inputEl, listEl, hiddenEl) {
    inputEl.addEventListener('input', () => {
      const q = inputEl.value.trim();
      if (!q) { listEl.innerHTML = ''; return; }
      const matches = DB.query(
        'SELECT Payee_ID, Name FROM Payees WHERE Name LIKE ? AND Active = 1 LIMIT 10',
        [`${q}%`]
      );
      listEl.innerHTML = matches.map(m =>
        `<div class="ac-item" data-id="${m.Payee_ID}" data-name="${m.Name}">${m.Name}</div>`
      ).join('');
    });
    listEl.addEventListener('mousedown', e => {
      const item = e.target.closest('.ac-item');
      if (!item) return;
      inputEl.value  = item.dataset.name;
      hiddenEl.value = item.dataset.id;
      listEl.innerHTML = '';
    });
    inputEl.addEventListener('blur', () => setTimeout(() => { listEl.innerHTML = ''; }, 150));
  }

  // ── Form ───────────────────────────────────────────────────────────────────

  function buildForm(panel) {
    const form = panel.querySelector('#pattern-form');
    form.innerHTML = `
      <div class="form-col">
        <div class="form-field"><label>Pattern (regex)</label><input type="text" id="fpt-pattern" class="form-control" placeholder="e.g. ^AMAZON.*"></div>
      </div>
      <div class="form-col">
        <div class="form-field"><label>Payee</label>
          <div class="ac-wrap">
            <input type="text"   id="fpt-payee"    class="form-control" autocomplete="off" placeholder="Type to search...">
            <input type="hidden" id="fpt-payee-id">
            <div id="fpt-payee-list" class="ac-list"></div>
          </div>
        </div>
      </div>
      <div class="form-col-btns">
        <button id="fpt-new"    class="btn btn-secondary">New</button>
        <div class="btn-spacer"></div>
        <button id="fpt-accept" class="btn btn-primary hidden">Accept</button>
      </div>`;

    attachPayeeAutocomplete(
      document.getElementById('fpt-payee'),
      document.getElementById('fpt-payee-list'),
      document.getElementById('fpt-payee-id')
    );

    ['fpt-pattern', 'fpt-payee'].forEach(id => {
      document.getElementById(id).addEventListener('input', () => setDirty(true));
    });

    document.getElementById('fpt-new').addEventListener('click', () => {
      _isNewMode = true; _selectedRow = null;
      document.getElementById('fpt-pattern').value  = '';
      document.getElementById('fpt-payee').value    = '';
      document.getElementById('fpt-payee-id').value = '';
      setDirty(false);
      document.getElementById('fpt-accept').classList.remove('hidden');
    });

    document.getElementById('fpt-accept').addEventListener('click', commit);
  }

  function setDirty(v) {
    _formDirty = v;
    const btn = document.getElementById('fpt-accept');
    if (btn) btn.classList.toggle('hidden', !v);
  }

  async function commit() {
    const pattern  = document.getElementById('fpt-pattern').value.trim();
    const payeeTxt = document.getElementById('fpt-payee').value.trim();
    let   payeeId  = parseInt(document.getElementById('fpt-payee-id').value, 10) || null;

    if (!pattern)  { await Dialogs.alert('Validation', 'Pattern is required.'); return; }
    if (!payeeTxt) { await Dialogs.alert('Validation', 'Payee is required.'); return; }

    // Validate regex before saving
    try { new RegExp(pattern); } catch {
      await Dialogs.alert('Invalid Pattern', `"${pattern}" is not a valid regular expression.`);
      return;
    }

    // Resolve payee
    if (!payeeId) payeeId = DB.lookupPayee(payeeTxt);
    if (!payeeId) {
      const ok = await Dialogs.confirm('New Payee', `Payee "${payeeTxt}" does not exist. Create it?`);
      if (!ok) return;
      payeeId = DB.createPayee(payeeTxt);
      App.onPayeesChanged();
    }

    if (_isNewMode) {
      DB.run('INSERT INTO Patterns (Payee_ID, Pattern, Active) VALUES (?,?,1)',
        [payeeId, pattern]);
    } else if (_selectedRow) {
      DB.run('UPDATE Patterns SET Pattern=?, Payee_ID=? WHERE Pattern_ID=?',
        [pattern, payeeId, _selectedRow.Pattern_ID]);
    }
    _isNewMode = false;
    setDirty(false);
    refresh();
  }

  // ── Tab construction ───────────────────────────────────────────────────────

  function build(panel) {
    panel.innerHTML = `
      <div class="tab-layout">
        <div id="pattern-table-wrap" class="table-zone"></div>
        <div class="form-zone">
          <div id="pattern-form" class="form-body"></div>
        </div>
      </div>`;

    buildForm(panel);

    _table = new Tabulator('#pattern-table-wrap', {
      data:       loadData(),
      height:     '100%',
      layout:     'fitColumns',
      virtualDom: true,
      selectableRows: 1,
      headerSortTristate: true,
      columns: [
        { title: 'Pattern',    field: 'Pattern',    widthGrow: 2, headerFilter: 'input', headerSortTristate: true },
        { title: 'Payee Name', field: 'Payee_Name', widthGrow: 1, formatter: payeeNameFormatter, headerFilter: 'input', headerSortTristate: true }
      ]
    });

    _table.on('rowClick', (e, row) => {
      if (e.target.classList.contains('cell-link')) {
        const payeeId   = parseInt(e.target.dataset.payeeId, 10);
        const payeeName = row.getData().Payee_Name;
        TransactionsTab.openForPayee(payeeId, payeeName);
        return;
      }
      if (_formDirty) setDirty(false);
      _selectedRow = row.getData();
      _isNewMode   = false;
      document.getElementById('fpt-pattern').value  = _selectedRow.Pattern    || '';
      document.getElementById('fpt-payee').value    = _selectedRow.Payee_Name || '';
      document.getElementById('fpt-payee-id').value = String(_selectedRow.Payee_ID || '');
      setDirty(false);
    });
  }

  // ── Public ─────────────────────────────────────────────────────────────────

  function open() {
    App.Tabs.open(TAB_ID, 'Patterns', build, false);
  }

  function refresh() {
    if (_table) _table.setData(loadData());
  }

  async function handleDelete() {
    if (!_selectedRow) return;
    const ok = await Dialogs.confirm('Delete Pattern',
      `Set pattern "${_selectedRow.Pattern}" as inactive?`);
    if (ok) {
      const patternId = _selectedRow.Pattern_ID;
      const pos       = _table.getRows('active').findIndex(r => r.getData().Pattern_ID === patternId);
      DB.run('UPDATE Patterns SET Active = 0 WHERE Pattern_ID = ?', [patternId]);
      _selectedRow = null;
      ['fpt-pattern', 'fpt-payee', 'fpt-payee-id'].forEach(fId => {
        const el = document.getElementById(fId); if (el) el.value = '';
      });
      setDirty(false);
      _table.setData(loadData()).then(() => {
        const newRows = _table.getRows('active');
        if (!newRows.length) return;
        const target = newRows[Math.min(Math.max(pos, 0), newRows.length - 1)];
        _table.scrollToRow(target, 'center', false).catch(() => {});
        target.getElement().click();
      });
    }
  }

  return { open, refresh, handleDelete, TAB_ID };
})();
