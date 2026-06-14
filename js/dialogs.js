/* Modal dialog utilities */

const Dialogs = (() => {
  const backdrop = () => document.getElementById('modal-backdrop');
  const container = () => document.getElementById('modal-container');

  function _show(html) {
    container().innerHTML = html;
    backdrop().classList.remove('hidden');
    container().classList.remove('hidden');
  }

  function _hide() {
    backdrop().classList.add('hidden');
    container().classList.add('hidden');
    container().innerHTML = '';
  }

  /** Simple info / error message. */
  function alert(title, message) {
    return new Promise(resolve => {
      _show(`
        <div class="dlg">
          <div class="dlg-title">${title}</div>
          <div class="dlg-body">${message}</div>
          <div class="dlg-footer">
            <button id="dlg-ok" class="btn btn-primary">OK</button>
          </div>
        </div>`);
      document.getElementById('dlg-ok').onclick = () => { _hide(); resolve(); };
    });
  }

  /** Yes / No confirmation.  Resolves true=yes, false=no. */
  function confirm(title, message) {
    return new Promise(resolve => {
      _show(`
        <div class="dlg">
          <div class="dlg-title">${title}</div>
          <div class="dlg-body">${message}</div>
          <div class="dlg-footer">
            <button id="dlg-yes" class="btn btn-primary">Yes</button>
            <button id="dlg-no"  class="btn btn-secondary">No</button>
          </div>
        </div>`);
      document.getElementById('dlg-yes').onclick = () => { _hide(); resolve(true); };
      document.getElementById('dlg-no').onclick  = () => { _hide(); resolve(false); };
    });
  }

  /** Text input prompt.  Resolves with string or null on cancel. */
  function prompt(title, message, defaultValue) {
    return new Promise(resolve => {
      _show(`
        <div class="dlg">
          <div class="dlg-title">${title}</div>
          <div class="dlg-body">
            <p>${message}</p>
            <input id="dlg-input" type="text" class="dlg-input" value="${defaultValue || ''}">
          </div>
          <div class="dlg-footer">
            <button id="dlg-ok"     class="btn btn-primary">OK</button>
            <button id="dlg-cancel" class="btn btn-secondary">Cancel</button>
          </div>
        </div>`);
      const inp = document.getElementById('dlg-input');
      inp.focus();
      inp.select();
      const ok = () => { _hide(); resolve(inp.value.trim() || null); };
      document.getElementById('dlg-ok').onclick     = ok;
      document.getElementById('dlg-cancel').onclick = () => { _hide(); resolve(null); };
      inp.onkeydown = e => { if (e.key === 'Enter') ok(); if (e.key === 'Escape') { _hide(); resolve(null); } };
    });
  }

  /** Account selector.  accounts = [{Account_ID, Name, Type}].  Resolves with Account_ID or null. */
  function selectAccount(title, accounts, message) {
    return new Promise(resolve => {
      const opts = accounts.map(a =>
        `<option value="${a.Account_ID}">${a.Name} (${a.Type})</option>`).join('');
      _show(`
        <div class="dlg">
          <div class="dlg-title">${title}</div>
          <div class="dlg-body">
            <p>${message || 'Select the account for this import:'}</p>
            <select id="dlg-acct" class="dlg-select">${opts}</select>
          </div>
          <div class="dlg-footer">
            <button id="dlg-ok"     class="btn btn-primary">OK</button>
            <button id="dlg-cancel" class="btn btn-secondary">Cancel</button>
          </div>
        </div>`);
      document.getElementById('dlg-ok').onclick = () => {
        const v = parseInt(document.getElementById('dlg-acct').value, 10);
        _hide(); resolve(v);
      };
      document.getElementById('dlg-cancel').onclick = () => { _hide(); resolve(null); };
    });
  }

  /**
   * Confirm an auto-matched account, or let the user pick a different one or create a new one.
   * matchedAccount may be null (no match found).
   * Resolves with { accountId: <number> } | { create: true } | null (cancelled).
   */
  function confirmAccount(matchedAccount, accounts) {
    return new Promise(resolve => {
      const hasAccounts = accounts.length > 0;
      const opts = accounts.map(a =>
        `<option value="${a.Account_ID}" ${matchedAccount && a.Account_ID === matchedAccount.Account_ID ? 'selected' : ''}>${a.Name} (${a.Type})</option>`
      ).join('');
      const msg = matchedAccount
        ? `The file was matched to account <strong>${matchedAccount.Name}</strong>. Confirm, choose a different account, or create a new one:`
        : 'No matching account was found. Select an existing account or create a new one:';
      const selectHtml = hasAccounts
        ? `<select id="dlg-acct" class="dlg-select">${opts}</select>`
        : `<p style="color:#999;font-style:italic;margin-top:6px">No existing accounts — use Create New Account.</p>`;
      _show(`
        <div class="dlg">
          <div class="dlg-title">Confirm Account</div>
          <div class="dlg-body">
            <p>${msg}</p>
            ${selectHtml}
          </div>
          <div class="dlg-footer">
            ${hasAccounts ? '<button id="dlg-ok" class="btn btn-primary">Use Selected</button>' : ''}
            <button id="dlg-create" class="btn btn-secondary">Create New Account</button>
            <button id="dlg-cancel" class="btn btn-secondary">Cancel</button>
          </div>
        </div>`);
      if (hasAccounts) {
        document.getElementById('dlg-ok').onclick = () => {
          const v = parseInt(document.getElementById('dlg-acct').value, 10);
          _hide(); resolve({ accountId: v });
        };
      }
      document.getElementById('dlg-create').onclick = () => { _hide(); resolve({ create: true }); };
      document.getElementById('dlg-cancel').onclick  = () => { _hide(); resolve(null); };
    });
  }

  /**
   * Pick a database file from a list, or create a new one.
   * files = ['name1.db', 'name2.db', ...]
   * Resolves { action: 'open', name } or { action: 'new' } or null on cancel.
   */
  function selectDbFile(files) {
    return new Promise(resolve => {
      const listHtml = files.length
        ? files.map((f, i) =>
            `<div class="file-item" data-idx="${i}">${f}</div>`).join('')
        : '<div class="file-empty">No database files found in this folder.</div>';
      _show(`
        <div class="dlg dlg-wide">
          <div class="dlg-title">Open Database</div>
          <div class="dlg-body">
            <div class="file-list">${listHtml}</div>
          </div>
          <div class="dlg-footer">
            <button id="dlg-new"    class="btn btn-secondary">New Database</button>
            <button id="dlg-cancel" class="btn btn-secondary">Cancel</button>
          </div>
        </div>`);

      container().querySelectorAll('.file-item').forEach((el, i) => {
        el.onclick = () => { _hide(); resolve({ action: 'open', name: files[i] }); };
      });
      document.getElementById('dlg-new').onclick    = () => { _hide(); resolve({ action: 'new' }); };
      document.getElementById('dlg-cancel').onclick = () => { _hide(); resolve(null); };
    });
  }

  /**
   * Merge popup — shows transactions with the same amount for the user to link to.
   * rows = array of transaction objects with Transaction_ID, Date, Payee_Name, Amount.
   * Resolves with Transaction_ID or null.
   */
  function mergePopup(rows) {
    return new Promise(resolve => {
      const rowsHtml = rows.map(r => `
        <div class="merge-row" data-id="${r.Transaction_ID}">
          <span class="mr-date">${r.Date}</span>
          <span class="mr-payee">${r.Payee_Name || '—'}</span>
          <span class="mr-amt">${fmtCurrency(r.Amount)}</span>
        </div>`).join('');
      _show(`
        <div class="dlg dlg-wide">
          <div class="dlg-title">Select Transaction to Link</div>
          <div class="dlg-body">
            <p>Select the original transaction to link this record to as a duplicate:</p>
            <div class="merge-list">${rowsHtml}</div>
          </div>
          <div class="dlg-footer">
            <button id="dlg-ok"     class="btn btn-primary" disabled>OK</button>
            <button id="dlg-cancel" class="btn btn-secondary">Cancel</button>
          </div>
        </div>`);

      let selectedId = null;
      container().querySelectorAll('.merge-row').forEach(el => {
        el.onclick = () => {
          container().querySelectorAll('.merge-row').forEach(e => e.classList.remove('selected'));
          el.classList.add('selected');
          selectedId = parseInt(el.dataset.id, 10);
          document.getElementById('dlg-ok').disabled = false;
        };
        el.ondblclick = () => {
          selectedId = parseInt(el.dataset.id, 10);
          _hide(); resolve(selectedId);
        };
      });
      document.getElementById('dlg-ok').onclick = () => {
        _hide(); resolve(selectedId);
      };
      document.getElementById('dlg-cancel').onclick = () => { _hide(); resolve(null); };
    });
  }

  // Shared currency formatter used by dialogs
  function fmtCurrency(v) {
    if (v == null) return '';
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(v);
  }

  /**
   * Pattern selector for "Apply pattern" command.
   * patterns = [{Pattern_ID, Pattern, Payee_ID, Payee_Name}]
   * Resolves with the selected pattern object or null on cancel.
   */
  function selectPattern(patterns) {
    return new Promise(resolve => {
      const opts = patterns.map(p =>
        `<option value="${p.Pattern_ID}">${p.Pattern} → ${p.Payee_Name}</option>`
      ).join('');
      _show(`
        <div class="dlg dlg-wide">
          <div class="dlg-title">Apply Pattern</div>
          <div class="dlg-body">
            <p>Select a pattern to apply to unreviewed transactions in the active tab:</p>
            <select id="dlg-pattern" class="dlg-select">${opts}</select>
          </div>
          <div class="dlg-footer">
            <button id="dlg-ok"     class="btn btn-primary">Apply</button>
            <button id="dlg-cancel" class="btn btn-secondary">Cancel</button>
          </div>
        </div>`);
      document.getElementById('dlg-ok').onclick = () => {
        const patternId = parseInt(document.getElementById('dlg-pattern').value, 10);
        _hide(); resolve(patterns.find(p => p.Pattern_ID === patternId) || null);
      };
      document.getElementById('dlg-cancel').onclick = () => { _hide(); resolve(null); };
    });
  }

  /**
   * CSV column-mapping dialog.
   * headers          = array of CSV column name strings (from the file header row)
   * existingMappings = array of {Source, Target, Pattern} rows from the Mappings table
   *                    where Source = transaction field key, Target = CSV column name.
   *
   * Shows one row per transaction field; each row has a dropdown to pick the source
   * CSV column and an optional regex (first capture group used if present).
   *
   * Resolves with array of {Source, Target, Pattern} for all five fields on Import,
   * or null on Cancel.  Validates that Date and Amount are both mapped before closing.
   */
  function csvColumnMapper(headers, existingMappings) {
    const FIELDS = [
      { key: 'Reference_ID', label: 'Reference ID' },
      { key: 'Date',         label: 'Date'          },
      { key: 'Payee',        label: 'Payee'         },
      { key: 'Memo',         label: 'Memo'          },
      { key: 'Amount',       label: 'Amount'        },
    ];

    return new Promise(resolve => {
      const mapLookup = {};
      existingMappings.forEach(m => { mapLookup[m.Source] = m; });

      const colOpts = ['<option value="">— none —</option>',
        ...headers.map(h => `<option value="${h}">${h}</option>`)
      ].join('');

      const rowsHtml = FIELDS.map((f, i) => {
        const ex   = mapLookup[f.key] || {};
        // Re-select saved column only if it still exists in this file's headers
        const sel  = headers.includes(ex.Target) ? ex.Target : '';
        const opts = ['<option value="">— none —</option>',
          ...headers.map(h =>
            `<option value="${h}"${sel === h ? ' selected' : ''}>${h}</option>`)
        ].join('');
        const extraCell = f.key === 'Amount'
          ? `<label class="csv-neg-label"><input type="checkbox" class="csv-map-neg"${ex.Negate ? ' checked' : ''}> Neg</label>`
          : '<div></div>';
        return `
          <div class="csv-map-field">${f.label}</div>
          <select class="csv-map-src" data-idx="${i}">${opts}</select>
          <input type="text" class="csv-map-pattern" data-idx="${i}"
                 placeholder="e.g. (\\d+)" value="${ex.Pattern || ''}">
          ${extraCell}`;
      }).join('');

      _show(`
        <div class="dlg dlg-xl">
          <div class="dlg-title">Map CSV Columns</div>
          <div class="dlg-body">
            <p>Select which CSV column supplies each transaction field. If a regex is entered, the first capture group is used as the value.</p>
            <div class="csv-map-grid">
              <div class="csv-map-hdr">Transaction Field</div>
              <div class="csv-map-hdr">CSV Column</div>
              <div class="csv-map-hdr">Extract Pattern <span class="csv-map-hint">(optional regex)</span></div>
              <div class="csv-map-hdr"></div>
              ${rowsHtml}
            </div>
            <div id="csv-map-err" class="csv-map-err"></div>
          </div>
          <div class="dlg-footer">
            <button id="dlg-ok"     class="btn btn-primary">Import</button>
            <button id="dlg-cancel" class="btn btn-secondary">Cancel</button>
          </div>
        </div>`);

      document.getElementById('dlg-ok').onclick = () => {
        const srcs     = container().querySelectorAll('.csv-map-src');
        const patterns = container().querySelectorAll('.csv-map-pattern');
        const negChk   = container().querySelector('.csv-map-neg');
        const result   = FIELDS.map((f, i) => ({
          Source:  f.key,
          Target:  srcs[i].value,
          Pattern: patterns[i].value.trim() || null,
          Negate:  f.key === 'Amount' && negChk && negChk.checked ? 1 : 0
        }));

        const hasDate = result.some(m => m.Source === 'Date'   && m.Target);
        const hasAmt  = result.some(m => m.Source === 'Amount' && m.Target);
        if (!hasDate || !hasAmt) {
          document.getElementById('csv-map-err').textContent =
            'Date and Amount must each be mapped to a CSV column.';
          return;
        }

        _hide();
        resolve(result);
      };

      document.getElementById('dlg-cancel').onclick = () => { _hide(); resolve(null); };
    });
  }

  return { alert, confirm, prompt, selectAccount, confirmAccount, selectDbFile, mergePopup, selectPattern, csvColumnMapper };
})();
