/* Database layer — wraps sql.js */

const DB = (() => {
  let _db  = null;
  let _SQL = null;

  // ── Initialisation ────────────────────────────────────────────────────────

  async function init() {
    _SQL = await initSqlJs({ locateFile: f => `lib/${f}` });
  }

  function createNew() {
    _db = new _SQL.Database();
    _db.run('PRAGMA foreign_keys = ON;');
    _db.run(SCHEMA_SQL);
    _db.run(SEED_SQL);
  }

  function loadFromBytes(bytes) {
    _db = new _SQL.Database(bytes);
    _db.run('PRAGMA foreign_keys = ON;');
    // Migrate: ensure Mappings table and all columns exist in older databases
    _db.run(`CREATE TABLE IF NOT EXISTS Mappings (
      Mapping_ID INTEGER PRIMARY KEY AUTOINCREMENT,
      Source     TEXT    NOT NULL UNIQUE,
      Target     TEXT    NOT NULL,
      Pattern    TEXT,
      Negate     INTEGER DEFAULT 0
    )`);
    try { _db.run('ALTER TABLE Mappings ADD COLUMN Negate INTEGER DEFAULT 0'); } catch {} // no-op if already present
    try { _db.run("ALTER TABLE Categories ADD COLUMN Type TEXT DEFAULT 'Expense'"); } catch {}
    try { _db.run('ALTER TABLE Categories ADD COLUMN Notes TEXT'); } catch {}
  }

  function exportBytes() {
    return _db.export();
  }

  function isOpen() { return _db !== null; }

  // ── Core query helpers ────────────────────────────────────────────────────

  function run(sql, params) {
    _db.run(sql, params || []);
  }

  function query(sql, params) {
    const stmt = _db.prepare(sql);
    if (params && params.length) stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
  }

  function queryOne(sql, params) {
    const rows = query(sql, params);
    return rows.length ? rows[0] : null;
  }

  // ── Payee helpers ─────────────────────────────────────────────────────────

  /**
   * Resolves a payee name to a Payee_ID using three steps in order:
   * 1. Exact match on Payee.Name
   * 2. Exact match on Aliases.Alias
   * 3. Regex match against Patterns.Pattern (JS-side, first match by Pattern_ID wins)
   * Returns null if nothing matches.
   */
  function lookupPayee(name) {
    if (!name) return null;
    const n = name.trim();

    // 1. Exact match on Payee.Name
    let r = queryOne('SELECT Payee_ID FROM Payees WHERE Name = ? AND Active = 1 LIMIT 1', [n]);
    if (r) return r.Payee_ID;

    // 2. Exact match on Aliases.Alias
    r = queryOne('SELECT Payee_ID FROM Aliases WHERE Alias = ? AND Active = 1 LIMIT 1', [n]);
    if (r) return r.Payee_ID;

    // 3. Regex match against Patterns (evaluated in JS; first Pattern_ID match wins)
    const patterns = query(
      `SELECT pp.Pattern_ID, pp.Pattern, pp.Payee_ID
       FROM Patterns pp
       JOIN Payees p ON pp.Payee_ID = p.Payee_ID
       WHERE pp.Active = 1 AND p.Active = 1
       ORDER BY pp.Pattern_ID`
    );
    for (const p of patterns) {
      try {
        if (new RegExp(p.Pattern, 'i').test(n)) return p.Payee_ID;
      } catch { /* skip malformed regex */ }
    }

    return null;
  }

  /** Returns the Category_ID most recently used for this payee, or 1 (Unassigned). */
  function getLastCategory(payeeId) {
    const r = queryOne(
      `SELECT Category_ID FROM Transactions
       WHERE Payee_ID = ? AND Category_ID IS NOT NULL
       ORDER BY Transaction_ID DESC LIMIT 1`,
      [payeeId]
    );
    return r ? r.Category_ID : 1;
  }

  /**
   * Creates a new Payee record. Also creates an initial Aliases unless
   * withAlias is false (the import path skips alias creation per spec).
   * Returns the new Payee_ID.
   */
  function createPayee(name, withAlias = true) {
    const n = name.trim();
    run('INSERT INTO Payees (Name, Active) VALUES (?, 1)', [n]);
    const row = queryOne("SELECT last_insert_rowid() AS id");
    const id  = row.id;
    if (withAlias) {
      run('INSERT INTO Aliases (Payee_ID, Alias, Active) VALUES (?, ?, 1)', [id, n]);
    }
    return id;
  }

  // ── Account balance ───────────────────────────────────────────────────────

  /**
   * Recalculates and persists Account.Balance for the given account.
   *
   * When fromTransactionId is supplied (a deleted or unmerged Transaction_ID),
   * the function finds the immediately preceding valid non-linked transaction
   * (by Transaction_ID) and uses its cumulative sum as the starting point,
   * then sums forward from there — avoiding a full-table scan from scratch.
   *
   * Falls back to a full recompute when no predecessor exists.
   */
  function recalcAccountBalance(accountId, fromTransactionId) {
    const acc = queryOne('SELECT Starting_Balance FROM Accounts WHERE Account_ID = ?', [accountId]);
    if (!acc) return;
    const sb = acc.Starting_Balance || 0;

    let newBalance;

    if (fromTransactionId != null) {
      const pred = queryOne(
        `SELECT Transaction_ID FROM Transactions
         WHERE Account_ID = ? AND Valid = 1 AND Linked_Transaction_ID IS NULL
           AND Transaction_ID < ?
         ORDER BY Transaction_ID DESC LIMIT 1`,
        [accountId, fromTransactionId]
      );

      if (pred) {
        const s1 = queryOne(
          `SELECT COALESCE(SUM(Amount),0) AS s FROM Transactions
           WHERE Account_ID = ? AND Valid = 1 AND Linked_Transaction_ID IS NULL
             AND Transaction_ID <= ?`,
          [accountId, pred.Transaction_ID]
        );
        const balAtPred = sb + s1.s;

        const s2 = queryOne(
          `SELECT COALESCE(SUM(Amount),0) AS s FROM Transactions
           WHERE Account_ID = ? AND Valid = 1 AND Linked_Transaction_ID IS NULL
             AND Transaction_ID > ?`,
          [accountId, pred.Transaction_ID]
        );
        newBalance = balAtPred + s2.s;
      } else {
        // No predecessor — sum everything (e.g. first transaction was deleted)
        const tot = queryOne(
          `SELECT COALESCE(SUM(Amount),0) AS s FROM Transactions
           WHERE Account_ID = ? AND Valid = 1 AND Linked_Transaction_ID IS NULL`,
          [accountId]
        );
        newBalance = sb + tot.s;
      }
    } else {
      // Full recompute (called after import or general updates)
      const tot = queryOne(
        `SELECT COALESCE(SUM(Amount),0) AS s FROM Transactions
         WHERE Account_ID = ? AND Valid = 1 AND Linked_Transaction_ID IS NULL`,
        [accountId]
      );
      newBalance = sb + tot.s;
    }

    run(
      `UPDATE Accounts SET Balance = ?, Last_Updated = ? WHERE Account_ID = ?`,
      [newBalance, new Date().toISOString().slice(0, 16).replace('T', ' '), accountId]
    );
    return newBalance;
  }

  // ── Referential constraint check ──────────────────────────────────────────

  /**
   * Checks whether a record in `table` (identified by `pkField`=`pkValue`)
   * is referenced by any other table.  Returns an array of description strings
   * for each blocking reference, empty if safe to delete.
   */
  function checkRefs(table, pkValue) {
    const refs = [];
    if (table === 'Account') {
      const n = queryOne(
        'SELECT COUNT(*) AS c FROM Transactions WHERE Account_ID = ? AND Valid = 1', [pkValue]);
      if (n.c > 0) refs.push(`${n.c} transaction(s) in Transactions`);
    }
    if (table === 'Payee') {
      const n = queryOne(
        'SELECT COUNT(*) AS c FROM Transactions WHERE Payee_ID = ? AND Valid = 1', [pkValue]);
      if (n.c > 0) refs.push(`${n.c} transaction(s) in Transactions`);
      const a = queryOne(
        'SELECT COUNT(*) AS c FROM Aliases WHERE Payee_ID = ? AND Active = 1', [pkValue]);
      if (a.c > 0) refs.push(`${a.c} alias(es) in Aliases`);
      const pt = queryOne(
        'SELECT COUNT(*) AS c FROM Patterns WHERE Payee_ID = ? AND Active = 1', [pkValue]);
      if (pt.c > 0) refs.push(`${pt.c} pattern(s) in Patterns`);
    }
    if (table === 'Category') {
      const n = queryOne(
        'SELECT COUNT(*) AS c FROM Transactions WHERE Category_ID = ? AND Valid = 1', [pkValue]);
      if (n.c > 0) refs.push(`${n.c} transaction(s) in Transactions`);
    }
    return refs;
  }

  return {
    init, createNew, loadFromBytes, exportBytes, isOpen,
    run, query, queryOne,
    lookupPayee, getLastCategory, createPayee,
    recalcAccountBalance, checkRefs
  };
})();
