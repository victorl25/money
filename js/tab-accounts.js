/* Accounts Tab */

const AccountsTab = (() => {
  const TAB_ID = 'accounts';
  let _table = null;

  // ── Formatters ─────────────────────────────────────────────────────────────

  function nameFormatter(cell) {
    const name = cell.getValue();
    const id   = cell.getRow().getData().Account_ID;
    return `<a class="cell-link" data-account-id="${id}">${name}</a>`;
  }

  function currencyFormatter(cell) {
    const v = cell.getValue();
    if (v == null) return '';
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(v);
  }

  // ── Data ───────────────────────────────────────────────────────────────────

  function loadData() {
    return DB.query(`
      SELECT a.Account_ID, a.Name, a.Type, a.Balance,
             MAX(t.Date) AS Last_Transaction,
             SUM(CASE WHEN t.Reviewed = 0 THEN 1 ELSE 0 END) AS To_Review
      FROM Accounts a
      LEFT JOIN Transactions t ON t.Account_ID = a.Account_ID AND t.Valid = 1
      WHERE a.Active = 1
      GROUP BY a.Account_ID, a.Name, a.Type, a.Balance
      ORDER BY a.Name`
    );
  }

  // ── Form ───────────────────────────────────────────────────────────────────

  let _selectedRow   = null;
  let _formDirty     = false;
  let _isNewMode     = false;

  function buildForm(panel) {
    const form = panel.querySelector('#acct-form');
    form.innerHTML = `
      <div class="form-col">
        <div class="form-field"><label>Name</label><input type="text" id="f-name" class="form-control"></div>
        <div class="form-field"><label>Type</label>
          <select id="f-type" class="form-control">
            <option>Bank</option><option>Credit card</option><option>Investment</option><option>Other</option>
          </select>
        </div>
        <div class="form-field"><label>Reference ID</label><input type="text" id="f-ref-id" class="form-control"></div>
      </div>
      <div class="form-col">
        <div class="form-field"><label>Starting Balance</label>
          <div class="amt-cur">
            <input type="number" id="f-start-bal" class="form-control" step="0.01">
            <input type="text"   id="f-currency"  class="form-control" maxlength="3">
          </div>
        </div>
        <div class="form-field"><label>Active</label>
          <select id="f-active" class="form-control">
            <option value="1">Yes</option><option value="0">No</option>
          </select>
        </div>
      </div>
      <div class="form-col-btns">
        <button id="f-new"    class="btn btn-secondary">New</button>
        <button id="f-delete" class="btn btn-danger hidden">Delete</button>
        <div class="btn-spacer"></div>
        <button id="f-accept" class="btn btn-primary hidden">Accept</button>
      </div>`;

    ['f-ref-id','f-name','f-type','f-currency','f-start-bal','f-active'].forEach(id => {
      document.getElementById(id).addEventListener('input', () => setDirty(true));
      document.getElementById(id).addEventListener('change', () => setDirty(true));
    });

    document.getElementById('f-new').addEventListener('click', () => {
      _isNewMode = true;
      _selectedRow = null;
      clearForm();
      setDirty(false);
      document.getElementById('f-accept').classList.remove('hidden');
    });

    document.getElementById('f-delete').addEventListener('click', handleDelete);
    document.getElementById('f-accept').addEventListener('click', commitAccount);
  }

  function setDirty(v) {
    _formDirty = v;
    const btn = document.getElementById('f-accept');
    if (btn) btn.classList.toggle('hidden', !v);
  }

  function clearForm() {
    document.getElementById('f-ref-id').value    = '';
    document.getElementById('f-name').value      = '';
    document.getElementById('f-type').value      = 'Bank';
    document.getElementById('f-currency').value  = 'USD';
    document.getElementById('f-start-bal').value = '';
    document.getElementById('f-active').value    = '1';
    const del = document.getElementById('f-delete'); if (del) del.classList.add('hidden');
  }

  function populateForm(data) {
    document.getElementById('f-ref-id').value    = data.Reference_ID || '';
    document.getElementById('f-name').value      = data.Name || '';
    document.getElementById('f-type').value      = data.Type || 'Bank';
    document.getElementById('f-currency').value  = data.Currency || 'USD';
    document.getElementById('f-start-bal').value = data.Starting_Balance != null ? data.Starting_Balance : '';
    document.getElementById('f-active').value    = String(data.Active != null ? data.Active : 1);
    setDirty(false);
  }

  async function commitAccount() {
    const refId   = document.getElementById('f-ref-id').value.trim() || null;
    const name    = document.getElementById('f-name').value.trim();
    const type    = document.getElementById('f-type').value;
    const cur     = document.getElementById('f-currency').value.trim() || 'USD';
    const startBal= parseFloat(document.getElementById('f-start-bal').value) || 0;
    const active  = parseInt(document.getElementById('f-active').value, 10);

    if (!name) { await Dialogs.alert('Validation', 'Name is required.'); return; }

    if (_isNewMode) {
      DB.run(
        `INSERT INTO Accounts (Reference_ID,Name,Type,Starting_Balance,Balance,Currency,Active)
         VALUES (?,?,?,?,?,?,?)`,
        [refId, name, type, startBal, startBal, cur, active]
      );
    } else if (_selectedRow) {
      const id = _selectedRow.Account_ID;
      DB.run(
        `UPDATE Accounts SET Reference_ID=?,Name=?,Type=?,Starting_Balance=?,Currency=?,Active=?
         WHERE Account_ID=?`,
        [refId, name, type, startBal, cur, active, id]
      );
      // Recalculate balance in case Starting_Balance changed
      DB.recalcAccountBalance(id, null);
    }

    _isNewMode = false;
    setDirty(false);
    refresh();
    App.onDataChanged(null);
  }

  // ── Tab construction ───────────────────────────────────────────────────────

  function build(panel) {
    panel.innerHTML = `
      <div class="tab-layout">
        <div id="acct-table-wrap" class="table-zone"></div>
        <div class="form-zone">
          <div id="acct-form" class="form-body"></div>
        </div>
      </div>`;

    buildForm(panel);

    _table = new Tabulator('#acct-table-wrap', {
      data:         loadData(),
      height:       '100%',
      layout:       'fitColumns',
      virtualDom:   true,
      selectableRows: 1,
      headerSortTristate: true,
      columns: [
        { title: 'Name',         field: 'Name',         widthGrow: 2, formatter: nameFormatter, headerFilter: 'input', headerSortTristate: true },
        { title: 'Type',         field: 'Type',         width: 130,   headerFilter: 'input', headerSortTristate: true },
        { title: 'Balance',      field: 'Balance',      width: 130,   formatter: currencyFormatter, hozAlign: 'right', headerSortTristate: true },
        { title: 'Last Transaction', field: 'Last_Transaction', width: 160, headerSortTristate: true },
        { title: 'To Review', field: 'To_Review', width: 100, hozAlign: 'right', headerSortTristate: true }
      ]
    });

    _table.on('rowClick', (e, row) => {
      // Handle account name hyperlink click
      if (e.target.classList.contains('cell-link')) {
        const accId = parseInt(e.target.dataset.accountId, 10);
        TransactionsTab.openForAccount(accId);
        return;
      }
      if (_formDirty) setDirty(false); // silently discard
      _selectedRow = row.getData();
      _isNewMode   = false;
      // Load full row from DB for Starting_Balance etc.
      const full = DB.queryOne('SELECT * FROM Accounts WHERE Account_ID = ?', [_selectedRow.Account_ID]);
      populateForm(full || _selectedRow);
      document.getElementById('f-delete').classList.remove('hidden');
    });
  }

  // ── Public ─────────────────────────────────────────────────────────────────

  function open() {
    App.Tabs.open(TAB_ID, 'Accounts', build, false);
  }

  function refresh() {
    if (_table) _table.setData(loadData());
  }

  // Handle Delete key on selected row
  async function handleDelete() {
    if (!_selectedRow) return;
    const id   = _selectedRow.Account_ID;
    const refs = DB.checkRefs('Account', id);
    if (refs.length) {
      await Dialogs.alert('Cannot Delete',
        `This account cannot be deleted because it is referenced by: ${refs.join(', ')}.`);
      return;
    }
    const ok = await Dialogs.confirm('Delete Account',
      `Set account "${_selectedRow.Name}" as inactive?`);
    if (ok) {
      const pos = _table.getRows('active').findIndex(r => r.getData().Account_ID === id);
      DB.run('UPDATE Accounts SET Active = 0 WHERE Account_ID = ?', [id]);
      _selectedRow = null;
      clearForm();
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
