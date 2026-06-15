/* Aliases Tab */

const AliasesTab = (() => {
  const TAB_ID = 'aliases';
  let _table       = null;
  let _selectedRow = null;
  let _formDirty   = false;
  let _isNewMode   = false;

  function loadData() {
    return DB.query(`
      SELECT pa.Alias_ID, pa.Alias, p.Payee_ID, p.Name AS Payee_Name
      FROM Aliases pa
      JOIN Payees p ON pa.Payee_ID = p.Payee_ID
      WHERE pa.Active = 1 AND p.Active = 1
      ORDER BY pa.Alias`
    );
  }

  function payeeNameFormatter(cell) {
    const name = cell.getValue();
    const id   = cell.getRow().getData().Payee_ID;
    return `<a class="cell-link" data-payee-id="${id}">${name}</a>`;
  }

  function buildForm(panel) {
    const form = panel.querySelector('#alias-form');
    form.innerHTML = `
      <div class="form-col">
        <div class="form-field"><label>Alias</label><input type="text" id="fa-alias" class="form-control"></div>
      </div>
      <div class="form-col">
        <div class="form-field"><label>Payee</label>
          <div class="ac-wrap">
            <input type="text"   id="fa-payee"    class="form-control" autocomplete="off" placeholder="Type to search...">
            <input type="hidden" id="fa-payee-id">
            <div id="fa-payee-list" class="ac-list"></div>
          </div>
        </div>
      </div>
      <div class="form-col-btns">
        <button id="fa-new"     class="btn btn-secondary">New</button>
        <button id="fa-convert" class="btn btn-secondary hidden">Convert to Pattern</button>
        <div class="btn-spacer"></div>
        <button id="fa-accept"  class="btn btn-primary hidden">Accept</button>
      </div>`;

    attachPayeeAutocomplete(
      document.getElementById('fa-payee'),
      document.getElementById('fa-payee-list'),
      document.getElementById('fa-payee-id')
    );

    ['fa-alias','fa-payee'].forEach(id => {
      document.getElementById(id).addEventListener('input', () => setDirty(true));
    });

    document.getElementById('fa-new').addEventListener('click', () => {
      _isNewMode = true; _selectedRow = null;
      document.getElementById('fa-alias').value    = '';
      document.getElementById('fa-payee').value    = '';
      document.getElementById('fa-payee-id').value = '';
      setDirty(false);
      document.getElementById('fa-accept').classList.remove('hidden');
      document.getElementById('fa-convert').classList.add('hidden');
    });

    document.getElementById('fa-accept').addEventListener('click', commit);
    document.getElementById('fa-convert').addEventListener('click', convertToPattern);
  }

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

  function setDirty(v) {
    _formDirty = v;
    const accept  = document.getElementById('fa-accept');
    const convert = document.getElementById('fa-convert');
    if (accept)  accept.classList.toggle('hidden', !v);
    if (convert) convert.classList.toggle('hidden', _isNewMode || (!_selectedRow && !v));
  }

  async function convertToPattern() {
    const alias    = document.getElementById('fa-alias').value.trim();
    const payeeTxt = document.getElementById('fa-payee').value.trim();
    let   payeeId  = parseInt(document.getElementById('fa-payee-id').value, 10) || null;

    if (!alias)    { await Dialogs.alert('Validation', 'Alias is required.'); return; }
    if (!payeeTxt) { await Dialogs.alert('Validation', 'Payee is required.'); return; }

    // Let user edit the alias into a regex pattern
    const pattern = await Dialogs.prompt('Convert to Pattern',
      'Edit the value below into a regular expression pattern:', alias);
    if (pattern === null) return; // cancelled

    // Validate regex
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

    DB.run('INSERT INTO Patterns (Payee_ID, Pattern, Active) VALUES (?,?,1)', [payeeId, pattern]);
    PatternsTab.refresh();
    await Dialogs.alert('Converted', `Pattern "${pattern}" has been added for "${payeeTxt}".`);
  }

  async function commit() {
    const alias    = document.getElementById('fa-alias').value.trim();
    const payeeTxt = document.getElementById('fa-payee').value.trim();
    let   payeeId  = parseInt(document.getElementById('fa-payee-id').value, 10) || null;

    if (!alias)    { await Dialogs.alert('Validation', 'Alias is required.'); return; }
    if (!payeeTxt) { await Dialogs.alert('Validation', 'Payee is required.'); return; }

    // Resolve payee
    if (!payeeId) payeeId = DB.lookupPayee(payeeTxt);
    if (!payeeId) {
      const ok = await Dialogs.confirm('New Payee', `Payee "${payeeTxt}" does not exist. Create it?`);
      if (!ok) return;
      payeeId = DB.createPayee(payeeTxt);
      App.onPayeesChanged();
    }

    const editedId = (!_isNewMode && _selectedRow) ? _selectedRow.Alias_ID : null;
    if (_isNewMode) {
      DB.run('INSERT INTO Aliases (Payee_ID, Alias, Active) VALUES (?,?,1)', [payeeId, alias]);
    } else if (_selectedRow) {
      DB.run('UPDATE Aliases SET Alias=?, Payee_ID=? WHERE Alias_ID=?',
        [alias, payeeId, _selectedRow.Alias_ID]);
    }
    _isNewMode = false;
    setDirty(false);
    if (editedId) {
      _table.setData(loadData()).then(() => {
        const row = _table.getRows('active').find(r => r.getData().Alias_ID === editedId);
        if (row) { _selectedRow = row.getData(); row.select(); _table.scrollToRow(row, 'center', false).catch(() => {}); }
      });
    } else {
      refresh();
    }
  }

  function build(panel) {
    panel.innerHTML = `
      <div class="tab-layout">
        <div id="alias-table-wrap" class="table-zone"></div>
        <div class="form-zone">
          <div id="alias-form" class="form-body"></div>
        </div>
      </div>`;

    buildForm(panel);

    _table = new Tabulator('#alias-table-wrap', {
      data:       loadData(),
      height:     '100%',
      layout:     'fitColumns',
      virtualDom: true,
      selectableRows: 1,
      headerSortTristate: true,
      columns: [
        { title: 'Alias',      field: 'Alias',      widthGrow: 2, headerFilter: 'input', headerSortTristate: true },
        { title: 'Payee Name', field: 'Payee_Name', widthGrow: 1, formatter: payeeNameFormatter, headerFilter: 'input', headerSortTristate: true }
      ]
    });

    _table.on('rowClick', (e, row) => {
      if (e.target.classList.contains('cell-link')) {
        const payeeId = parseInt(e.target.dataset.payeeId, 10);
        const payeeName = row.getData().Payee_Name;
        TransactionsTab.openForPayee(payeeId, payeeName);
        return;
      }
      _selectedRow = row.getData();
      _isNewMode   = false;
      document.getElementById('fa-alias').value    = _selectedRow.Alias      || '';
      document.getElementById('fa-payee').value    = _selectedRow.Payee_Name || '';
      document.getElementById('fa-payee-id').value = String(_selectedRow.Payee_ID || '');
      setDirty(false);
    });
  }

  function open() {
    App.Tabs.open(TAB_ID, 'Aliases', build, false);
  }

  function refresh() {
    if (_table) _table.setData(loadData());
  }

  async function handleDelete() {
    if (!_selectedRow) return;
    const ok = await Dialogs.confirm('Delete Alias',
      `Set alias "${_selectedRow.Alias}" as inactive?`);
    if (ok) {
      const aliasId = _selectedRow.Alias_ID;
      const pos     = _table.getRows('active').findIndex(r => r.getData().Alias_ID === aliasId);
      DB.run('UPDATE Aliases SET Active = 0 WHERE Alias_ID = ?', [aliasId]);
      _selectedRow = null;
      ['fa-alias','fa-payee','fa-payee-id'].forEach(fId => {
        const el = document.getElementById(fId); if (el) el.value = '';
      });
      setDirty(false);
      document.getElementById('fa-convert').classList.add('hidden');
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
