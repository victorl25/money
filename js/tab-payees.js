/* Payees Tab */

const PayeesTab = (() => {
  const TAB_ID = 'payees';
  let _table       = null;
  let _selectedRow = null;
  let _formDirty   = false;
  let _isNewMode   = false;

  function loadData() {
    return DB.query(`
      SELECT p.Payee_ID, p.Name,
             MAX(t.Date) AS Last_Transaction
      FROM Payees p
      LEFT JOIN Transactions t ON t.Payee_ID = p.Payee_ID AND t.Valid = 1
      WHERE p.Active = 1
      GROUP BY p.Payee_ID, p.Name
      ORDER BY p.Name`
    );
  }

  function nameFormatter(cell) {
    const name = cell.getValue();
    const id   = cell.getRow().getData().Payee_ID;
    return `<a class="cell-link" data-payee-id="${id}">${name}</a>`;
  }

  function buildForm(panel) {
    const form = panel.querySelector('#payee-form');
    form.innerHTML = `
      <div class="form-col">
        <div class="form-field"><label>Name</label><input type="text" id="fp-name" class="form-control"></div>
      </div>
      <div class="form-col"></div>
      <div class="form-col-btns">
        <button id="fp-new"    class="btn btn-secondary">New</button>
        <div class="btn-spacer"></div>
        <button id="fp-accept" class="btn btn-primary hidden">Accept</button>
      </div>`;

    document.getElementById('fp-name').addEventListener('input', () => setDirty(true));

    document.getElementById('fp-new').addEventListener('click', () => {
      _isNewMode = true; _selectedRow = null;
      document.getElementById('fp-name').value = '';
      setDirty(false);
      document.getElementById('fp-accept').classList.remove('hidden');
    });

    document.getElementById('fp-accept').addEventListener('click', commit);
  }

  function setDirty(v) {
    _formDirty = v;
    const btn = document.getElementById('fp-accept');
    if (btn) btn.classList.toggle('hidden', !v);
  }

  async function commit() {
    const name = document.getElementById('fp-name').value.trim();
    if (!name) { await Dialogs.alert('Validation', 'Name is required.'); return; }

    const editedId = (!_isNewMode && _selectedRow) ? _selectedRow.Payee_ID : null;
    if (_isNewMode) {
      DB.createPayee(name);
    } else if (_selectedRow) {
      DB.run('UPDATE Payees SET Name = ? WHERE Payee_ID = ?', [name, _selectedRow.Payee_ID]);
    }
    _isNewMode = false;
    setDirty(false);
    if (editedId) {
      _table.setData(loadData()).then(() => {
        const row = _table.getRows('active').find(r => r.getData().Payee_ID === editedId);
        if (row) { _selectedRow = row.getData(); row.select(); _table.scrollToRow(row, 'center', false).catch(() => {}); }
      });
    } else {
      refresh();
    }
    App.onPayeesChanged();
  }

  function build(panel) {
    panel.innerHTML = `
      <div class="tab-layout">
        <div id="payee-table-wrap" class="table-zone"></div>
        <div class="form-zone">
          <div id="payee-form" class="form-body"></div>
        </div>
      </div>`;

    buildForm(panel);

    _table = new Tabulator('#payee-table-wrap', {
      data:       loadData(),
      height:     '100%',
      layout:     'fitColumns',
      virtualDom: true,
      selectableRows: 1,
      headerSortTristate: true,
      columns: [
        { title: 'Name',             field: 'Name',             widthGrow: 2, formatter: nameFormatter, headerFilter: 'input', headerSortTristate: true },
        { title: 'Last Transaction', field: 'Last_Transaction', width: 160, headerSortTristate: true }
      ]
    });

    _table.on('rowClick', (e, row) => {
      if (e.target.classList.contains('cell-link')) {
        const payeeId = parseInt(e.target.dataset.payeeId, 10);
        const payeeName = row.getData().Name;
        TransactionsTab.openForPayee(payeeId, payeeName);
        return;
      }
      if (_formDirty) setDirty(false);
      _selectedRow = row.getData();
      _isNewMode   = false;
      document.getElementById('fp-name').value = _selectedRow.Name || '';
      setDirty(false);
    });
  }

  function open() {
    App.Tabs.open(TAB_ID, 'Payees', build, false);
  }

  function refresh() {
    if (_table) _table.setData(loadData());
  }

  async function handleDelete() {
    if (!_selectedRow) return;
    const id   = _selectedRow.Payee_ID;
    const refs = DB.checkRefs('Payee', id);
    if (refs.length) {
      await Dialogs.alert('Cannot Delete',
        `This payee cannot be deleted because it is referenced by: ${refs.join(', ')}.`);
      return;
    }
    const ok = await Dialogs.confirm('Delete Payee',
      `Set payee "${_selectedRow.Name}" as inactive?`);
    if (ok) {
      const pos = _table.getRows('active').findIndex(r => r.getData().Payee_ID === id);
      DB.run('UPDATE Payees SET Active = 0 WHERE Payee_ID = ?', [id]);
      _selectedRow = null;
      if (document.getElementById('fp-name')) document.getElementById('fp-name').value = '';
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
