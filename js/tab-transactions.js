/* Transactions Tab */

const TransactionsTab = (() => {
  // Registry of open transaction tabs: id -> { table, accountId, payeeId, catId, selectedRow, formDirty }
  const _instances = {};

  // ── Formatters ──────────────────────────────────────────────────────────────

  function currencyFormatter(cell) {
    const v = cell.getValue();
    if (v == null || v === '') return '';
    return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(v));
  }

  function actionsFormatter(cell) {
    const d = cell.getRow().getData();
    let html = '';
    if (!d.Reviewed) html += `<button class="act-btn accept-btn">Accept</button>`;
    if (d.Linked_Transaction_ID) {
      html += `<button class="act-btn merge-btn">Merge</button>`;
      html += `<button class="act-btn unmerge-btn">Unmerge</button>`;
    }
    return html;
  }

  function rowFormatter(row) {
    const d  = row.getData();
    const el = row.getElement();
    el.style.backgroundColor = d.Linked_Transaction_ID ? '#fde8cc' : '';
    el.style.fontWeight       = !d.Reviewed ? 'bold' : '';
  }

  // ── Data assembly ──────────────────────────────────────────────────────────

  function buildTableData(accountId, payeeId, catId, dateFrom, dateTo) {
    let sql = `
      SELECT t.Transaction_ID, t.Reference_ID, t.Date, t.Memo,
             t.Account_ID,  a.Name  AS Account_Name,
             t.Payee_ID,    p.Name  AS Payee_Name,
             t.Category_ID, c.Name  AS Category_Name,
             t.Amount, t.Type, t.Currency, t.Transfer_Account_ID,
             t.Reviewed, t.Linked_Transaction_ID, t.Valid
      FROM Transactions t
      LEFT JOIN Accounts  a ON t.Account_ID  = a.Account_ID
      LEFT JOIN Payees    p ON t.Payee_ID    = p.Payee_ID
      LEFT JOIN Categories c ON t.Category_ID = c.Category_ID
      WHERE t.Valid = 1`;
    const params = [];
    if (accountId) { sql += ' AND t.Account_ID = ?';   params.push(accountId); }
    if (payeeId)   { sql += ' AND t.Payee_ID = ?';     params.push(payeeId); }
    if (catId)     { sql += ' AND t.Category_ID = ?';  params.push(catId); }
    if (dateFrom)  { sql += ' AND t.Date >= ?';        params.push(dateFrom); }
    if (dateTo)    { sql += ' AND t.Date <= ?';        params.push(dateTo); }
    sql += ' ORDER BY t.Date ASC, t.Transaction_ID ASC';

    const rows = DB.query(sql, params);
    return interleaveLinked(rows);
  }

  /** Insert linked (potential duplicate) rows immediately after their parent. */
  function interleaveLinked(rows) {
    const main   = rows.filter(r => !r.Linked_Transaction_ID);
    const linked = rows.filter(r =>  r.Linked_Transaction_ID);
    const byParent = {};
    linked.forEach(r => {
      if (!byParent[r.Linked_Transaction_ID]) byParent[r.Linked_Transaction_ID] = [];
      byParent[r.Linked_Transaction_ID].push(r);
    });
    const out = [];
    for (const r of main) {
      out.push(r);
      if (byParent[r.Transaction_ID]) out.push(...byParent[r.Transaction_ID]);
    }
    return out;
  }

  /** Compute running balance column and split Amount into Debit/Credit. */
  function enrichRows(rows, startingBalance, showBalance) {
    let bal = startingBalance;
    return rows.map(r => {
      const debit  = r.Amount < 0 ? Math.abs(r.Amount) : null;
      const credit = r.Amount > 0 ? r.Amount : null;
      if (showBalance && !r.Linked_Transaction_ID) bal += r.Amount;
      const parts = [];
      if (!r.Reviewed)              parts.push('Accept');
      if (r.Linked_Transaction_ID)  parts.push('Merge', 'Unmerge');
      return {
        ...r,
        Debit:        debit,
        Credit:       credit,
        Balance:      showBalance && !r.Linked_Transaction_ID ? bal : null,
        _actionLabel: parts.join(' ')
      };
    });
  }

  // ── Autocomplete helpers ────────────────────────────────────────────────────

  function attachPayeeAutocomplete(inputEl, listEl, onSelect) {
    inputEl.addEventListener('input', () => {
      const q = inputEl.value.trim();
      if (!q) { listEl.innerHTML = ''; return; }
      const matches = DB.query(
        `SELECT Payee_ID, Name FROM Payees WHERE Name LIKE ? AND Active = 1 LIMIT 10`,
        [`${q}%`]
      );
      listEl.innerHTML = matches.map(m =>
        `<div class="ac-item" data-id="${m.Payee_ID}" data-name="${m.Name}">${m.Name}</div>`
      ).join('');
    });
    listEl.addEventListener('mousedown', e => {
      const item = e.target.closest('.ac-item');
      if (!item) return;
      inputEl.value              = item.dataset.name;
      inputEl.dataset.payeeId    = item.dataset.id;
      listEl.innerHTML           = '';
      inputEl.dispatchEvent(new Event('input'));
      if (onSelect) onSelect(parseInt(item.dataset.id, 10), item.dataset.name);
    });
    inputEl.addEventListener('blur', () => setTimeout(() => { listEl.innerHTML = ''; }, 150));
    addAcKeyboard(inputEl, listEl);
  }

  function attachAccountAutocomplete(inputEl, hiddenEl, listEl) {
    inputEl.addEventListener('input', () => {
      const q = inputEl.value.trim();
      hiddenEl.value = '';
      if (!q) { listEl.innerHTML = ''; return; }
      const matches = DB.query(
        `SELECT Account_ID, Name FROM Accounts WHERE Name LIKE ? AND Active = 1 LIMIT 10`,
        [`%${q}%`]
      );
      listEl.innerHTML = matches.map(m =>
        `<div class="ac-item" data-id="${m.Account_ID}" data-name="${m.Name}">${m.Name}</div>`
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
    addAcKeyboard(inputEl, listEl);
  }

  function attachCategoryAutocomplete(inputEl, hiddenEl, listEl) {
    inputEl.addEventListener('input', () => {
      const q = inputEl.value.trim();
      hiddenEl.value = '';
      if (!q) { listEl.innerHTML = ''; return; }
      const matches = DB.query(
        `SELECT Category_ID, Name FROM Categories WHERE Name LIKE ? AND Active = 1 LIMIT 10`,
        [`${q}%`]
      );
      listEl.innerHTML = matches.map(m =>
        `<div class="ac-item" data-id="${m.Category_ID}" data-name="${m.Name}">${m.Name}</div>`
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
    addAcKeyboard(inputEl, listEl);
  }

  // ── Form handling ──────────────────────────────────────────────────────────

  /** Returns the form element scoped to this tab instance. */
  function fld(inst, name) {
    return document.getElementById(`ft-${inst.id}-${name}`);
  }

  function buildForm(inst, panel) {
    const form = panel.querySelector('.trn-form');
    const accounts = DB.query('SELECT Account_ID, Name FROM Accounts WHERE Active = 1 ORDER BY Name');
    const acctOpts = accounts.map(a =>
      `<option value="${a.Account_ID}">${a.Name}</option>`).join('');

    const p = `ft-${inst.id}`;   // per-instance ID prefix
    form.innerHTML = `
      <div class="form-col">
        <div class="form-field" id="${p}-payee-row"><label>Payee</label>
          <div class="ac-wrap">
            <input type="text" id="${p}-payee" class="form-control" autocomplete="off">
            <input type="hidden" id="${p}-payee-id">
            <div id="${p}-payee-list" class="ac-list"></div>
          </div>
        </div>
        <div class="form-field hidden" id="${p}-dest-row"><label>To/From</label>
          <div class="ac-wrap">
            <input type="text" id="${p}-dest" class="form-control" autocomplete="off" placeholder="Account name...">
            <input type="hidden" id="${p}-dest-id">
            <div id="${p}-dest-list" class="ac-list"></div>
          </div>
        </div>
        <div class="form-field"><label>Memo</label><input type="text" id="${p}-memo" class="form-control"></div>
        <div class="form-field"><label>Account</label><select id="${p}-account" class="form-control">${acctOpts}</select></div>
        <div class="form-field"><label>Reference ID</label><input type="text" id="${p}-ref" class="form-control form-readonly" readonly></div>
      </div>
      <div class="form-col">
        <div class="form-field"><label>Category</label>
          <div class="ac-wrap">
            <input type="text" id="${p}-category" class="form-control" autocomplete="off">
            <input type="hidden" id="${p}-category-id">
            <div id="${p}-category-list" class="ac-list"></div>
          </div>
        </div>
        <div class="form-field"><label>Date</label><input type="date" id="${p}-date" class="form-control"></div>
        <div class="form-field"><label>Amount</label>
          <div class="amt-cur">
            <input type="number" id="${p}-amount" class="form-control" step="0.01">
            <input type="text" id="${p}-currency" class="form-control" maxlength="3">
          </div>
        </div>
        <div class="form-field"><label>Type</label><input type="text" id="${p}-type" class="form-control form-readonly" readonly></div>
      </div>
      <div class="form-col-btns">
        <button id="${p}-new"      class="btn btn-secondary">New</button>
        <button id="${p}-delete"   class="btn btn-danger hidden">Delete</button>
        <button id="${p}-merge"    class="btn btn-secondary">Merge</button>
        <button id="${p}-transfer" class="btn btn-secondary" disabled>Transfer</button>
        <div class="btn-spacer"></div>
        <button id="${p}-accept"   class="btn btn-primary hidden">Accept</button>
      </div>`;

    attachPayeeAutocomplete(fld(inst, 'payee'), fld(inst, 'payee-list'), (payeeId) => {
      // If the transaction's category is Unassigned (ID=1 or blank), fill in
      // the most recently used category for the selected payee.
      const currentCatId = parseInt(fld(inst, 'category-id').value || '0', 10);
      if (currentCatId <= 1) {
        const lastCatId = DB.getLastCategory(payeeId);
        if (lastCatId && lastCatId !== 1) {
          const cat = DB.queryOne('SELECT Name FROM Categories WHERE Category_ID = ? AND Active = 1', [lastCatId]);
          if (cat) {
            fld(inst, 'category').value    = cat.Name;
            fld(inst, 'category-id').value = String(lastCatId);
          }
        }
      }
    });
    attachAccountAutocomplete(fld(inst, 'dest'), fld(inst, 'dest-id'), fld(inst, 'dest-list'));
    attachCategoryAutocomplete(fld(inst, 'category'), fld(inst, 'category-id'), fld(inst, 'category-list'));

    ['date','account','payee','dest','memo','category','amount','currency'].forEach(name => {
      const el = fld(inst, name);
      if (el) {
        el.addEventListener('input',  () => instSetDirty(inst, true));
        el.addEventListener('change', () => instSetDirty(inst, true));
      }
    });

    fld(inst, 'new').addEventListener('click', () => {
      inst.isNewMode   = true;
      inst.selectedRow = null;
      clearTrnForm(inst);
      instSetDirty(inst, false);
      fld(inst, 'accept').classList.remove('hidden');
      updateTransferBtn(inst);
    });

    fld(inst, 'delete').addEventListener('click',   () => handleDelete(inst));
    fld(inst, 'accept').addEventListener('click',   () => handleFormAccept(inst));
    fld(inst, 'merge').addEventListener('click',    () => launchMerge(inst));
    fld(inst, 'transfer').addEventListener('click', () => handleTransfer(inst));
  }

  function instSetDirty(inst, v) {
    inst.formDirty = v;
    updateAcceptBtn(inst);
  }

  /** Accept button is shown when form is dirty OR the selected row is unreviewed. */
  function updateAcceptBtn(inst) {
    const btn = fld(inst, 'accept');
    if (!btn) return;
    const needsReview = inst.selectedRow && !inst.selectedRow.Reviewed;
    btn.classList.toggle('hidden', !inst.formDirty && !needsReview);
  }

  function updateTransferBtn(inst) {
    const btn = fld(inst, 'transfer');
    if (!btn) return;
    const hasRow     = !inst.isNewMode && !!inst.selectedRow;
    const isTransfer = inst.selectedRow && inst.selectedRow.Type === 'Transfer';
    btn.disabled = !hasRow || isTransfer;
  }

  function clearTrnForm(inst) {
    ['ref','date','memo','amount','category','category-id','dest','dest-id'].forEach(name => {
      const el = fld(inst, name); if (el) el.value = '';
    });
    const cur  = fld(inst, 'currency'); if (cur)  cur.value  = 'USD';
    const type = fld(inst, 'type');     if (type) type.value = '';
    // Restore default visibility: Payee shown, Destination hidden
    const payeeRow = fld(inst, 'payee-row'); if (payeeRow) payeeRow.classList.remove('hidden');
    const destRow  = fld(inst, 'dest-row');  if (destRow)  destRow.classList.add('hidden');
    // Restore Category to editable
    const catEl = fld(inst, 'category');
    if (catEl) { catEl.readOnly = false; catEl.classList.remove('form-readonly'); }
    const delBtn = fld(inst, 'delete'); if (delBtn) delBtn.classList.add('hidden');
  }

  function populateTrnForm(inst, data) {
    const isTransfer = data.Type === 'Transfer';

    // Toggle Payee row vs Destination row
    const payeeRow = fld(inst, 'payee-row'); if (payeeRow) payeeRow.classList.toggle('hidden',  isTransfer);
    const destRow  = fld(inst, 'dest-row');  if (destRow)  destRow.classList.toggle('hidden', !isTransfer);

    fld(inst, 'ref').value          = data.Reference_ID  || '';
    fld(inst, 'date').value         = data.Date          || '';
    fld(inst, 'account').value      = String(data.Account_ID || '');
    fld(inst, 'memo').value         = data.Memo          || '';
    fld(inst, 'category').value     = data.Category_Name || '';
    fld(inst, 'category-id').value  = String(data.Category_ID || '');
    fld(inst, 'amount').value       = data.Amount != null ? data.Amount : '';
    fld(inst, 'currency').value     = data.Currency      || 'USD';
    fld(inst, 'type').value         = data.Type          || '';

    if (isTransfer) {
      fld(inst, 'payee').value    = '';
      fld(inst, 'payee-id').value = '';
      const destAcc = data.Transfer_Account_ID
        ? DB.queryOne('SELECT Name FROM Accounts WHERE Account_ID = ?', [data.Transfer_Account_ID])
        : null;
      fld(inst, 'dest').value    = destAcc ? destAcc.Name : '';
      fld(inst, 'dest-id').value = String(data.Transfer_Account_ID || '');
    } else {
      fld(inst, 'payee').value    = data.Payee_Name    || '';
      fld(inst, 'payee-id').value = String(data.Payee_ID || '');
      fld(inst, 'dest').value    = '';
      fld(inst, 'dest-id').value = '';
    }

    // Make Category read-only for Transfer transactions
    const catEl = fld(inst, 'category');
    if (catEl) {
      catEl.readOnly = isTransfer;
      catEl.classList.toggle('form-readonly', isTransfer);
    }

    const delBtn = fld(inst, 'delete'); if (delBtn) delBtn.classList.remove('hidden');
    instSetDirty(inst, false);
    updateTransferBtn(inst);
  }

  /** Re-select a row by Transaction_ID after a setData refresh. */
  function reselectRow(inst, trnId) {
    if (!inst.table || !trnId) return;
    const target = inst.table.getRows('active').find(r => r.getData().Transaction_ID === trnId);
    if (!target) return;
    inst.table.deselectRow();
    target.select();
    inst.selectedRow = target.getData();
    populateTrnForm(inst, inst.selectedRow);
    updateAcceptBtn(inst);
    inst.table.scrollToRow(target, 'nearest', false).catch(() => {});
  }

  /**
   * Dual-purpose Accept handler for the Transactions form button:
   * 1. Saves any edited form data (if dirty).
   * 2. Marks the selected transaction as Reviewed = 1 (if not already).
   */
  async function handleFormAccept(inst) {
    const savedRow   = inst.selectedRow;
    const willReview = savedRow && !savedRow.Reviewed;
    const savedTrnId = savedRow ? savedRow.Transaction_ID : null;

    if (inst.formDirty) await commitTrn(inst);

    if (willReview && savedRow) {
      DB.run('UPDATE Transactions SET Reviewed = 1 WHERE Transaction_ID = ?',
        [savedRow.Transaction_ID]);
      refreshInstance(inst, savedTrnId ? () => reselectRow(inst, savedTrnId) : null);
      updateAcceptBtn(inst);
    }
  }

  async function commitTrn(inst) {
    const refId    = fld(inst, 'ref').value.trim()      || null;
    const date     = fld(inst, 'date').value.trim();
    const accountId= parseInt(fld(inst, 'account').value, 10);
    const payeeTxt = fld(inst, 'payee').value.trim();
    const memo     = fld(inst, 'memo').value.trim()     || null;
    const catTxt   = fld(inst, 'category').value.trim();
    const amount   = parseFloat(fld(inst, 'amount').value);
    const currency = fld(inst, 'currency').value.trim() || 'USD';
    // Type is informational — preserve Transfer if already set, otherwise derive from amount sign
    const type = (!inst.isNewMode && inst.selectedRow && inst.selectedRow.Type === 'Transfer')
      ? 'Transfer'
      : (amount >= 0 ? 'Credit' : 'Debit');

    if (!date) { await Dialogs.alert('Validation', 'Date is required.'); return; }
    if (isNaN(amount)) { await Dialogs.alert('Validation', 'Amount must be a number.'); return; }

    // ── Transfer transaction editing ─────────────────────────────────────────
    if (type === 'Transfer' && !inst.isNewMode && inst.selectedRow) {
      const destTxt = fld(inst, 'dest').value.trim();
      let   destId  = parseInt(fld(inst, 'dest-id').value, 10) || null;

      // Resolve destination account by exact name if the hidden ID was cleared
      if (!destId && destTxt) {
        const acc = DB.queryOne('SELECT Account_ID FROM Accounts WHERE Name = ? AND Active = 1', [destTxt]);
        if (!acc) { await Dialogs.alert('Validation', `Account "${destTxt}" does not exist.`); return; }
        destId = acc.Account_ID;
      }
      if (!destId) { await Dialogs.alert('Validation', 'Destination account is required.'); return; }

      // Resolve category (same logic as non-transfer path)
      let catId = parseInt(fld(inst, 'category-id').value, 10) || null;
      if (!catId && catTxt) {
        const cr = DB.queryOne('SELECT Category_ID FROM Categories WHERE Name = ? AND Active = 1', [catTxt]);
        if (cr) {
          catId = cr.Category_ID;
        } else {
          const ok = await Dialogs.confirm('New Category', `Category "${catTxt}" does not exist. Create it?`);
          if (!ok) return;
          DB.run('INSERT INTO Categories (Name, Type, Active) VALUES (?, \'Expense\', 1)', [catTxt]);
          catId = DB.queryOne('SELECT last_insert_rowid() AS id').id;
          CategoriesTab.refresh();
        }
      }
      if (!catId) catId = 1;

      const srcId    = inst.selectedRow.Account_ID;
      const oldDestId = inst.selectedRow.Transfer_Account_ID;
      const trnId    = inst.selectedRow.Transaction_ID;

      // Update source transaction
      DB.run(
        `UPDATE Transactions SET Reference_ID=?,Date=?,Memo=?,Account_ID=?,Category_ID=?,
           Amount=?,Currency=?,Transfer_Account_ID=? WHERE Transaction_ID=?`,
        [refId, date, memo, accountId, catId, amount, currency, destId, trnId]
      );
      DB.recalcAccountBalance(accountId, null);

      // Update paired transaction
      const pairRow = DB.queryOne(
        `SELECT Transaction_ID FROM Transactions
         WHERE Account_ID = ? AND Transfer_Account_ID = ? AND Type = 'Transfer' AND Valid = 1`,
        [oldDestId, srcId]
      );
      if (pairRow) {
        DB.run(
          `UPDATE Transactions SET Account_ID=?,Amount=?,Transfer_Account_ID=? WHERE Transaction_ID=?`,
          [destId, -amount, accountId, pairRow.Transaction_ID]
        );
        // Recalc old destination if it changed (transaction moved out of it)
        if (destId !== oldDestId) {
          DB.recalcAccountBalance(oldDestId, null);
          App.onDataChanged(oldDestId);
        }
        DB.recalcAccountBalance(destId, null);
        App.onDataChanged(destId);
      }

      inst.isNewMode   = false;
      inst.selectedRow = null;
      instSetDirty(inst, false);
      refreshInstance(inst, () => reselectRow(inst, trnId));
      App.onDataChanged(accountId);
      return;
    }

    // Resolve payee — with rename/alias logic
    const oldPayeeId   = (!inst.isNewMode && inst.selectedRow) ? (inst.selectedRow.Payee_ID   || null) : null;
    const oldPayeeName = (!inst.isNewMode && inst.selectedRow) ? (inst.selectedRow.Payee_Name || null) : null;
    let payeeId = null;
    let payeeModified = false; // true when payee was renamed, merged, or newly created
    if (payeeTxt) {
      payeeId = DB.lookupPayee(payeeTxt);
      if (payeeId) {
        // Typed name matched an existing payee
        if (oldPayeeId && oldPayeeId !== payeeId) {
          // Switching to a different payee — merge or reassign
          const choice = await Dialogs.confirmSingleAll('Change Payee',
            `This transaction is linked to "${oldPayeeName}". ` +
            `Change to "${payeeTxt}" for this transaction only (Single) or move all transactions from "${oldPayeeName}" to "${payeeTxt}" (All)?`);
          if (!choice) return;
          if (choice === 'all') {
            DB.run('UPDATE Transactions SET Payee_ID=? WHERE Payee_ID=?', [payeeId, oldPayeeId]);
            DB.run('UPDATE Payees SET Active=0 WHERE Payee_ID=?', [oldPayeeId]);
          }
          const dup = DB.queryOne(
            'SELECT Alias_ID FROM Aliases WHERE Alias=? AND Payee_ID=? AND Active=1',
            [oldPayeeName, payeeId]);
          if (!dup) DB.run('INSERT INTO Aliases (Payee_ID,Alias,Active) VALUES (?,?,1)', [payeeId, oldPayeeName]);
          App.onPayeesChanged();
        } else if (oldPayeeName && oldPayeeName !== payeeTxt) {
          // Same payee resolved under a different typed name — save old name as alias
          const dup = DB.queryOne(
            'SELECT Alias_ID FROM Aliases WHERE Alias=? AND Payee_ID=? AND Active=1',
            [oldPayeeName, payeeId]);
          if (!dup) {
            DB.run('INSERT INTO Aliases (Payee_ID,Alias,Active) VALUES (?,?,1)', [payeeId, oldPayeeName]);
            App.onPayeesChanged();
          }
        }
      } else if (oldPayeeId) {
        // No match — rename the existing linked payee, or create a new one for this transaction only
        const choice = await Dialogs.confirmSingleAll('Change Payee',
          `No payee named "${payeeTxt}" exists. ` +
          `Rename "${oldPayeeName}" to "${payeeTxt}" for all transactions (All) or create a new payee for this transaction only (Single)?`);
        if (!choice) return;
        if (choice === 'all') {
          DB.run('UPDATE Payees SET Name=? WHERE Payee_ID=?', [payeeTxt, oldPayeeId]);
          const dup = DB.queryOne(
            'SELECT Alias_ID FROM Aliases WHERE Alias=? AND Payee_ID=? AND Active=1',
            [oldPayeeName, oldPayeeId]);
          if (!dup) DB.run('INSERT INTO Aliases (Payee_ID,Alias,Active) VALUES (?,?,1)', [oldPayeeId, oldPayeeName]);
          payeeId = oldPayeeId;
          payeeModified = true; // renamed: payeeId === oldPayeeId so we flag explicitly
        } else {
          // Single — create a new payee, save the old (imported) name as its alias
          payeeId = DB.createPayee(payeeTxt, false);
          const dup = DB.queryOne(
            'SELECT Alias_ID FROM Aliases WHERE Alias=? AND Payee_ID=? AND Active=1',
            [oldPayeeName, payeeId]);
          if (!dup) DB.run('INSERT INTO Aliases (Payee_ID,Alias,Active) VALUES (?,?,1)', [payeeId, oldPayeeName]);
        }
        App.onPayeesChanged();
      } else {
        // No match, no prior payee — create new payee (with alias, form path)
        const ok = await Dialogs.confirm('New Payee', `Create new payee "${payeeTxt}"?`);
        if (!ok) return;
        payeeId = DB.createPayee(payeeTxt);
        App.onPayeesChanged();
      }
    }

    // Resolve category
    let catId = parseInt(fld(inst, 'category-id').value, 10) || null;
    if (!catId && catTxt) {
      const cr = DB.queryOne('SELECT Category_ID FROM Categories WHERE Name = ? AND Active = 1', [catTxt]);
      if (cr) {
        catId = cr.Category_ID;
      } else {
        const ok = await Dialogs.confirm('New Category', `Category "${catTxt}" does not exist. Create it?`);
        if (!ok) return;
        DB.run('INSERT INTO Categories (Name, Active) VALUES (?, 1)', [catTxt]);
        catId = DB.queryOne('SELECT last_insert_rowid() AS id').id;
        CategoriesTab.refresh();
      }
    }
    if (!catId) catId = 1; // fallback to Unassigned

    let savedTrnId = null;
    if (inst.isNewMode) {
      DB.run(
        `INSERT INTO Transactions
           (Reference_ID,Date,Memo,Account_ID,Payee_ID,Category_ID,Amount,Type,Currency,Reviewed,Valid)
         VALUES (?,?,?,?,?,?,?,?,?,0,1)`,
        [refId, date, memo, accountId, payeeId || null, catId, amount, type, currency]
      );
      savedTrnId = DB.queryOne('SELECT last_insert_rowid() AS id').id;
      DB.recalcAccountBalance(accountId, null);
    } else if (inst.selectedRow) {
      savedTrnId = inst.selectedRow.Transaction_ID;
      DB.run(
        `UPDATE Transactions SET Reference_ID=?,Date=?,Memo=?,Account_ID=?,Payee_ID=?,
           Category_ID=?,Amount=?,Type=?,Currency=? WHERE Transaction_ID=?`,
        [refId, date, memo, accountId, payeeId || null, catId, amount, type, currency, savedTrnId]
      );
      DB.recalcAccountBalance(accountId, null);
    }

    // If payee changed or was renamed, silently copy the category to all other unreviewed
    // transactions with the same payee that are visible in this tab
    if (payeeId && (payeeId !== oldPayeeId || payeeModified) && catId && savedTrnId) {
      let bulkSql = `SELECT Transaction_ID FROM Transactions
                     WHERE Valid = 1 AND Reviewed = 0 AND Payee_ID = ? AND Transaction_ID != ?`;
      const bulkParams = [payeeId, savedTrnId];
      if (inst.accountId) { bulkSql += ' AND Account_ID = ?';   bulkParams.push(inst.accountId); }
      if (inst.catId)     { bulkSql += ' AND Category_ID = ?';  bulkParams.push(inst.catId); }
      DB.query(bulkSql, bulkParams).forEach(r =>
        DB.run('UPDATE Transactions SET Category_ID = ? WHERE Transaction_ID = ?', [catId, r.Transaction_ID])
      );
    }

    inst.isNewMode   = false;
    inst.selectedRow = null;
    instSetDirty(inst, false);
    refreshInstance(inst, savedTrnId ? () => reselectRow(inst, savedTrnId) : null);
    App.onDataChanged(accountId);
  }

  async function handleTransfer(inst) {
    if (!inst.selectedRow) return;
    const row = inst.selectedRow;

    const destAccounts = DB.query(
      `SELECT Account_ID, Name, Type FROM Accounts WHERE Active = 1 AND Account_ID != ? ORDER BY Name`,
      [row.Account_ID]
    );
    if (!destAccounts.length) {
      await Dialogs.alert('Transfer', 'No other accounts available to transfer to.');
      return;
    }

    const destId = await Dialogs.selectAccount('Transfer To', destAccounts, 'Select the destination account:');
    if (destId == null) return;

    // Resolve Transfer category ID
    const transferCatRow = DB.queryOne("SELECT Category_ID FROM Categories WHERE Name='Transfer' AND Active=1");
    const transferCatId  = transferCatRow ? transferCatRow.Category_ID : (row.Category_ID || 1);

    // Update the source transaction — set Transfer_Account_ID, Type, Category and mark as Reviewed
    DB.run(
      'UPDATE Transactions SET Transfer_Account_ID=?, Type=?, Category_ID=?, Reviewed=1 WHERE Transaction_ID=?',
      [destId, 'Transfer', transferCatId, row.Transaction_ID]
    );

    // Create mirror transaction on destination account
    DB.run(
      `INSERT INTO Transactions
         (Reference_ID, Date, Memo, Account_ID, Transfer_Account_ID, Payee_ID, Category_ID,
          Amount, Type, Currency, Reviewed, Valid)
       VALUES (?,?,?,?,?,?,?,?,?,?,0,1)`,
      [row.Reference_ID || null, row.Date, row.Memo || null,
       destId, row.Account_ID,
       row.Payee_ID || null, transferCatId,
       -(row.Amount), 'Transfer', row.Currency || 'USD']
    );

    DB.recalcAccountBalance(row.Account_ID, null);
    DB.recalcAccountBalance(destId, null);
    inst.isNewMode = false;
    instSetDirty(inst, false);
    refreshInstance(inst);

    // Re-populate form with the updated Transfer row so Destination field is shown
    const trnId      = row.Transaction_ID;
    const updatedRow = inst.table.getData().find(r => r.Transaction_ID === trnId);
    if (updatedRow) {
      inst.selectedRow = updatedRow;
      populateTrnForm(inst, updatedRow);
    } else {
      inst.selectedRow = null;
      clearTrnForm(inst);
    }
    updateAcceptBtn(inst);

    App.onDataChanged(row.Account_ID);
    App.onDataChanged(destId);
  }

  async function launchMerge(inst) {
    if (!inst.selectedRow) {
      await Dialogs.alert('Merge', 'Select a transaction first.'); return;
    }
    const row = inst.selectedRow;
    const candidates = DB.query(
      `SELECT t.Transaction_ID, t.Date, t.Amount, p.Name AS Payee_Name
       FROM Transactions t LEFT JOIN Payees p ON t.Payee_ID = p.Payee_ID
       WHERE t.Account_ID = ? AND t.Amount = ? AND t.Transaction_ID <> ?
         AND t.Valid = 1 AND t.Linked_Transaction_ID IS NULL
       ORDER BY t.Date ASC`,
      [row.Account_ID, row.Amount, row.Transaction_ID]
    );
    if (!candidates.length) {
      await Dialogs.alert('Merge', 'No other transactions with the same amount found.');
      return;
    }
    const linkedId = await Dialogs.mergePopup(candidates);
    if (linkedId == null) return;
    DB.run(
      `UPDATE Transactions SET Linked_Transaction_ID = ?, Valid = 0 WHERE Transaction_ID = ?`,
      [linkedId, row.Transaction_ID]
    );
    DB.recalcAccountBalance(row.Account_ID, row.Transaction_ID);
    inst.selectedRow = null;
    clearTrnForm(inst);
    instSetDirty(inst, false);
    refreshInstance(inst);
    App.onDataChanged(row.Account_ID);
  }

  // ── Action handlers ────────────────────────────────────────────────────────

  function handleAccept(data, inst) {
    DB.run('UPDATE Transactions SET Reviewed = 1 WHERE Transaction_ID = ?', [data.Transaction_ID]);
    refreshInstance(inst);
  }

  async function handleMerge(data, inst) {
    const ok = await Dialogs.confirm('Merge',
      'Mark this transaction as a duplicate?');
    if (!ok) return;
    DB.run('UPDATE Transactions SET Valid = 0 WHERE Transaction_ID = ?', [data.Transaction_ID]);
    DB.recalcAccountBalance(data.Account_ID, data.Transaction_ID);
    refreshInstance(inst);
    App.onDataChanged(data.Account_ID);
  }

  function handleUnmerge(data, inst) {
    DB.run(
      'UPDATE Transactions SET Linked_Transaction_ID = NULL WHERE Transaction_ID = ?',
      [data.Transaction_ID]
    );
    DB.recalcAccountBalance(data.Account_ID, data.Transaction_ID);
    refreshInstance(inst);
    App.onDataChanged(data.Account_ID);
  }

  // ── Delete key handler ─────────────────────────────────────────────────────

  async function handleDelete(inst) {
    if (!inst || !inst.selectedRow) return;
    const row = inst.selectedRow;

    // For Transfer transactions, look up the paired transaction in the other account
    let pairRow = null;
    if (row.Type === 'Transfer') {
      const full = DB.queryOne(
        'SELECT Transfer_Account_ID FROM Transactions WHERE Transaction_ID = ?',
        [row.Transaction_ID]
      );
      if (full && full.Transfer_Account_ID) {
        pairRow = DB.queryOne(
          `SELECT Transaction_ID, Account_ID FROM Transactions
           WHERE Account_ID = ? AND Transfer_Account_ID = ? AND Type = 'Transfer' AND Valid = 1`,
          [full.Transfer_Account_ID, row.Account_ID]
        );
      }
    }

    const msg = pairRow
      ? `This is a Transfer transaction. Invalidate both this transaction and its paired transaction in the other account?`
      : `Set transaction from ${row.Date} as invalid (remove from view)?`;

    const ok = await Dialogs.confirm('Delete Transaction', msg);
    if (!ok) return;

    const deletedPos = inst.table
      ? inst.table.getRows('active').findIndex(r => r.getData().Transaction_ID === row.Transaction_ID)
      : -1;

    DB.run('UPDATE Transactions SET Valid = 0 WHERE Transaction_ID = ?', [row.Transaction_ID]);
    DB.recalcAccountBalance(row.Account_ID, row.Transaction_ID);

    if (pairRow) {
      DB.run('UPDATE Transactions SET Valid = 0 WHERE Transaction_ID = ?', [pairRow.Transaction_ID]);
      DB.recalcAccountBalance(pairRow.Account_ID, pairRow.Transaction_ID);
      App.onDataChanged(pairRow.Account_ID);
    }

    inst.selectedRow = null;
    clearTrnForm(inst);
    instSetDirty(inst, false);
    refreshInstance(inst, () => {
      if (!inst.table) return;
      const newRows = inst.table.getRows('active');
      if (!newRows.length) return;
      const target = newRows[Math.min(Math.max(deletedPos, 0), newRows.length - 1)];
      inst.table.scrollToRow(target, 'center', false).catch(() => {});
      target.getElement().click();
    });
    App.onDataChanged(row.Account_ID);
  }

  // ── Instance refresh ───────────────────────────────────────────────────────

  function refreshInstance(inst, afterSetData) {
    let startBal = 0;
    if (inst.accountId && !inst.payeeId && !inst.catId) {
      const acc = DB.queryOne('SELECT Starting_Balance FROM Accounts WHERE Account_ID = ?', [inst.accountId]);
      startBal  = acc ? (acc.Starting_Balance || 0) : 0;
    }
    const raw      = buildTableData(inst.accountId, inst.payeeId, inst.catId, inst.dateFrom, inst.dateTo);
    const enriched = enrichRows(raw, startBal, true);
    if (inst.table) {
      const holder    = document.querySelector(`#trn-table-${inst.id} .tabulator-tableholder`);
      const scrollTop = holder ? holder.scrollTop : 0;
      inst.table.setData(enriched).then(() => {
        if (holder && scrollTop > 0) holder.scrollTop = scrollTop;
        if (afterSetData) afterSetData();
      });
    }
  }

  // ── Tab construction ───────────────────────────────────────────────────────

  function build(tabId, panel, accountId, payeeId, catId, dateFrom, dateTo) {
    panel.innerHTML = `
      <div class="tab-layout">
        <div id="trn-table-${tabId}" class="table-zone"></div>
        <div class="form-zone">
          <div class="trn-form form-body"></div>
        </div>
      </div>`;

    const inst = { id: tabId, table: null, accountId, payeeId, catId, dateFrom: dateFrom || null, dateTo: dateTo || null, selectedRow: null, formDirty: false, isNewMode: false };
    _instances[tabId] = inst;

    let startBal = 0;
    if (accountId && !payeeId && !catId) {
      const acc = DB.queryOne('SELECT Starting_Balance FROM Accounts WHERE Account_ID = ?', [accountId]);
      startBal  = acc ? (acc.Starting_Balance || 0) : 0;
    }
    const raw      = buildTableData(accountId, payeeId, catId, inst.dateFrom, inst.dateTo);
    const enriched = enrichRows(raw, startBal, true);

    const balCol = [{
      title: 'Balance', field: 'Balance', width: 110,
      formatter: currencyFormatter, hozAlign: 'right', headerSort: false
    }];

    const acctCol = (!accountId) ? [{
      title: 'Account', field: 'Account_Name', width: 140, headerFilter: 'input', headerSortTristate: true
    }] : [];

    const catCol = catId ? [{
      title: 'Category', field: 'Category_Name', width: 130, headerFilter: 'input', headerSortTristate: true
    }] : [];

    inst.table = new Tabulator(`#trn-table-${tabId}`, {
      data:       enriched,
      height:     '100%',
      layout:     'fitColumns',
      virtualDom: true,
      selectableRows: 1,
      headerSortTristate: true,
      rowFormatter,
      columns: [
        { title: 'Date',   field: 'Date',       width: 100, sorter: 'date',
          sorterParams: { format: 'YYYY-MM-DD' }, headerFilter: 'input', headerSortTristate: true },
        ...acctCol,
        { title: 'Payee',  field: 'Payee_Name', widthGrow: 2, headerFilter: 'input', headerSortTristate: true },
        ...catCol,
        { title: 'Debit',  field: 'Debit',  width: 100, formatter: currencyFormatter, hozAlign: 'right', headerSortTristate: true },
        { title: 'Credit', field: 'Credit', width: 100, formatter: currencyFormatter, hozAlign: 'right', headerSortTristate: true },
        ...balCol,
        { title: 'Action', field: '_actionLabel', width: 170, formatter: actionsFormatter,
          headerSortTristate: true,
          cellClick: (e, cell) => {
            const t = e.target;
            if (!t.classList.contains('act-btn')) return;
            const data = cell.getRow().getData();
            if (t.classList.contains('accept-btn'))  handleAccept(data, inst);
            if (t.classList.contains('merge-btn'))   handleMerge(data, inst);
            if (t.classList.contains('unmerge-btn')) handleUnmerge(data, inst);
          }
        }
      ]
    });

    inst.table.on('rowClick', (e, row) => {
      if (e.target.classList.contains('act-btn')) return;
      if (inst.formDirty) instSetDirty(inst, false);
      inst.selectedRow = row.getData();
      inst.isNewMode   = false;
      populateTrnForm(inst, inst.selectedRow);
      updateAcceptBtn(inst);
    });

    inst.table.on('tableBuilt', () => {
      const rows           = inst.table.getRows();
      const firstUnreviewed = rows.find(r => !r.getData().Reviewed);
      if (firstUnreviewed) {
        inst.table.scrollToRow(firstUnreviewed, 'top', false);
      } else if (rows.length > 0) {
        const holder = document.querySelector(`#trn-table-${tabId} .tabulator-tableholder`);
        if (holder) holder.scrollTop = holder.scrollHeight;
      }
    });

    buildForm(inst, panel);
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  function openForAccount(accountId) {
    const acct  = DB.queryOne('SELECT Name FROM Accounts WHERE Account_ID = ?', [accountId]);
    const label = acct ? acct.Name : `Account ${accountId}`;
    const tabId = `trn-acct-${accountId}`;
    App.Tabs.open(tabId, label, panel => build(tabId, panel, accountId, null, null), true);
  }

  function openForPayee(payeeId, payeeName) {
    const tabId = `trn-payee-${payeeId}`;
    App.Tabs.open(tabId, payeeName, panel => build(tabId, panel, null, payeeId, null), true);
  }

  function openForCategory(catId, catName) {
    const tabId = `trn-cat-${catId}`;
    App.Tabs.open(tabId, catName, panel => build(tabId, panel, null, null, catId), true);
  }

  function openForCategoryFiltered(catId, catName, dateFrom, dateTo, frameKey) {
    const suffix = frameKey || 'all';
    const tabId  = `trn-cat-${catId}-${suffix}`;
    App.Tabs.open(tabId, catName, panel => build(tabId, panel, null, null, catId, dateFrom, dateTo), true);
  }

  function openForPayeeFiltered(payeeId, payeeName, dateFrom, dateTo, frameKey) {
    const suffix = frameKey || 'all';
    const tabId  = `trn-payee-${payeeId}-${suffix}`;
    App.Tabs.open(tabId, payeeName, panel => build(tabId, panel, null, payeeId, null, dateFrom, dateTo), true);
  }

  function refresh(tabId) {
    if (_instances[tabId]) refreshInstance(_instances[tabId]);
  }

  function refreshAllForAccount(accountId) {
    const tabId = `trn-acct-${accountId}`;
    if (_instances[tabId]) refreshInstance(_instances[tabId]);
  }

  function handleDeleteKey(tabId) {
    handleDelete(_instances[tabId]);
  }

  function removeInstance(tabId) {
    delete _instances[tabId];
  }

  /** Returns {accountId, payeeId, catId} for a tab, or null if not found. */
  function getTabFilters(tabId) {
    const inst = _instances[tabId];
    return inst ? { accountId: inst.accountId, payeeId: inst.payeeId, catId: inst.catId } : null;
  }

  // ── Keyboard navigation (Up / Down / Enter) ──────────────────────────────────

  document.addEventListener('keydown', e => {
    if (!['ArrowUp', 'ArrowDown', 'Enter'].includes(e.key)) return;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;
    if (!document.getElementById('modal-backdrop').classList.contains('hidden')) return;

    const activeId = App.Tabs.getActiveId();
    if (!activeId || !activeId.startsWith('trn-')) return;

    const inst = _instances[activeId];
    if (!inst || !inst.table) return;

    const rows = inst.table.getRows();
    if (!rows.length) return;

    // Enter — execute Accept on the selected row if it is unreviewed
    if (e.key === 'Enter') {
      if (inst.selectedRow && inst.selectedRow.Reviewed === 0) {
        e.preventDefault();
        handleAccept(inst.selectedRow, inst);
      }
      return;
    }

    e.preventDefault();

    // Locate current selection index among visible rows
    const currentIdx = inst.selectedRow
      ? rows.findIndex(r => r.getData().Transaction_ID === inst.selectedRow.Transaction_ID)
      : -1;

    let nextIdx;
    if (e.key === 'ArrowUp') {
      nextIdx = currentIdx <= 0 ? 0 : currentIdx - 1;
    } else {
      nextIdx = currentIdx < 0 ? 0 : Math.min(currentIdx + 1, rows.length - 1);
    }

    if (nextIdx === currentIdx && currentIdx !== -1) return;

    const nextRow = rows[nextIdx];
    if (inst.formDirty) instSetDirty(inst, false);
    inst.table.deselectRow();
    nextRow.select();
    inst.selectedRow = nextRow.getData();
    inst.isNewMode   = false;
    populateTrnForm(inst, inst.selectedRow);
    updateAcceptBtn(inst);
    inst.table.scrollToRow(nextRow, 'nearest', false);
  });

  return {
    openForAccount, openForPayee, openForCategory, openForCategoryFiltered, openForPayeeFiltered,
    refresh, refreshAllForAccount, handleDeleteKey, removeInstance, getTabFilters
  };
})();
