/* Main application — init, menu wiring, tab management, file I/O */

const App = (() => {
  let _activeTabId    = null;
  let _lastFileHandle = null;        // FileSystemFileHandle from last open/save
  let _lastPrefix     = 'money';     // filename prefix for next save
  let _dataDirUrl     = null;        // file:// URL for DATA_DIR (from ?dataDir= param)

  function _extractPrefix(filename) {
    // Remove _YYYYMMDDHHMM.db suffix if present, then any remaining .db extension
    return filename.replace(/_\d{12}\.db$/i, '').replace(/\.db$/i, '') || 'transactions';
  }

  // ── Tab registry ────────────────────────────────────────────────────────────

  const Tabs = (() => {
    const _tabs = {};

    function open(id, label, buildFn, closeable) {
      if (_tabs[id]) { activate(id); return; }

      const btn = document.createElement('div');
      btn.className     = 'tab-btn';
      btn.dataset.tabId = id;
      btn.innerHTML     = `<span class="tab-label">${label}</span>`
        + (closeable ? `<span class="tab-close" data-tab-id="${id}">×</span>` : '');
      document.getElementById('tab-bar').appendChild(btn);

      const panel = document.createElement('div');
      panel.className = 'tab-panel';
      panel.id        = `panel-${id}`;
      document.getElementById('tab-content').appendChild(panel);

      buildFn(panel);
      _tabs[id] = { btn, panel, closeable, label };
      activate(id);
    }

    function activate(id) {
      if (!_tabs[id]) return;
      Object.values(_tabs).forEach(t => {
        t.btn.classList.remove('active');
        t.panel.classList.remove('active');
      });
      _tabs[id].btn.classList.add('active');
      _tabs[id].panel.classList.add('active');
      _activeTabId = id;
    }

    function close(id) {
      if (!_tabs[id]) return;
      _tabs[id].btn.remove();
      _tabs[id].panel.remove();
      if (id.startsWith('trn-')) TransactionsTab.removeInstance(id);
      if (id.startsWith('qry-')) QueryTab.removeInstance(id);
      delete _tabs[id];
      _activeTabId = null;
      const ids = Object.keys(_tabs);
      if (ids.length) activate(ids[ids.length - 1]);
    }

    function closeAll() {
      [...Object.keys(_tabs)].forEach(id => {
        _tabs[id].btn.remove();
        _tabs[id].panel.remove();
        if (id.startsWith('trn-')) TransactionsTab.removeInstance(id);
        if (id.startsWith('qry-')) QueryTab.removeInstance(id);
        delete _tabs[id];
      });
      _activeTabId = null;
    }

    function getActiveId() { return _activeTabId; }
    function exists(id)    { return !!_tabs[id]; }

    return { open, activate, close, closeAll, getActiveId, exists };
  })();

  // ── Cross-component event notifications ─────────────────────────────────────

  function onDataChanged(accountId) {
    AccountsTab.refresh();
    if (accountId) TransactionsTab.refreshAllForAccount(accountId);
    PayeesTab.refresh();
    CategoriesTab.refresh();
  }

  function onPayeesChanged() {
    PayeesTab.refresh();
    AliasesTab.refresh();
  }

  // ── Tab reset (used when loading a new database) ─────────────────────────────

  function resetTabs() {
    Tabs.closeAll();
    AccountsTab.open();
  }

  // ── Status bar ────────────────────────────────────────────────────────────────

  function setStatus(text) {
    document.getElementById('db-status').textContent = text;
  }

  // ── Timestamp suffix for save filenames ───────────────────────────────────────

  function timestampSuffix() {
    const d   = new Date();
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}`;
  }

  // ── IndexedDB handle persistence ────────────────────────────────────────────

  function _openHandleDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('MoneyApp', 1);
      req.onupgradeneeded = e => e.target.result.createObjectStore('handles');
      req.onsuccess = e => resolve(e.target.result);
      req.onerror   = () => reject(req.error);
    });
  }

  async function _saveHandleToIDB(handle) {
    try {
      const db = await _openHandleDB();
      const tx = db.transaction('handles', 'readwrite');
      tx.objectStore('handles').put(handle, 'dbFile');
      db.close();
    } catch { /* best-effort */ }
  }

  async function _loadHandleFromIDB() {
    try {
      const db = await _openHandleDB();
      const result = await new Promise(resolve => {
        const tx  = db.transaction('handles', 'readonly');
        const req = tx.objectStore('handles').get('dbFile');
        req.onsuccess = () => resolve(req.result || null);
        req.onerror   = () => resolve(null);
      });
      db.close();
      return result;
    } catch { return null; }
  }

  // ── Commands ────────────────────────────────────────────────────────────────

  async function cmdNew() {
    if (DB.isOpen()) {
      const ok = await Dialogs.confirm('New Database',
        'Create a new empty database? Any unsaved changes will be lost.');
      if (!ok) return;
    }
    DB.createNew();
    setStatus('New database (unsaved)');
    resetTabs();
  }

  async function cmdOpen() {
    let fh;
    try {
      const opts = {
        id:    'money-db',
        types: [{ description: 'SQLite Database', accept: { 'application/octet-stream': ['.db'] } }]
      };
      if (_lastFileHandle) opts.startIn = _lastFileHandle;
      [fh] = await window.showOpenFilePicker(opts);
    } catch { return; } // user cancelled

    const file = await fh.getFile();
    const buf  = await file.arrayBuffer();
    DB.loadFromBytes(new Uint8Array(buf));
    _lastFileHandle = fh;
    _lastPrefix     = _extractPrefix(file.name);
    _saveHandleToIDB(fh);
    setStatus(file.name);
    resetTabs();
  }

  async function cmdSave() {
    if (!DB.isOpen()) { await Dialogs.alert('Save', 'No database is open.'); return; }

    const prefix = await Dialogs.prompt('Save Database',
      'Enter a file name prefix (e.g. "money"):', _lastPrefix);
    if (!prefix) return;

    const saveOpts = {
      id:            'money-db',
      suggestedName: `${prefix}_${timestampSuffix()}.db`,
      types: [{ description: 'SQLite Database', accept: { 'application/octet-stream': ['.db'] } }]
    };
    if (_lastFileHandle) saveOpts.startIn = _lastFileHandle;

    let fh;
    try {
      fh = await window.showSaveFilePicker(saveOpts);
    } catch { return; } // user cancelled

    const wr = await fh.createWritable();
    await wr.write(DB.exportBytes());
    await wr.close();
    _lastFileHandle = fh;
    _lastPrefix     = prefix;
    _saveHandleToIDB(fh);
    setStatus(fh.name);
    await Dialogs.alert('Saved', `Database saved as "${fh.name}".`);
  }

  async function cmdImport() {
    if (!DB.isOpen()) { await Dialogs.alert('Import', 'Please open or create a database first.'); return; }
    await Import.run();
  }

  async function cmdApplyPattern() {
    if (!DB.isOpen()) { await Dialogs.alert('Apply Pattern', 'No database is open.'); return; }

    const activeId = Tabs.getActiveId();
    if (!activeId || !activeId.startsWith('trn-')) {
      await Dialogs.alert('Apply Pattern', 'Please switch to a Transactions tab first.');
      return;
    }

    const patterns = DB.query(`
      SELECT pp.Pattern_ID, pp.Pattern, pp.Payee_ID, p.Name AS Payee_Name
      FROM Patterns pp
      JOIN Payees p ON pp.Payee_ID = p.Payee_ID
      WHERE pp.Active = 1 AND p.Active = 1
      ORDER BY pp.Pattern`);
    if (!patterns.length) {
      await Dialogs.alert('Apply Pattern', 'No patterns defined. Create patterns in the Patterns tab first.');
      return;
    }

    const chosen = await Dialogs.selectPattern(patterns);
    if (!chosen) return;

    let regex;
    try { regex = new RegExp(chosen.Pattern, 'i'); }
    catch {
      await Dialogs.alert('Apply Pattern', `"${chosen.Pattern}" is not a valid regular expression.`);
      return;
    }

    // Find the most recently reviewed transaction for the pattern's payee to copy its category
    const lastReviewed = DB.queryOne(`
      SELECT Category_ID FROM Transactions
      WHERE Payee_ID = ? AND Valid = 1 AND Reviewed = 1
      ORDER BY Date DESC, Transaction_ID DESC LIMIT 1`,
      [chosen.Payee_ID]);
    const categoryId = lastReviewed ? lastReviewed.Category_ID : null;

    // Query unreviewed transactions visible in the active tab
    const filters = TransactionsTab.getTabFilters(activeId);
    let sql = `
      SELECT t.Transaction_ID, t.Memo
      FROM Transactions t
      WHERE t.Valid = 1 AND t.Reviewed = 0`;
    const params = [];
    if (filters.accountId) { sql += ' AND t.Account_ID = ?';   params.push(filters.accountId); }
    if (filters.payeeId)   { sql += ' AND t.Payee_ID = ?';     params.push(filters.payeeId); }
    if (filters.catId)     { sql += ' AND t.Category_ID = ?';  params.push(filters.catId); }

    const rows = DB.query(sql, params);
    let count = 0;
    for (const row of rows) {
      const text = row.Memo || '';
      if (regex.test(text)) {
        if (categoryId) {
          DB.run('UPDATE Transactions SET Payee_ID = ?, Category_ID = ? WHERE Transaction_ID = ?',
            [chosen.Payee_ID, categoryId, row.Transaction_ID]);
        } else {
          DB.run('UPDATE Transactions SET Payee_ID = ? WHERE Transaction_ID = ?',
            [chosen.Payee_ID, row.Transaction_ID]);
        }
        count++;
      }
    }

    TransactionsTab.refresh(activeId);
    await Dialogs.alert('Apply Pattern',
      count > 0
        ? `Pattern matched ${count} transaction${count === 1 ? '' : 's'}. Payee updated to "${chosen.Payee_Name}".`
        : 'No unreviewed transactions matched the selected pattern.');
  }

  async function cmdRemoveDuplicates() {
    if (!DB.isOpen()) { await Dialogs.alert('Remove Duplicates', 'No database is open.'); return; }

    const accounts = DB.query('SELECT Account_ID, Name, Type FROM Accounts WHERE Active = 1');
    if (!accounts.length) {
      await Dialogs.alert('Remove Duplicates', 'No accounts found.');
      return;
    }

    const accountId = await Dialogs.selectAccount('Remove Duplicates', accounts,
      'Select the account to check for duplicates:');
    if (accountId == null) return;

    // Unreviewed, valid transactions with a Reference_ID for this account
    const candidates = DB.query(
      `SELECT Transaction_ID, Reference_ID FROM Transactions
       WHERE Account_ID = ? AND Valid = 1 AND Reviewed = 0 AND Reference_ID IS NOT NULL`,
      [accountId]
    );

    if (!candidates.length) {
      await Dialogs.alert('Remove Duplicates',
        'No unreviewed transactions with a Reference ID were found for this account.');
      return;
    }

    let removed = 0;
    for (const t of candidates) {
      const match = DB.queryOne(
        `SELECT Transaction_ID FROM Transactions
         WHERE Account_ID = ? AND Reference_ID = ? AND Reviewed = 1 AND Valid = 1
         LIMIT 1`,
        [accountId, t.Reference_ID]
      );
      if (match) {
        // Clear FK references before hard-deleting
        DB.run('UPDATE Transactions SET Linked_Transaction_ID = NULL WHERE Linked_Transaction_ID = ?',
          [t.Transaction_ID]);
        DB.run('DELETE FROM Transactions WHERE Transaction_ID = ?', [t.Transaction_ID]);
        removed++;
      }
    }

    if (removed > 0) {
      DB.recalcAccountBalance(accountId, null);
      onDataChanged(accountId);
    }

    await Dialogs.alert('Remove Duplicates',
      removed > 0
        ? `${removed} duplicate transaction${removed === 1 ? '' : 's'} removed.`
        : 'No duplicates found for this account.');
  }

  async function cmdAssignCategory() {
    if (!DB.isOpen()) { await Dialogs.alert('Assign Category', 'No database is open.'); return; }

    const activeId = Tabs.getActiveId();
    if (!activeId || !activeId.startsWith('trn-')) {
      await Dialogs.alert('Assign Category', 'Please switch to a Transactions tab first.');
      return;
    }

    const payees = DB.query(
      'SELECT Payee_ID, Name FROM Payees WHERE Active = 1 ORDER BY Name');
    if (!payees.length) {
      await Dialogs.alert('Assign Category', 'No payees found.');
      return;
    }

    const categories = DB.query(
      'SELECT Category_ID, Name, Type FROM Categories WHERE Active = 1 ORDER BY Name');
    if (!categories.length) {
      await Dialogs.alert('Assign Category', 'No categories found.');
      return;
    }

    const chosen = await Dialogs.selectPayeeAndCategory(payees, categories);
    if (!chosen) return;

    // Build query matching what the active tab displays, filtered to chosen payee
    const filters = TransactionsTab.getTabFilters(activeId);
    let sql = `
      SELECT Transaction_ID FROM Transactions
      WHERE Valid = 1 AND Payee_ID = ?`;
    const params = [chosen.payeeId];
    if (filters.accountId) { sql += ' AND Account_ID = ?';   params.push(filters.accountId); }
    if (filters.catId)     { sql += ' AND Category_ID = ?';  params.push(filters.catId); }

    const rows = DB.query(sql, params);
    if (!rows.length) {
      await Dialogs.alert('Assign Category', 'No transactions found for the selected payee in this tab.');
      return;
    }

    for (const row of rows) {
      DB.run('UPDATE Transactions SET Category_ID = ? WHERE Transaction_ID = ?',
        [chosen.categoryId, row.Transaction_ID]);
    }

    TransactionsTab.refresh(activeId);
    const count = rows.length;
    await Dialogs.alert('Assign Category',
      `Category updated on ${count} transaction${count === 1 ? '' : 's'}.`);
  }

  async function cmdMemoToPayee() {
    if (!DB.isOpen()) { await Dialogs.alert('Memo to Payee', 'No database is open.'); return; }

    const accounts = DB.query('SELECT Account_ID, Name, Type FROM Accounts WHERE Active = 1');
    if (!accounts.length) {
      await Dialogs.alert('Memo to Payee', 'No accounts found.');
      return;
    }

    const accountId = await Dialogs.selectAccount('Memo to Payee', accounts,
      'Select the account to process:');
    if (accountId == null) return;

    // Valid transactions with no payee and a non-empty memo
    const rows = DB.query(
      `SELECT Transaction_ID, Memo, Category_ID FROM Transactions
       WHERE Account_ID = ? AND Valid = 1 AND Payee_ID IS NULL
         AND Memo IS NOT NULL AND Memo != ''`,
      [accountId]
    );

    if (!rows.length) {
      await Dialogs.alert('Memo to Payee',
        'No payee-less transactions with a memo were found for this account.');
      return;
    }

    let count = 0;
    for (const t of rows) {
      const name = t.Memo.trim();
      if (!name) continue;

      // Resolve payee using the same 3-step import logic
      let payeeId = DB.lookupPayee(name);
      if (!payeeId) payeeId = DB.createPayee(name, false); // no alias on import

      const catId = DB.getLastCategory(payeeId) || 1;

      DB.run(
        'UPDATE Transactions SET Payee_ID = ?, Category_ID = ? WHERE Transaction_ID = ?',
        [payeeId, catId, t.Transaction_ID]
      );
      count++;
    }

    if (count > 0) onDataChanged(accountId);

    await Dialogs.alert('Memo to Payee',
      count > 0
        ? `${count} transaction${count === 1 ? '' : 's'} updated.`
        : 'No transactions were updated.');
  }

  async function cmdMergePayees() {
    if (!DB.isOpen()) { await Dialogs.alert('Merge Payees', 'No database is open.'); return; }

    const payees = DB.query('SELECT Payee_ID, Name FROM Payees WHERE Active = 1 ORDER BY Name');
    if (payees.length < 2) {
      await Dialogs.alert('Merge Payees', 'At least two active payees are required to merge.');
      return;
    }

    const chosen = await Dialogs.selectMergePayees(payees);
    if (!chosen) return;

    const fromName = payees.find(p => p.Payee_ID === chosen.fromId)?.Name || chosen.fromId;
    const toName   = payees.find(p => p.Payee_ID === chosen.toId)?.Name   || chosen.toId;

    const ok = await Dialogs.confirm('Merge Payees',
      `Reassign all transactions from "${fromName}" to "${toName}"?`);
    if (!ok) return;

    const rows = DB.query(
      'SELECT Transaction_ID FROM Transactions WHERE Payee_ID = ? AND Valid = 1',
      [chosen.fromId]
    );
    for (const r of rows) {
      DB.run('UPDATE Transactions SET Payee_ID = ? WHERE Transaction_ID = ?',
        [chosen.toId, r.Transaction_ID]);
    }

    onPayeesChanged();
    onDataChanged(null);

    await Dialogs.alert('Merge Payees',
      rows.length > 0
        ? `${rows.length} transaction${rows.length === 1 ? '' : 's'} reassigned from "${fromName}" to "${toName}".`
        : `No transactions found for "${fromName}". No changes made.`);
  }

  // ── Keyboard ────────────────────────────────────────────────────────────────

  document.addEventListener('keydown', e => {
    if (e.key !== 'Delete') return;
    if (['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)) return;
    const active = Tabs.getActiveId();
    if (!active) return;
    if (active === AccountsTab.TAB_ID)    AccountsTab.handleDelete();
    else if (active === PayeesTab.TAB_ID)     PayeesTab.handleDelete();
    else if (active === AliasesTab.TAB_ID)    AliasesTab.handleDelete();
    else if (active === PatternsTab.TAB_ID)   PatternsTab.handleDelete();
    else if (active === CategoriesTab.TAB_ID) CategoriesTab.handleDelete();
    else if (active.startsWith('trn-'))       TransactionsTab.handleDeleteKey(active);
  });

  // ── Menu wiring ─────────────────────────────────────────────────────────────

  function wireMenu() {
    document.querySelectorAll('.menu-item').forEach(item => {
      item.addEventListener('click', e => {
        const wasOpen = item.classList.contains('open');
        closeAllMenus();
        if (!wasOpen) item.classList.add('open');
        e.stopPropagation();
      });
    });
    document.addEventListener('click', closeAllMenus);

    const bind = (id, fn) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('click', e => { e.stopPropagation(); closeAllMenus(); fn(); });
    };

    bind('cmd-new',             cmdNew);
    bind('cmd-open',            cmdOpen);
    bind('cmd-save',            cmdSave);
    bind('cmd-import',          cmdImport);
    bind('cmd-apply-pattern',      cmdApplyPattern);
    bind('cmd-remove-duplicates',  cmdRemoveDuplicates);
    bind('cmd-assign-category',    cmdAssignCategory);
    bind('cmd-memo-to-payee',      cmdMemoToPayee);
    bind('cmd-merge-payees',       cmdMergePayees);
    bind('cmd-query-db',           () => QueryTab.open());
    bind('cmd-view-accounts',   () => AccountsTab.open());
    bind('cmd-view-payees',     () => PayeesTab.open());
    bind('cmd-view-aliases',    () => AliasesTab.open());
    bind('cmd-view-patterns',   () => PatternsTab.open());
    bind('cmd-view-categories', () => CategoriesTab.open());
    bind('cmd-report-category', () => SpendByCategoryReport.open());
    bind('cmd-report-payee',    () => SpendByPayeeReport.open());
  }

  function closeAllMenus() {
    document.querySelectorAll('.menu-item.open').forEach(m => m.classList.remove('open'));
  }

  // ── Tab refresh ──────────────────────────────────────────────────────────────

  function cmdRefreshTab() {
    const active = Tabs.getActiveId();
    if (!active) return;
    if      (active === AccountsTab.TAB_ID)    AccountsTab.refresh();
    else if (active === PayeesTab.TAB_ID)      PayeesTab.refresh();
    else if (active === AliasesTab.TAB_ID)     AliasesTab.refresh();
    else if (active === PatternsTab.TAB_ID)    PatternsTab.refresh();
    else if (active === CategoriesTab.TAB_ID)  CategoriesTab.refresh();
    else if (active.startsWith('trn-'))        TransactionsTab.refresh(active);
    // qry- tabs: no auto-refresh (user controls execution)
  }

  // ── Tab bar click delegation ─────────────────────────────────────────────────

  function wireTabBar() {
    document.getElementById('tab-strip').addEventListener('click', e => {
      if (e.target.closest('#tab-refresh')) { cmdRefreshTab(); return; }
      const closeBtn = e.target.closest('.tab-close');
      if (closeBtn) { Tabs.close(closeBtn.dataset.tabId); return; }
      const tabBtn = e.target.closest('.tab-btn');
      if (tabBtn)   { Tabs.activate(tabBtn.dataset.tabId); }
    });
  }

  // ── Bootstrap ────────────────────────────────────────────────────────────────

  async function init() {
    await DB.init();
    _lastFileHandle = await _loadHandleFromIDB();
    wireMenu();
    wireTabBar();

    // Read URL parameters passed by launch.bat
    const params  = new URLSearchParams(window.location.search);
    const dbFile  = params.get('db');
    const dataDirParam = params.get('dataDir'); // forward-slash path from launch.bat

    // Build the data directory file:// URL (used for the initial DB fetch)
    if (dataDirParam) {
      _dataDirUrl = `file:///${dataDirParam}`.replace(/\/+$/, ''); // strip trailing slash
    } else {
      const pageUrl = window.location.href.split('?')[0];
      const baseDir = pageUrl.substring(0, pageUrl.lastIndexOf('/') + 1);
      _dataDirUrl = `${baseDir}data`;
    }

    if (dbFile) {
      const dbUrl = `${_dataDirUrl}/${dbFile}`;
      try {
        const resp = await fetch(dbUrl);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const buf  = await resp.arrayBuffer();
        DB.loadFromBytes(new Uint8Array(buf));
        _lastPrefix = _extractPrefix(dbFile);
        setStatus(dbFile);
      } catch (e) {
        console.warn('Could not load DB from URL param, starting fresh:', e);
        DB.createNew();
        setStatus('New database (unsaved)');
      }

    } else {
      DB.createNew();
      setStatus('New database (unsaved)');
    }

    AccountsTab.open();
  }

  document.addEventListener('DOMContentLoaded', init);

  // Warn before closing if a database is open (browser shows its own native dialog)
  window.addEventListener('beforeunload', e => {
    if (DB.isOpen()) {
      e.preventDefault();
      e.returnValue = '';   // required for Chromium to show the dialog
    }
  });

  return { Tabs, onDataChanged, onPayeesChanged };
})();
