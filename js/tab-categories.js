/* Categories Tab */

const CategoriesTab = (() => {
  const TAB_ID = 'categories';
  let _table       = null;
  let _selectedRow = null;
  let _formDirty   = false;
  let _isNewMode   = false;

  function loadData() {
    return DB.query(`
      SELECT c.Category_ID, c.Name, c.Type, c.Notes,
             MAX(t.Date) AS Last_Transaction
      FROM Categories c
      LEFT JOIN Transactions t ON t.Category_ID = c.Category_ID AND t.Valid = 1
      WHERE c.Active = 1
      GROUP BY c.Category_ID, c.Name, c.Type, c.Notes
      ORDER BY c.Name`
    );
  }

  function nameFormatter(cell) {
    const name = cell.getValue();
    const id   = cell.getRow().getData().Category_ID;
    return `<a class="cell-link" data-cat-id="${id}">${name}</a>`;
  }

  function buildForm(panel) {
    const form = panel.querySelector('#cat-form');
    form.innerHTML = `
      <div class="form-col">
        <div class="form-field"><label>Name</label><input type="text" id="fc-name" class="form-control"></div>
        <div class="form-field"><label>Notes</label><input type="text" id="fc-notes" class="form-control"></div>
      </div>
      <div class="form-col">
        <div class="form-field">
          <label>Type</label>
          <select id="fc-type" class="form-control">
            <option value="Expense">Expense</option>
            <option value="Income">Income</option>
            <option value="Other">Other</option>
          </select>
        </div>
      </div>
      <div class="form-col-btns">
        <button id="fc-new"    class="btn btn-secondary">New</button>
        <button id="fc-delete" class="btn btn-danger hidden">Delete</button>
        <div class="btn-spacer"></div>
        <button id="fc-accept" class="btn btn-primary hidden">Accept</button>
      </div>`;

    document.getElementById('fc-name').addEventListener('input',  () => setDirty(true));
    document.getElementById('fc-notes').addEventListener('input', () => setDirty(true));
    document.getElementById('fc-type').addEventListener('change', () => setDirty(true));

    document.getElementById('fc-new').addEventListener('click', () => {
      _isNewMode = true; _selectedRow = null;
      document.getElementById('fc-name').value  = '';
      document.getElementById('fc-notes').value = '';
      document.getElementById('fc-type').value  = 'Expense';
      document.getElementById('fc-delete').classList.add('hidden');
      setDirty(false);
      document.getElementById('fc-accept').classList.remove('hidden');
    });

    document.getElementById('fc-delete').addEventListener('click', handleDelete);
    document.getElementById('fc-accept').addEventListener('click', commit);
  }

  function setDirty(v) {
    _formDirty = v;
    const btn = document.getElementById('fc-accept');
    if (btn) btn.classList.toggle('hidden', !v);
  }

  async function commit() {
    const name  = document.getElementById('fc-name').value.trim();
    if (!name) { await Dialogs.alert('Validation', 'Name is required.'); return; }
    const type  = document.getElementById('fc-type').value;
    const notes = document.getElementById('fc-notes').value.trim() || null;

    const editedId = (!_isNewMode && _selectedRow) ? _selectedRow.Category_ID : null;
    if (_isNewMode) {
      DB.run('INSERT INTO Categories (Name, Type, Notes, Active) VALUES (?, ?, ?, 1)', [name, type, notes]);
    } else if (_selectedRow) {
      DB.run('UPDATE Categories SET Name = ?, Type = ?, Notes = ? WHERE Category_ID = ?', [name, type, notes, _selectedRow.Category_ID]);
    }
    _isNewMode = false;
    setDirty(false);
    if (editedId) {
      _table.setData(loadData()).then(() => {
        const row = _table.getRows('active').find(r => r.getData().Category_ID === editedId);
        if (row) { _selectedRow = row.getData(); row.select(); _table.scrollToRow(row, 'center', false).catch(() => {}); }
      });
    } else {
      refresh();
    }
  }

  function build(panel) {
    panel.innerHTML = `
      <div class="tab-layout">
        <div id="cat-table-wrap" class="table-zone"></div>
        <div class="form-zone">
          <div id="cat-form" class="form-body"></div>
        </div>
      </div>`;

    buildForm(panel);

    _table = new Tabulator('#cat-table-wrap', {
      data:       loadData(),
      height:     '100%',
      layout:     'fitColumns',
      virtualDom: true,
      selectableRows: 1,
      headerSortTristate: true,
      columns: [
        { title: 'Name',             field: 'Name',             widthGrow: 2, formatter: nameFormatter, headerFilter: 'input', headerSortTristate: true },
        { title: 'Notes',            field: 'Notes',            widthGrow: 3, headerFilter: 'input', headerSortTristate: true },
        { title: 'Type',             field: 'Type',             width: 100, headerSortTristate: true },
        { title: 'Last Transaction', field: 'Last_Transaction', width: 160, headerSortTristate: true }
      ]
    });

    _table.on('rowClick', (e, row) => {
      if (e.target.classList.contains('cell-link')) {
        const catId   = parseInt(e.target.dataset.catId, 10);
        const catName = row.getData().Name;
        TransactionsTab.openForCategory(catId, catName);
        return;
      }
      if (_formDirty) setDirty(false);
      _selectedRow = row.getData();
      _isNewMode   = false;
      document.getElementById('fc-name').value  = _selectedRow.Name  || '';
      document.getElementById('fc-notes').value = _selectedRow.Notes || '';
      document.getElementById('fc-type').value  = _selectedRow.Type  || 'Expense';
      document.getElementById('fc-delete').classList.remove('hidden');
      setDirty(false);
    });
  }

  function open() {
    App.Tabs.open(TAB_ID, 'Categories', build, false);
  }

  function refresh() {
    if (_table) _table.setData(loadData());
  }

  async function handleDelete() {
    if (!_selectedRow) return;
    const id   = _selectedRow.Category_ID;
    if (id === 1 || id === 2) {
      const name = id === 1 ? 'Unassigned' : 'Transfer';
      await Dialogs.alert('Cannot Delete', `The "${name}" category is required by the application and cannot be deleted.`);
      return;
    }
    const refs = DB.checkRefs('Category', id);
    if (refs.length) {
      await Dialogs.alert('Cannot Delete',
        `This category cannot be deleted because it is referenced by: ${refs.join(', ')}.`);
      return;
    }
    const ok = await Dialogs.confirm('Delete Category',
      `Set category "${_selectedRow.Name}" as inactive?`);
    if (ok) {
      const pos = _table.getRows('active').findIndex(r => r.getData().Category_ID === id);
      DB.run('UPDATE Categories SET Active = 0 WHERE Category_ID = ?', [id]);
      _selectedRow = null;
      if (document.getElementById('fc-name'))   document.getElementById('fc-name').value  = '';
      if (document.getElementById('fc-notes'))  document.getElementById('fc-notes').value = '';
      if (document.getElementById('fc-delete')) document.getElementById('fc-delete').classList.add('hidden');
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
