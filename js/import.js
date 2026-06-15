/* Import logic: CSV, OFX/QFX (SGML + XML), QIF */

const Import = (() => {
  let _lastImportHandle = null; // FileSystemFileHandle from last import — used as startIn for next import

  // ── Date normalisation ────────────────────────────────────────────────────

  /** Normalises various date formats to YYYY-MM-DD. */
  function normaliseDate(s) {
    if (!s) return '';
    s = s.trim();
    // YYYYMMDDHHMMSS  or  YYYYMMDD[xxxx]
    const m1 = s.match(/^(\d{4})(\d{2})(\d{2})/);
    if (m1) return `${m1[1]}-${m1[2]}-${m1[3]}`;
    // MM/DD/YYYY
    const m2 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m2) return `${m2[3]}-${m2[1].padStart(2,'0')}-${m2[2].padStart(2,'0')}`;
    // MM/DD/YY
    const m3 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
    if (m3) {
      const yr = parseInt(m3[3], 10);
      const full = yr >= 50 ? `19${m3[3]}` : `20${m3[3].padStart(2,'0')}`;
      return `${full}-${m3[1].padStart(2,'0')}-${m3[2].padStart(2,'0')}`;
    }
    return s;
  }

  // ── CSV parser ────────────────────────────────────────────────────────────

  function parseCSVLine(line) {
    const result = [];
    let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQ && line[i+1] === '"') { cur += '"'; i++; }
        else inQ = !inQ;
      } else if (ch === ',' && !inQ) {
        result.push(cur.trim()); cur = '';
      } else {
        cur += ch;
      }
    }
    result.push(cur.trim());
    return result;
  }

  /** Parse CSV text into array of objects keyed by header row. */
  function parseCSV(text) {
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l);
    if (lines.length < 2) return [];
    const headers = parseCSVLine(lines[0]);
    return lines.slice(1).map(line => {
      const vals = parseCSVLine(line);
      const obj  = {};
      headers.forEach((h, i) => { obj[h] = (vals[i] || '').trim(); });
      return obj;
    });
  }

  /**
   * Map parsed CSV rows to transaction objects using user-defined field mappings.
   * mappings = array of {Source, Target, Pattern} where
   *   Source = transaction field key (Date, Amount, Reference_ID, Memo, Payee)
   *   Target = CSV column name in the row objects
   *   Pattern = optional regex; first capture group is extracted (or full match if no group)
   */
  function csvToTransactionsWithMappings(rows, mappings) {
    // Build lookup keyed by field name; ignore entries with no Target column selected
    const lookup = {};
    mappings.forEach(m => { if (m.Target) lookup[m.Source] = m; });

    const get = (fieldKey, row) => {
      const m = lookup[fieldKey];
      if (!m) return '';
      let val = (row[m.Target] || '').trim();
      if (m.Pattern) {
        try {
          const match = val.match(new RegExp(m.Pattern));
          val = match ? (match[1] !== undefined ? match[1] : match[0]) : '';
        } catch { val = ''; }
      }
      return val;
    };

    return rows.map(r => {
      const dateStr = get('Date', r);
      const amtStr  = get('Amount', r).replace(/,/g, '');
      const amtRaw  = parseFloat(amtStr || '0');
      const amtMap  = lookup['Amount'];
      const amt     = (isNaN(amtRaw) ? 0 : amtRaw) * (amtMap && amtMap.Negate ? -1 : 1);

      return {
        Reference_ID: get('Reference_ID', r) || null,
        Date:         normaliseDate(dateStr),
        Memo:         get('Memo', r) || null,
        PayeeName:    get('Payee', r) || '',
        Amount:       amt,
        Type:         amt >= 0 ? 'Credit' : 'Debit',
        Currency:     'USD'
      };
    }).filter(t => t.Date);
  }

  // ── OFX / QFX parser (handles both SGML 1.x and XML 2.x) ─────────────────

  function isOFXSGML(text) {
    return /^OFXHEADER:/mi.test(text) || (!/^<\?xml/i.test(text) && /<OFX>/i.test(text));
  }

  /** Extract a single scalar value from SGML OFX text. */
  function sgmlVal(text, tag) {
    const re = new RegExp(`<${tag}>([^\\r\\n<]*)`, 'i');
    const m  = text.match(re);
    return m ? m[1].trim() : null;
  }

  /** Parse OFX 1.x SGML. Returns { transactions, acctId, org, acctType, curDef }. */
  function parseOFXSGML(text) {
    const acctId  = sgmlVal(text, 'ACCTID');
    const org     = sgmlVal(text, 'ORG');
    const curDef  = sgmlVal(text, 'CURDEF') || 'USD';
    const acctType = /<CCACCTFROM>/i.test(text) ? 'Credit card'
                   : /<BANKACCTFROM>/i.test(text) ? 'Bank'
                   : 'Other';

    const transactions = [];
    // Split on <STMTTRN> blocks
    const blocks = text.split(/<STMTTRN>/i).slice(1);
    for (const block of blocks) {
      const end  = block.indexOf('</STMTTRN>');
      const body = end >= 0 ? block.slice(0, end) : block;
      const get  = tag => {
        const re = new RegExp(`<${tag}>([^\\r\\n<]*)`, 'i');
        const m  = body.match(re); return m ? m[1].trim() : null;
      };
      const amt = parseFloat(get('TRNAMT') || '0');
      transactions.push({
        Reference_ID: get('FITID'),
        Date:         normaliseDate(get('DTPOSTED')),
        Memo:         get('MEMO') || get('NAME') || '',
        PayeeName:    get('NAME') || '',
        Amount:       amt,
        Type:         amt >= 0 ? 'Credit' : 'Debit',
        Currency:     get('CURRENCY') || curDef
      });
    }
    return { transactions, acctId, org, acctType, curDef };
  }

  /** Parse OFX 2.x XML. Returns { transactions, acctId, org, acctType, curDef }. */
  function parseOFXXML(text) {
    const parser = new DOMParser();
    const doc    = parser.parseFromString(text, 'text/xml');
    const gv     = tag => {
      const el = doc.querySelector(tag); return el ? el.textContent.trim() : null;
    };
    const acctId   = gv('ACCTID');
    const org      = gv('ORG');
    const curDef   = gv('CURDEF') || 'USD';
    const acctType = doc.querySelector('CCACCTFROM')   ? 'Credit card'
                   : doc.querySelector('BANKACCTFROM') ? 'Bank'
                   : 'Other';

    const transactions = [];
    doc.querySelectorAll('STMTTRN').forEach(el => {
      const g  = tag => { const e = el.querySelector(tag); return e ? e.textContent.trim() : null; };
      const amt = parseFloat(g('TRNAMT') || '0');
      transactions.push({
        Reference_ID: g('FITID'),
        Date:         normaliseDate(g('DTPOSTED')),
        Memo:         g('MEMO') || g('NAME') || '',
        PayeeName:    g('NAME') || '',
        Amount:       amt,
        Type:         amt >= 0 ? 'Credit' : 'Debit',
        Currency:     g('CURRENCY') || curDef
      });
    });
    return { transactions, acctId, org, acctType, curDef };
  }

  /** Unified OFX/QFX entry point. */
  function parseOFX(text) {
    return isOFXSGML(text) ? parseOFXSGML(text) : parseOFXXML(text);
  }

  // ── QIF parser ────────────────────────────────────────────────────────────

  /** Parse QIF text. Returns array of transaction objects. */
  function parseQIF(text) {
    const transactions = [];
    let cur = {};
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trimEnd();
      if (!line) continue;
      const code = line[0];
      const val  = line.slice(1).trim();
      switch (code) {
        case 'D': cur.date   = val; break;
        case 'T': cur.amount = val; break;
        case 'P': cur.payee  = val; break;
        case 'M': cur.memo   = val; break;
        case '^':
          if (cur.date) {
            const raw = cur.amount ? cur.amount.replace(/,/g, '') : '0';
            const amt = parseFloat(raw);
            transactions.push({
              Reference_ID: null,
              Date:         normaliseDate(cur.date),
              Memo:         cur.memo || cur.payee || '',
              PayeeName:    cur.payee || '',
              Amount:       amt,
              Type:         amt >= 0 ? 'Credit' : 'Debit',
              Currency:     'USD'
            });
          }
          cur = {};
          break;
      }
    }
    return transactions;
  }

  // ── OFX account matching ──────────────────────────────────────────────────

  /** Attempts to match ACCTID to Reference_ID in the Account table. Returns account row or null. */
  function matchOFXAccount(acctId) {
    if (!acctId) return null;
    return DB.queryOne(
      'SELECT * FROM Accounts WHERE Reference_ID = ? AND Active = 1 LIMIT 1', [acctId]) || null;
  }

  // ── Core insert logic ─────────────────────────────────────────────────────

  /**
   * Insert an array of normalised transaction objects into the DB for the
   * given accountId.  Handles payee lookup / creation and duplicate detection.
   * Returns the number of records inserted.
   */
  function insertTransactions(txRows, accountId, ignoreKnown = false) {
    let count = 0;
    for (const t of txRows) {
      if (!t.Date || isNaN(t.Amount)) continue;

      // Skip if already recorded (same Reference_ID + Account_ID already valid in DB)
      if (ignoreKnown && t.Reference_ID) {
        const exists = DB.queryOne(
          'SELECT 1 FROM Transactions WHERE Reference_ID = ? AND Account_ID = ? AND Valid = 1 LIMIT 1',
          [t.Reference_ID, accountId]
        );
        if (exists) continue;
      }

      // Payee resolution
      let payeeId = DB.lookupPayee(t.PayeeName);
      if (!payeeId && t.PayeeName) payeeId = DB.createPayee(t.PayeeName, false); // no alias on import

      // Category: last used for this payee, or Unassigned (1)
      const catId = payeeId ? DB.getLastCategory(payeeId) : 1;

      // Insert transaction
      DB.run(
        `INSERT INTO Transactions
           (Reference_ID, Date, Memo, Account_ID, Payee_ID, Category_ID,
            Amount, Type, Currency, Reviewed, Valid)
         VALUES (?,?,?,?,?,?,?,?,?,0,1)`,
        [t.Reference_ID || null, t.Date, t.Memo || null, accountId,
         payeeId || null, catId, t.Amount, t.Type, t.Currency || 'USD']
      );

      // Get the new Transaction_ID
      const newRow = DB.queryOne("SELECT last_insert_rowid() AS id");
      const newId  = newRow.id;

      // Duplicate detection: same Date + Account_ID + Amount among older records
      const dup = DB.queryOne(
        `SELECT Transaction_ID FROM Transactions
         WHERE Account_ID = ? AND Date = ? AND Amount = ?
           AND Transaction_ID < ? AND Valid = 1
         ORDER BY Transaction_ID ASC LIMIT 1`,
        [accountId, t.Date, t.Amount, newId]
      );
      if (dup) {
        DB.run(
          'UPDATE Transactions SET Linked_Transaction_ID = ? WHERE Transaction_ID = ?',
          [dup.Transaction_ID, newId]
        );
      }
      count++;
    }
    return count;
  }

  // ── Main entry point ──────────────────────────────────────────────────────

  /** Called by File > Import menu item. */
  async function run() {
    // Pick file — startIn uses the last import location for MRU folder behaviour
    let fileHandle;
    try {
      const opts = {
        id:    'money-import',
        types: [{ description: 'Transaction Files', accept: {
          'text/plain': ['.csv', '.qif', '.ofx', '.qfx']
        }}]
      };
      if (_lastImportHandle) opts.startIn = _lastImportHandle;
      [fileHandle] = await window.showOpenFilePicker(opts);
    } catch { return; } // user cancelled
    _lastImportHandle = fileHandle;

    const file = await fileHandle.getFile();
    const text = await file.text();
    const name = file.name.toLowerCase();

    // Detect format
    let rawTransactions, accountId, ignoreKnown = false;
    const accounts = DB.query('SELECT Account_ID, Name, Type, Reference_ID FROM Accounts WHERE Active = 1');

    if (name.endsWith('.csv')) {
      if (!accounts.length) {
        await Dialogs.alert('No Accounts', 'Please create at least one account before importing.');
        return;
      }

      const rows = parseCSV(text);
      if (!rows.length) {
        await Dialogs.alert('No Data', 'No data rows were found in the CSV file.');
        return;
      }

      const headers         = Object.keys(rows[0]);
      const existingMappings = DB.query('SELECT Source, Target, Pattern, Negate FROM Mappings');
      const userMappings    = await Dialogs.csvColumnMapper(headers, existingMappings);
      if (!userMappings) return;

      // Persist mappings (upsert by field key — Source = field name, Target = CSV column)
      for (const m of userMappings) {
        DB.run('DELETE FROM Mappings WHERE Source = ?', [m.Source]);
        if (m.Target) {
          DB.run('INSERT INTO Mappings (Source, Target, Pattern, Negate) VALUES (?, ?, ?, ?)',
            [m.Source, m.Target, m.Pattern || null, m.Negate || 0]);
        }
      }

      const csvAcct = await Dialogs.selectAccount('Select Account', accounts, undefined, { showIgnoreKnown: true });
      if (csvAcct == null) return;
      accountId   = csvAcct.accountId;
      ignoreKnown = csvAcct.ignoreKnown;

      rawTransactions = csvToTransactionsWithMappings(rows, userMappings);

    } else if (name.endsWith('.ofx') || name.endsWith('.qfx')) {
      const parsed    = parseOFX(text);
      rawTransactions = parsed.transactions;
      const matched   = matchOFXAccount(parsed.acctId);
      const result    = await Dialogs.confirmAccount(matched, accounts, { showIgnoreKnown: true });
      if (result == null) return;
      ignoreKnown = result.ignoreKnown;
      if (result.create) {
        const newName = parsed.org || parsed.acctId || 'Imported Account';
        DB.run(
          `INSERT INTO Accounts (Reference_ID, Name, Type, Starting_Balance, Balance, Currency, Active)
           VALUES (?, ?, ?, 0, 0, ?, 1)`,
          [parsed.acctId || null, newName, parsed.acctType || 'Other', parsed.curDef || 'USD']
        );
        accountId = DB.queryOne('SELECT last_insert_rowid() AS id').id;
        App.onDataChanged(null);
      } else {
        accountId = result.accountId;
      }

    } else if (name.endsWith('.qif')) {
      if (!accounts.length) {
        await Dialogs.alert('No Accounts', 'Please create at least one account before importing.');
        return;
      }
      const qifAcct = await Dialogs.selectAccount('Select Account', accounts, undefined, { showIgnoreKnown: true });
      if (qifAcct == null) return;
      accountId   = qifAcct.accountId;
      ignoreKnown = qifAcct.ignoreKnown;
      rawTransactions = parseQIF(text);

    } else {
      await Dialogs.alert('Unsupported Format', 'File must be .csv, .ofx, .qfx, or .qif');
      return;
    }

    if (!rawTransactions.length) {
      await Dialogs.alert('No Transactions', 'No transaction records were found in the file.');
      return;
    }

    const count = insertTransactions(rawTransactions, accountId, ignoreKnown);

    // Update account balance (full recalc after import)
    DB.recalcAccountBalance(accountId, null);

    // Notify app to refresh
    App.onDataChanged(accountId);

    await Dialogs.alert('Import Complete', `${count} transaction(s) imported successfully.`);
  }

  return { run, parseCSV, parseOFX, parseQIF, insertTransactions, normaliseDate };
})();
