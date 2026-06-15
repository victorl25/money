# Money - Personal Finance Tracker

## Project Overview

A single-page application for tracking credit card and bank transactions. Runs entirely locally in a bundled Chromium browser with no server, no network dependencies, and no build step.

---

## Architecture

### Runtime Environment

- **Browser**: Chromium 148 (located in `chrome/148.0.7778.179/`)
- **Launch**: `money.bat` starts Chromium with required flags and opens `index.html`
- **Protocol**: `file://` (no local server)

**Required Chromium launch flags:**
```
--allow-file-access-from-files
--enable-features=FileSystemAccessAPI
```

### File Structure

```
Money/
├── CLAUDE.md               # This file
├── index.html              # Single entry point (HTML + CSS + JS)
├── money.bat               # Launches Chromium with correct flags
└── chrome/                 # Bundled Chromium install
    └── 148.0.7778.179/
└── lib/
    ├── sql-wasm.js         # sql.js library (local copy, no CDN)
    ├── sql-wasm.wasm       # SQLite WASM binary (local copy)
    ├── tabulator.min.js    # Tabulator 6.x table library (local copy)
    └── tabulator.min.css   # Tabulator default theme (local copy)
└── js/
    ├── schema.js           # SQL schema and seed data
    ├── db.js               # Database operations wrapper
    ├── dialogs.js          # Modal dialog utilities
    ├── import.js           # CSV / OFX / QIF import parsers
    ├── tab-accounts.js     # Accounts tab
    ├── tab-transactions.js # Transactions tab
    ├── tab-payees.js       # Payees tab
    ├── tab-aliases.js      # Aliases tab
    ├── tab-patterns.js     # Patterns tab
    ├── tab-categories.js   # Categories tab
    ├── tab-query.js        # Query tab (ad-hoc SQL)
    └── app.js              # Main application init and menu handling
```

### Data Storage

- **Format**: SQLite database file (`.db`) stored in a user-chosen local folder
- **Library**: `sql.js` (SQLite compiled to WASM) — chosen over `@sqlite.org/sqlite-wasm` because it does NOT require `SharedArrayBuffer`, which is unavailable under `file://` protocol
- **In-memory**: The entire database is loaded into `sql.js` in memory at startup; all reads and writes operate in-memory for performance

### File Access

The app uses the **File System Access API** (`showDirectoryPicker`) once at startup:
1. User is prompted to select their data folder
2. App scans the folder for `.db` files matching the naming pattern
3. User selects an existing database or creates a new one
4. DB file bytes are read and loaded into `sql.js`

### Save Strategy

On each explicit save (manual "Save" button):
- The current in-memory database is exported from `sql.js` as a `Uint8Array`
- Written to a **new file** with a timestamp suffix: `transactions_YYYYMMDDHHMM.db`
- The previous file is left untouched (acts as implicit backup history)
- No file renaming or deletion occurs

Example history in data folder:
```
transactions_202506011430.db
transactions_202506021015.db
transactions_202506121200.db   <- latest
```

### WASM Usage

The meaningful WASM component is `sql.js` (SQLite engine). All other application logic (filtering, formatting, UI event handling) is plain JavaScript — adding custom WASM for that would add complexity with no practical benefit at typical personal-finance data volumes.

---

## Application Startup Flow

1. `money.bat` accepts an optional first command-line argument as a DATA_DIR override (default: `<appDir>\data`). Creates DATA_DIR if absent, scans it for `.db` files, finds the most recent by filename (descending sort — filenames are timestamped so alphabetical order equals chronological order), then launches Chromium with `?dataDir=<forwardSlashPath>&db=<filename>` appended to the URL. Spaces in DATA_DIR are encoded as `%20`.
2. `app.js` reads both URL parameters. `_dataDirUrl` is set to `file:///{dataDir}` when `?dataDir=` is present, or falls back to `{pageDir}data` when opening `index.html` directly. The DB is fetched from `${_dataDirUrl}/${dbFile}`.
3. `_lastFileHandle` is loaded from IndexedDB (`MoneyApp` database, `handles` store, key `'dbFile'`) at startup so the Save/Open dialogs open in the correct folder across Chromium restarts.
4. If a file is found and loads successfully → `DB.loadFromBytes()`. If `_lastFileHandle` is still null after the IDB load, `showOpenFilePicker` is attempted (with `id: 'money-db'`) to acquire a handle for the auto-loaded file; on success the handle is persisted to IDB. This is a one-time step per fresh Chromium profile.
5. If no parameter or fetch fails → `DB.createNew()` (empty database with default Categories record).
6. Accounts tab opens immediately — no welcome screen or folder picker.

Data folder: configurable via `money.bat` first argument; defaults to `Money/data/` (created automatically by `money.bat`).

---

## Transaction Data Schema

The transactional data schema manages the following entities:
- Accounts - transaction sources such as credit card accounts, bank accounts, investment accounts
- Payees - people or vendors on the originating or receiving end of each transaction
- Aliases - aliases or different names for payees
- Patterns - regex patterns to match same payees with many potential aliases
- Categories - classufications of transactions into income/expense buckets such as wages, utilities, food, etc.
- Mappings - saved CSV column-to-field associations used to pre-populate the CSV import mapping dialog
- Transactions - records of financial transactions, transactions can be debit, credit or transfer between accounts

Accounts table:
- Account_ID (primary key, integer, auto incremented)
- Reference_ID (external account ID, text)
- Name (text)
- Type (controlled vocabulary: Bank, Credit card, Investment, Other)
- Starting_Ballance (initial ballance when the account was created)
- Ballance (current ballance)
- Last_Updated (datetime stamp when account transactions were last updated)
- Currency (text, default USD)
- Active (flag whether the account is active or not)

Payees table:
- Payee_ID (primary key, integer, auto incremented)
- Name (text, indexed for a fast search)
- Active (flag whether the payee is active or not)

Aliases table:
- Alias_ID (primary key, integer, auto incremented)
- Payee_ID (foreign key to Payees table)
- Alias (text, indexed for a fast search)
- Active (flag whether the alias is active or not)

Patterns table:
- Pattern_ID (primary key, integer, auto incremented)
- Payee_ID (foreign key to Payees table)
- Pattern (regex pattern)
- Active (flag whether the alias is active or not)

Categories table:
- Category_ID (primary key, integer, auto incremented)
- Name (text)
- Type (controlled vocabulary: Expense, Income, Other; default Expense)
- Active (flag whether the category is active or not)

Mappings table:
- Mapping_ID (primary key, integer, auto incremented)
- Source (transaction field key, unique: Reference_ID | Date | Payee | Memo | Amount)
- Target (CSV column name from the source file)
- Pattern (optional regex; if set, applied to the source value — first capture group used, or full match if no group)
- Negate (integer flag, default 0; applies to Amount only — if 1, the parsed amount is multiplied by -1)

Transaction table:
- Transaction_ID (primary key, integer, auto incremented)
- Reference_ID (external transaction ID, text, nullable)
- Date (datetime stamp of the transaction, indexed)
- Memo (free text description of the transaction, nullable)
- Account_ID (foreign key to Accounts table, indexed)
- Transfer_Account_ID (foreign key to Accounts table, nullable)
- Payee_ID (foreign key to Payees table, indexed, nullable)
- Category_ID (foreign key to Categories table, indexed)
- Amount (transactions's value as a positive value for credit and a negative value for debit)
- Type (controlled vocabulary: Debit, Credit, Transfer, Other)
- Currency (text, default USD)
- Reviewed (flag whether the transaction has been reviewed by the user, default is no)
- Linked_Transaction_ID (key of the other transaction that superseded this transaction, nullable)
- Valid (flag whether the transaction is valid, default is yes, invalid transactions are not shown/considered)


---

## Transaction Inputs

The Account and Category entities are populated by the user and only through the user interface. 

The transaction entities can either be imported from a file or entered manually by the user through the user interface. The application supports importing bank or credit card transactions from the following files: QIF, QFX, OFX, and CSV.

The Payee entities are created automatically when needed. Each entered or imported transaction is checked against the known payees and their aliases. If there is a match, the exsiting payee is linked to the transaction. If there is no match, a new payee or payee alias is created following the user input/instructions. 

### Example of importing transaction data from a CSV file:

File example:
```CSV
Posted Date,Reference Number,Payee,Address,Amount
05/11/2026,24765016129744784713133,"WOORI MART WEST WINDSOR NJ","WEST WINDSOR  NJ ",-10.64
05/09/2026,12920401080020960836180,"ONLINE/MOBILE PAYMENT CONF#M09219068798","F#M0921906879 8  ",307.45
```

CSV import uses a generic column-mapping dialog instead of hardcoded column names:

1. The file is parsed to extract the header row (column names).
2. Existing mappings are loaded from the `Mappings` table (keyed by Source column name).
3. A **CSV Column Mapping** dialog is shown with one row per transaction field (Reference ID, Date, Payee, Memo, Amount). Each row has:
   - **Transaction Field** — fixed label (read-only)
   - **CSV Column** — dropdown: `— none —` + all column headers from the file
   - **Extract Pattern** — optional regex; if provided, the first capture group is used as the value (full match used if no capture group)
   - **Neg** (Amount row only) — checkbox; if checked, the parsed amount is multiplied by -1 before the transaction record is populated
4. The dialog pre-populates dropdowns, patterns, and the Neg checkbox from the Mappings table (keyed by transaction field name: `Source` = field key, `Target` = CSV column name, `Negate` = 0/1). If a saved column no longer exists in the current file, the dropdown resets to `— none —`.
5. The Import button shows an inline error unless Date and Amount are both mapped to a CSV column.
6. On Import: mappings are saved back to the Mappings table (upsert by Source), then the user is asked to select an account, and transactions are inserted using the mapped field values.

Field mapping (resolved at runtime from Mappings table):
- Transaction_ID <- auto increment
- Reference_ID <- column mapped to Reference ID (if any)
- Date <- column(s) mapped to Date
- Memo <- column(s) mapped to Memo (concatenated)
- Account_ID <- account ID selected by the user
- Payee_ID <- column mapped to Payee, used to lookup Payee ID in Payees/Aliases/Patterns tables
- Category_ID <- last used category ID for the resolved Payee ID (lookup in Transactions table)
- Amount <- column mapped to Amount (commas stripped before parseFloat)
- Type <- if Amount ≥ 0 then Credit else Debit
- Currency <- column mapped to Currency, or USD if unmapped

### Example of importing transaction data from an OFX/QFX file (either SGML or XML format):

File example:
```XML
<OFX>
  <SIGNONMSGSRSV1>
    <SONRS>
      <STATUS>
        <CODE>0
        <SEVERITY>INFO
      </STATUS>
      <DTSERVER>20250725191439
      <LANGUAGE>ENG
      <FI>
        <ORG>Gemini
        <FID>123456
      </FI>
    </SONRS>
  </SIGNONMSGSRSV1>
  <CREDITCARDMSGSRSV1>
    <CCSTMTTRNRS>
      <TRNUID>53142a78898a467b996fab3e0664967a
      <STATUS>
        <CODE>0
        <SEVERITY>INFO
      </STATUS>
      <CCSTMTRS>
        <CURDEF>USD
        <CCACCTFROM>
          <ACCTID>48ca9351-8d10-4173-abc
        </CCACCTFROM>
        <BANKTRANLIST>
          <DTSTART>20250612000000
          <DTEND>20250725000000
          <STMTTRN>
            <TRNTYPE>DEBIT
            <DTPOSTED>20250612000000
            <TRNAMT>-980.00
            <FITID>32fdfad45e894826b9e5a2634a8d7c3c
            <NAME>BCRC                   WASHINGTON CR USA
            <MEMO>BCRC                   WASHINGTON CR USA
          </STMTTRN>
```

Use <ACCTID> to search the Reference_ID column in the Account table. If a match is found, present it to the user to confirm or choose a different existing account. If no match is found, present the user with a choice to select an existing account or create a new one. If the user chooses to create a new account: use <ORG> as the account Name; infer Type as "Credit card" if <CCACCTFROM> is present, "Bank" if <BANKACCTFROM> is present, otherwise "Other"; set Starting_Balance and Balance to 0; use <CURDEF> for Currency. Note that <ACCTID> can be inside <CCACCTFROM> or <BANKACCTFROM>.

Field mapping:
- Transaction_ID <- auto increment
- Reference_ID <- <FITID>
- Date <- <DTPOSTED>
- Memo <- <MEMO> 
- Account_ID <- account ID matched/selected by the user
- Payee_ID <- use <NAME> to lookup Payee ID in Payees and Aliases tables
- Category_ID <- last used category ID for the selected Payee ID (lookup in Transaction table)
- Amount <- <TRNAMT>
- Type <- if <TRNAMT> is positive then Credit else Debit
- Currency <- USD

### Example of importing transaction data from a QIF file:

File example:
```plaintext
!Type:Bank
D06/10/2026
T-156.85
C
N
PBANK OF AMERICA PAYMENT
MBANK OF AMERICA PAYMENT
^
D06/08/2026
T-200.00
C
N
PZelle Transfer to LIUDMILA KEIKO 877-726-5640-615900B0B47X
MZelle Transfer to LIUDMILA KEIKO 877-726-5640-615900B0B47X
^
```

Ask user to select the account. 

Field mapping:
- Transaction_ID <- auto increment
- Reference_ID <- null
- Date <- D... line, value after 'D'
- Memo <- M... line, value after 'M' 
- Account_ID <- account ID selected by the user
- Payee_ID <- P... line, use value after 'P' to lookup Payee ID in Payees and Aliases tables
- Category_ID <- last used category ID for the selected Payee ID (lookup in Transaction table)
- Amount <- T... line, value after 'T'
- Type <- if Amount is positive then Credit else Debit
- Currency <- USD


---

## Importing Logic

The Import command performs the following logical steps:

1. Identifies the type of the input file selected by the user and routes the import request to the corresponding data processing routine.
2. Identifies the account for incoming transaction through the data logic or asks user to select/confirm the account. All imported records will be associtated with the identified/selected Account ID. 
3. Each new transaction record sourced is added to the Transaction table and Payee and Category IDs are selected based on the following lookup logic. The supplied payee name is resolved using three steps in order: (a) exact match on Payee.Name, (b) exact match on PayeeAlias.Alias, (c) regex match against PayeePattern.Pattern evaluated in JavaScript — patterns are tested in ascending Pattern_ID order and the first match wins; invalid regex patterns are silently skipped. If a match is found at any step, the matched Payee_ID is used and the most recent Category_ID for that Payee is also applied. If no match is found, a new Payee record is created using the supplied name — no PayeeAlias record is created in this case. The Category_ID defaults to 1 ("Unassigned") for newly created payees. The Reviewed flag for each added transaction record is set to false.
4. Each added transaction record is then compared to other transaction records. If another transaction with the same Date, Account_ID and Ammount is found, then the Linked_Transaction_ID field is poulated with the other transaction's ID. For example, if there are two transactions with IDs 101 and 105 that have identical dates, accounts and amounts, then transaction 105 (higher ID) will have Linked_Transaction_ID set to 101.
5. Update the account's balance. The Balance value is computed by considering all imported accounts's transactions in a chronological order. If two transactions have the same date, then the order is determined based on the Transaction_ID starting from earlier transactions first. Starting with current account balance add amount of each imported transaction in order. Transaction records with Linked_Transaction_ID not null are skipped for the balance computation (these transactions are assumed to be duplicates).


---

## UI Features

The application UI is organized as a menu strip and a collection of horizontal tabs. The menu strip contains the following submenus and commands therein:
File/
- New
- Open...
- Import...
- Save...
View/
- Accounts
- Payees
- Aliases
- Patterns
- Categories
Reports/
- Spend by category
- Spend by payee
Tools/
- Apply pattern...
- Remove duplicates...
- Assign category...
- Memo to payee...
- Merge payees...
- Query database...

The New command creates a new database in memory with empty tables. The Categories table is populated with two default records: Category_ID=1, Name=Unassigned, Type=Expense and Category_ID=2, Name=Transfer, Type=Other.

The Open command loads a previously saved database from a local file.

The Import command imports transactions from a file in one of the supported formats.

The Save command saves in-memory database into a local file. The prefix prompt is pre-filled with the prefix of the last opened or saved file (e.g. "transactions"); the save dialog opens in the same folder as that file. User may change the prefix; the application automatically adds a timestamp suffix (e.g. _202606121605) and the .db extension.

The Apply pattern command requires an active Transactions tab. It presents a list of available patterns (PayeePattern table, active records with their payee names). After the user selects a pattern, the command tests its regex against the Memo field of every unreviewed (Reviewed=0), valid transaction visible in the active tab. For each match, Payee_ID is updated to the pattern's Payee_ID. If at least one reviewed (Reviewed=1) transaction for that payee exists, its Category_ID is also copied to all matched transactions. A summary count is shown on completion and the active tab is re-rendered.

The Remove duplicates command asks the user to select an account, then scans all valid, unreviewed (`Reviewed=0`) transactions for that account that have a non-null `Reference_ID`. For each such transaction, if a reviewed (`Reviewed=1`), valid transaction with the same `Reference_ID` and `Account_ID` exists, the unreviewed transaction is hard-deleted from the Transactions table (any `Linked_Transaction_ID` FK references to it are nullified first). After deletion the account balance is recalculated and open tabs are refreshed. A summary count is shown on completion.

The Assign category command requires an active Transactions tab. It presents a payee dropdown (all active payees, sorted by name) and a category dropdown (all active categories, sorted by name). After the user selects both and clicks Assign, the command updates `Category_ID` on all valid transactions (both reviewed and unreviewed) for the selected payee that are visible in the active tab (respecting the tab's account and category filters). A summary count is shown on completion and the active tab is re-rendered.

The Memo to payee command asks the user to select an account, then finds all valid transactions for that account where `Payee_ID IS NULL` and `Memo` is non-empty. For each such transaction, the Memo value is used as the payee name and the same 3-step import payee resolution logic is applied: (a) exact match on Payees.Name, (b) exact match on Aliases.Alias, (c) regex match against Patterns. If a match is found the matched Payee_ID is used; if not, a new Payees record is created (no alias). `Category_ID` is set to the most recently used category for the resolved payee, or 1 (Unassigned) if none exists. All open tabs are refreshed and a summary count is shown on completion.

The Merge payees command shows a dialog with two payee dropdowns (From and To). The user selects the source and target payees and clicks Merge (same payee selected for both shows an inline validation error). After a confirmation prompt, all valid transactions with `Payee_ID = From` are updated to `Payee_ID = To`. All open tabs are refreshed and a count of affected transactions is shown. The From payee record is not deactivated automatically.

The Query database command opens a new Query tab. Multiple Query tabs may be open simultaneously. See the Query Tab section below.

The Accounts, Payees, Aliases, and Categories commands open new Accounts, Payees, Aliases, Patterns, and Categories tabs respectively. See the definitions of these tabs below.

The **Spend by category** command asks the user to select a time frame (Year to date, Previous year, All time), then opens a new closeable Report tab showing total spend for all Expense-type categories within that period. Rows are sorted descending by spend; a Grand Total row is appended. The tab is plain HTML (no Tabulator) with three columns: Category, Spend, % of Total. Category names are clickable hyperlinks — clicking one opens a Transactions tab filtered to that category and the same date range used by the report (tab ID `trn-cat-{id}-{frameKey}`). Multiple report tabs may be open simultaneously (tab IDs `rpt-cat-N`). The tab label includes the selected time frame (e.g. "Spend by Category – Year to date").

The **Spend by payee** command works identically but groups by Payee instead of Category. Only transactions in Expense-type categories are considered. Payee names are clickable hyperlinks — clicking one opens a Transactions tab filtered to that payee and the same date range (tab ID `trn-payee-{id}-{frameKey}`). Transactions with no payee are shown as "Unassigned" without a hyperlink. Multiple report tabs may be open simultaneously (tab IDs `rpt-pay-N`). The tab label includes the selected time frame (e.g. "Spend by Payee – Year to date").

The tab strip (`#tab-strip`) is a flex row containing a scrollable `#tab-bar` (tabs append here left-to-right in open order) and a Refresh button (`#tab-refresh`) anchored at the right end outside the scrollable area. Clicking the Refresh button re-loads data for the currently active tab (calls the appropriate module's `refresh()` function; Query tabs have no auto-refresh since the user controls execution).

Tabs are added on demand and each tab represents a filtered or aggregated view of the underlying data. Each View tab's space is vertically divided into two zones. The upper zone occupies 70-80% of the tab's space and displays a data table. The lower zone occupies the remaining tab's space and displays a form. The table and form content varies between tabs but the general layout is the same. The data table displays a filtered view of the data as rows and columns. The table can be sorted by any of the columns; column sort is tristate (ascending → descending → cleared) — clicking a sorted column a third time restores the natural data order (as returned by the underlying SQL query). Each table represents a dynamic view of the data. This means that if the underlying data are updated, the rendering of the data in the table should be automatically updated as well. Tabulator 6.3.0 is used for all data tables.

The table data view component should support the following functionality: sorting by any column, filtering by any column, row selection (one row at a time, selected row background should be different from the rest of the table), clicking on a cell value (see use cases below), Delete key capture, and a control column. The control column can display context dependent actions like Merge (see the Transactions tab) where appropriate. If the Delete key is pressed on the keyboard it should be interpreted as a request to "delete" the selected record. In this case the application need to verify that there are no other records referring to this record (referential constraints) and present user with an explanation/confirmation dialog. If there are referential constraints, the application should explain that the record cannot be deleted. If there are no referential constraints, the application should ask for a delete confirmation and then set the Active/Valid flag for this record to false.

Each form facilitates display of the additional data for the selected data record and allows editing of the selected data record. The form is dynamically linked to the data table. When user clicks on a row in the data table, the underlying record is considered selected and the form is updated to display the record's content. If the record is edited, an Accept button is shown. User has to click the Accept button to save the changes, otherwise the changes are silently ignored if user moved to another record. The form also has a New button that allows user to create a new record of the desired type. When user click the New button, form's content is nulled and is dissociated from the selected record.

All forms use a 3-column layout: left column (45% width) with up to 4 fields, middle column (45% width) with additional fields, and right column (10% width) containing action buttons arranged vertically — New at the top, Accept at the bottom, other buttons in between.

Each Report tab has a dedicated content which will be defined later.

### The Accounts Tab

When the application starts and the database file is loaded, the application displays the "Accounts" tab. The Accounts tab renders all records from the Account table where Active flag is set. The table object displays the following fields in order: Name(Account.Name), Type(Account.Type), Balance(Account.Balance), Last Transaction(date of the most recent valid transaction for this account from the Transactions table), To Review(count of valid transactions with Reviewed=0 for this account). Each account name works as a hyperlink - when user click on the account name a new tab is opened that displays transactions for this account.

The form on the Accounts tab displays the following fields for the selected account: Reference ID(Account.Reference_ID), Name(Account.Name), Type(Account.Type),  Currency(account.Currency), Starting Balance(Account.Starting_Balance), Active(account.Active). Each of the displayed fields can be edited. For the vocabulary controlled fields a drop down box is used, otherwise it is a free text editing. Note that Balance and Last Transaction fields are not user editable.

When a new database is created, user can use the New button on the Accounts' tab form to create new account records to import transactions.

### The Transactions Tab

Multiple Transactions tabs may be open simultaneously (one per account, payee, or category view). Each tab is independent with its own table and form state. Form element IDs are scoped per instance using the pattern `ft-<tabId>-<fieldName>` to prevent conflicts.

Each Transactions tab displayed is named after the account which transactions it displays. The Transactions tab renders all transactions records for the chosen account where Valid flag is set to true. The data for the Transactions tab are assembled by joining Transaction, Account, Payee and Category tables to resolve foreign keys. The table objects displays the following values in order: Date (Transaction.Date), Payee(Payee.Name), Debit(-Transaction.Amount if amount is negative), Credit(Transaction.Amount if amount is positive), Balance(calculated balance of the account in the chronological order of the valid transactions). The data in the Transactions tab can be pre-filtered by a specific Payee or Category (e.g. see navigation from the Payee and Category tabs). In that case only the transactions matching the specified Payee ID or Category ID are displayed. The Balance column is always shown; for payee/category-filtered views the running balance starts at 0 and accumulates across the displayed transactions in the order they appear.

The Balance column is computed in chronological order (ties broken by Transaction_ID ascending). For account views the running balance starts from the account's Starting_Balance. For payee- or category-filtered views the running balance starts from 0. In all cases linked (duplicate) transactions with Linked_Transaction_ID not null are skipped for the balance computation.

Transaction records with Reviewed flag set to false are displayed in a bold font and have an 'Accept' command in the control column. When user clicks the Accept command, transaction's Reviewed status is changed to true, the bolding is removed and the 'Accept' command is removed from the control column.

Transaction records with Linked_Transaction_ID not null are shown with light orange background and placed in the table immediately after the transaction they are linked to. These records will have 'Merge' and 'Unmerge' commands shown in the control column. When user clicks the Merge command, transaction's Valid status is changed to false and the transaction disappears from the table. When user clicks the Unmerge command, transaction's Linked_Transaction_ID value should be nullified and the transaction is considered independent. The balance column and the Account's balance are recalculated and the record's background color is removed.

The form on the Transactions tab uses a 3-column layout. Left column (top to bottom): Payee (or To/From — see below), Memo, Account, Reference ID. Middle column (top to bottom): Category, Date, Amount + Currency (on the same line), Type. Reference ID and Type are read-only informational fields. Type is automatically derived from the Amount sign (Credit if ≥ 0, Debit if < 0) and set to "Transfer" by the Transfer button. Payee and Category fields work as search boxes — as the user types, a list of matching records is displayed. If Category name does not match any existing Category record, a new Category is created after user confirmation. If no category is provided, the transaction is assigned to Category_ID=1 (Unassigned). When the transaction is Type=Transfer, the Category field is read-only (displays "Transfer" category).

When the selected transaction is Type=Transfer, the Payee field is hidden and replaced by a **Destination** field showing the name of the transfer-to account (looked up via Transfer_Account_ID). The Destination field works as a search box against the Account table (substring match). On Accept: if the typed name does not match any active account, an error is shown; if it matches and the destination has changed, the source transaction's Transfer_Account_ID is updated and the paired transaction's Account_ID is moved to the new destination account; balances are recalculated on all affected accounts (source, old destination if changed, new destination).

The form buttons are in the right column: New (top), Merge, Transfer, Accept (bottom). The New button resets the form. The Accept button serves a dual purpose: (1) it saves any edited form data, and (2) it marks the selected transaction as Reviewed. The Accept button is shown whenever the form has unsaved edits OR the selected transaction has Reviewed = false. The Transfer button is disabled in New mode and when the selected transaction is already Type=Transfer.

When the Transfer button is clicked: the user is prompted to select a destination account; the source transaction's Transfer_Account_ID is set to the destination account, Type is changed to Transfer, and Category_ID is set to the "Transfer" category (Category_ID=2); a mirror transaction is created on the destination account with Amount × -1, Account_ID / Transfer_Account_ID swapped, Payee_ID=null, and Category_ID also set to the "Transfer" category; balances are recalculated on both accounts.

When the user edits the Payee field and clicks Accept, the following payee resolution logic applies:
1. If the typed name matches an existing payee (via `DB.lookupPayee` — exact Payees.Name, exact Aliases.Alias, or regex Patterns): use that payee.
   - If the matched payee differs from the transaction's current linked payee: show a **Single / All / Cancel** dialog. **Single** — updates only this transaction's Payee_ID to the matched payee; old payee stays active; old payee name is saved as an alias of the matched payee. **All** — re-links all transactions from the old payee to the matched payee, deactivates the old payee (`Active=0`), and saves the old name as an Aliases record. **Cancel** — no changes.
   - If the matched payee is the same as the current linked payee but the typed name differs (e.g. typed an alias): save the old name as a new Aliases record for that payee (if not already existing).
2. If the typed name has no match AND the transaction had an existing linked payee: show a **Single / All / Cancel** dialog. **Single** — creates a new payee with the typed name and links only this transaction to it; the old payee is unchanged. **All** — renames the existing payee's Name to the typed value and saves the old name as an Aliases record. **Cancel** — no changes.
3. If the typed name has no match AND there is no prior linked payee: prompt the user to confirm creating a new payee. On confirmation, a new Payees (and initial Aliases) record is created.

After payee resolution, if the resulting Payee_ID differs from the transaction's previous Payee_ID, the Category_ID saved to the current transaction is silently copied to all other unreviewed (Reviewed=0) transactions with the same Payee_ID that are visible in the active tab (same account/payee/category filter). No confirmation is shown.

The Merge button brings a popup window that displays all account's transactions with the exact same Amount. User either picks a transaction from the list and clicks OK or clicks Cancel to close the popup window. If a record is picked in the popup window and OK is chosen, the form's record is updated with Linked_Transaction_ID set to the picked transaction ID, Valid status set to false, record is removed from the table view and the form is reset.

### The Payees Tab

The Payees tab renders all records from the Payees table where Active flag is set to true. The table object displays the following fields in order: Name(Payees.Name), Last Transaction(date of the most recent transaction for this payee from Transactions table). Each payee name works as a hyperlink - when user click on the payee name a new tab is opened that displays all transactions for this Payee ID.

The form on the Payee tab displays the Payee Name(Payees.Name) that can be edited. The form also has the standard New and Accept buttons. The New button resets the form's content and allows creation of a new payee record. The Accept button is shown when any of the form data are changed.

### The Aliases Tab

The Aliases tab renders all records from the Aliases table where Active flag is set to true. The table object displays the following fields in order: Alias(Aliases.Alias), Name(Payees.Name). Each payee name works as a hyperlink - when user click on the payee name a new tab is opened that displays all transactions for this Payee ID.

The form on the Aliases tab displays the Payee Alias(PayeeAlias.Alias) and Payee Name(Payees.Name). Alias field can be edited and Payee field works like a search box. As user types the Payee name a list of matching Payees is displayed. User then is able to select a desired Payee from the list or enter a new Payee name. The form has New, Convert to Pattern, and Accept buttons. The New button resets the form's content and allows creation of a new alias record. The Accept button is shown when any of the form data are changed. When user clicks the Accept button and the Payee name does not exist in the Payee table, user is asked for a confirmation that they indeed want to create a new Payee record. In that case a new Payee record is created and the alias record is created/updated per the scenario (New or Edit). The Convert to Pattern button is shown when a row is selected (hidden in New mode); clicking it opens a prompt dialog pre-filled with the current alias text, allowing the user to edit it into a regular expression. If the user clicks OK, the entered value is validated as a regex (invalid regex shows an error and stops); if valid, a new PayeePattern record is created using the entered pattern. If the user clicks Cancel, nothing happens.

### The Patterns Tab

The Patterns tab renders all records from the Patterns table where Active flag is set to true. The table object displays the following fields in order: Pattern(Patterns.Pattern), Name(Payees.Name). Each payee name works as a hyperlink - when user click on the payee name a new tab is opened that displays all transactions for this Payee ID.

The form on the Patterns tab displays the Payee Pattern(PayeePattern.Pattern) and Payee Name(Payees.Name). Pattern field can be edited and Payee field works like a search box. As user types the Payee name a list of matching Payees is displayed. User then is able to select a desired Payee from the list or enter a new Payee name. The form has the standard New and Accept buttons. The New button resets the form's content and allows creation of a new pattern record. The Accept button is shown when any of the form data are changed. When user clicks the Accept button and the Payee name does not exist in the Payee table, user is asked for a confirmation that they indeed want to create a new Payee record. In that case a new Payee record is created and the pattern record is created/updated per the scenario (New or Edit).

### The Category Tab

The Category tab renders all records from the Categories table where Active flag is set to true. The table object displays the following fields in order: Name(Categories.Name), Type(Categories.Type), Last Transaction(date of the most recent transaction for this category from Transactions table). Each category name works as a hyperlink - when user click on the category name a new tab is opened that displays all transactions for this Category ID.

The form on the Category tab displays the Category Name(Categories.Name) in the left column and Type(Categories.Type) as a dropdown (Expense / Income / Other) in the middle column. Both fields can be edited. The form has the standard New and Accept buttons. The New button resets the form and defaults Type to Expense. The Accept button is shown when any of the form data are changed.

### The Query Tab

Multiple Query tabs may be open simultaneously (tab IDs `qry-1`, `qry-2`, …). Each Query tab is closeable. There is no form zone — the tab is divided into two vertical areas:

- **SQL zone** (top, 15% of tab height): a toolbar row with an "SQL" label and a Run button, plus a monospace `<textarea>` that fills the remaining height of the zone. Placeholder text is `SELECT * FROM Accounts;`.
- **Results zone** (bottom, 85% of tab height): a Tabulator table with `autoColumns: true` that is generated dynamically from whatever the query returns.

Execution is triggered by clicking Run or pressing Ctrl+Enter inside the textarea. `DB.query(sql)` is called; if it throws, the error message is displayed in red monospace in the results zone. If the query returns 0 rows, a "Query executed. No rows returned." message is shown. Otherwise a Tabulator table is built with columns auto-generated from the result set. Each subsequent run destroys the previous Tabulator instance before creating a new one. The Refresh button in the tab strip has no effect on Query tabs (user controls execution explicitly).

---

## Additional Logic

Every time when a transaction is "deleted" or "unmerged", the account balance in the Accounts table should be updated.

When recalculating Account.Balance after a delete or unmerge, start from the transaction immediately preceding the affected transaction by Transaction_ID (within the same account, valid, non-linked). Compute the cumulative sum from Starting_Balance up to and including the predecessor, then sum forward from there to get the new Account.Balance. If no predecessor exists, recompute fully from Starting_Balance.

When a transaction of Type=Transfer is invalidated (Delete key), both sides of the Transfer pair are invalidated together. The paired transaction is located by querying for a record where `Account_ID = Transfer_Account_ID` and `Transfer_Account_ID = this account's ID` and `Type = 'Transfer'` and `Valid = 1`. The user is shown a specific confirmation message noting that both transactions will be removed. Account balances are recalculated on both accounts. If no paired transaction is found (e.g. already deleted), only the selected transaction is invalidated.

---

## Development Notes

- All dependencies (`sql.js`, WASM binary) must be stored locally under `lib/` — no CDN fetches, as `file://` protocol makes cross-origin requests unreliable
- Do not introduce a build step, bundler, or package manager — the app must remain a directly openable HTML file
- Keep all JS in `index.html` or as plain `.js` files loadable via `<script src="">` — no ES module imports from `file://` unless Chromium flags explicitly permit them
- Prefer simplicity: this is a single-user local tool, not a web service
- All JS objects are globals (no ES module export/import); load order in `index.html` is the dependency order
- Dates are stored as ISO strings (`YYYY-MM-DD`) in SQLite
- Notify open tabs of data changes via `App.onDataChanged(accountId)` and `App.onPayeesChanged()`
- `DB.lookupPayee(name)` — 3-step resolution: (1) exact Payees.Name, (2) exact Aliases.Alias, (3) regex against Patterns ordered by Pattern_ID (JS-evaluated, first match wins)
- `DB.createPayee(name, withAlias=true)` — form paths pass default (creates Payees + Aliases record); import path passes `false` (Payees only, no alias)
- No welcome screen; app starts immediately with an Accounts tab and either a loaded or new empty database
- `App.Tabs.closeAll()` + `AccountsTab.open()` = `resetTabs()` — called on File > New and File > Open
- `_lastFileHandle` (`FileSystemFileHandle`) is persisted to and loaded from IndexedDB (`MoneyApp` / `handles` / `'dbFile'`) across Chromium restarts; updated on every successful Open or Save; on first launch with URL params it is bootstrapped by calling `showOpenFilePicker` once (silently skipped if Chromium requires a user gesture); File > Open uses `showOpenFilePicker()` with `id: 'money-db'` and `startIn: _lastFileHandle` when available; File > Save uses `showSaveFilePicker()` with `id: 'money-db'`, `suggestedName` pre-filled from `_lastPrefix + timestamp`, and `startIn: _lastFileHandle` when available; File > Import uses `id: 'money-import'` (separate MRU folder) and `startIn: _lastImportHandle` — note: the File System Access API does not support starting pickers at arbitrary path strings; folder memory is established via handles only
- Saved files should go into the `data/` subfolder so `launch.bat` auto-detects them on next launch
- Transactions tab supports multiple simultaneous instances; form element IDs are scoped per tab using `ft-<tabId>-<fieldName>`; access via `fld(inst, name)` helper — never use bare `getElementById('ft-*')` in that module
- Window close protection uses `beforeunload` with `e.preventDefault()` + `e.returnValue = ''`; modern Chromium ignores any custom message string and shows its own native dialog — custom dialogs in `beforeunload` are not supported

---

## Build Status

### Completed
- `money.bat` — accepts optional first argument as DATA_DIR override (default `<appDir>\data`); creates DATA_DIR if absent; scans it for most recent `.db`; launches Chromium with `?dataDir=<path>&db=<filename>` URL parameters (backslashes converted to forward slashes, spaces encoded as `%20`)
- `lib/` — sql.js 1.12.0 (`sql-wasm.js` + `sql-wasm.wasm`) and Tabulator 6.3.0 downloaded locally
- `js/schema.js` — full SQLite schema (`Accounts`, `Payees`, `Aliases`, `Patterns`, `Categories`, `Transactions`, `Mappings`) with indexes and seed data
- `js/db.js` — database layer: `init`, `createNew`, `loadFromBytes` (runs `CREATE TABLE IF NOT EXISTS Mappings`, `ALTER TABLE Mappings ADD COLUMN Negate`, `ALTER TABLE Categories ADD COLUMN Type` to migrate older databases), `exportBytes`, `query`, `run`, `queryOne`, `lookupPayee` (3-step: Payees → Aliases → Patterns regex), `getLastCategory`, `createPayee(name, withAlias=true)`, `recalcAccountBalance` (predecessor-optimised), `checkRefs`
- `js/dialogs.js` — modal dialog system: `alert`, `confirm`, `confirmSingleAll(title, message)` (three-choice dialog returning `'single'` | `'all'` | `null`), `prompt`, `selectTimeframe()` (dropdown — Year to date / Previous year / All time; resolves `'ytd'` | `'prev'` | `'all'` or null), `selectMergePayees(payees)` (From + To payee dropdowns with same-payee inline validation; resolves `{fromId, toId}` or null), `selectAccount(title, accounts, message, opts)` (opts.showIgnoreKnown adds "Ignore known transactions" checkbox; without option resolves with Account_ID; with option resolves with `{accountId, ignoreKnown}` or null), `confirmAccount(matchedAccount, accounts, opts)` (opts.showIgnoreKnown adds same checkbox; resolves `{accountId, ignoreKnown}` | `{create:true, ignoreKnown}` | null), `selectDbFile`, `mergePopup`, `selectPattern` (pattern picker for Apply Pattern command), `csvColumnMapper(headers, existingMappings)` (CSV column mapping dialog — one row per transaction field with CSV column dropdown + optional regex + Neg checkbox on Amount row; pre-populated from Mappings table where Source=field key, Target=CSV column, Negate=0/1; validates Date+Amount mapped before closing; returns array of `{Source, Target, Pattern, Negate}`), `selectPayeeAndCategory(payees, categories)` (Assign Category dialog — payee dropdown + category dropdown; resolves `{payeeId, categoryId}` or null)
- `js/import.js` — CSV (generic column-mapping dialog, saves/loads mappings from Mappings table including Negate flag, `csvToTransactionsWithMappings` applies negation when `Negate=1` on Amount mapping), OFX/QFX (SGML 1.x and XML 2.x), QIF parsers; payee resolution via `lookupPayee`; new payees created without alias (`createPayee(name, false)`); duplicate detection via `Linked_Transaction_ID`; account balance update after import; OFX account matching via `Reference_ID` only — dialog offers use existing or create new (using `<ORG>` as name, type inferred from `<CCACCTFROM>`/`<BANKACCTFROM>`, currency from `<CURDEF>`, starting balance 0); all account-selection dialogs (CSV, OFX, QIF) include an "Ignore known transactions" checkbox (unchecked by default); when checked, `insertTransactions` skips any incoming transaction whose `Reference_ID` already exists as a valid record for the same account; `_lastImportHandle` tracks the last picked import file and is passed as `startIn` (with `id: 'money-import'`) so the picker reopens in the same folder on subsequent imports
- `js/tab-accounts.js` — Accounts tab: Tabulator table (Name, Type, Balance, Last Transaction, To Review — all via LEFT JOIN on Transactions) + 3-column edit form; account name hyperlinks to Transactions tab; Delete key handler
- `js/tab-transactions.js` — Transactions tab (note: new categories created inline default to Type='Expense'); multiple simultaneous instances (form element IDs scoped per tab as `ft-<tabId>-<field>` via `fld(inst, name)` helper); per-account / per-payee / per-category views; optional `dateFrom`/`dateTo` date range stored per instance and applied in `buildTableData` — used by report-tab drill-through; `openForCategoryFiltered(catId, catName, dateFrom, dateTo, frameKey)` opens a date-filtered category tab with ID `trn-cat-{catId}-{frameKey}`; `openForPayeeFiltered(payeeId, payeeName, dateFrom, dateTo, frameKey)` opens a date-filtered payee tab with ID `trn-payee-{payeeId}-{frameKey}` (both allow YTD/prev/all tabs for the same entity to coexist); Balance column always shown (account views start from Starting_Balance, payee/category views start from 0); bold unreviewed rows; orange linked rows; Accept / Merge / Unmerge control column actions; Action column (title "Action", sortable) shows available commands per row derived from `_actionLabel` field ("Accept", "Merge Unmerge", "Accept Merge Unmerge", or blank); `headerSortTristate: true` set per-column on all sortable columns (table-level option alone not respected by Tabulator 6.3.0); 3-column form (left: Payee or Destination [Transfer only], Memo, Account, Ref ID; middle: Category, Date, Amount+Currency, Type); for Transfer rows the Payee field is hidden and a Destination account-autocomplete field is shown instead — Accept validates and updates Transfer_Account_ID on source and Account_ID on paired transaction; Payee and Category autocomplete; when user selects an existing payee from the autocomplete dropdown and the current transaction's Category_ID is Unassigned (≤1), the Category field is auto-filled with the most recently used category for that payee; Type is read-only/derived (Credit/Debit from amount sign, Transfer via Transfer button); Transfer button creates mirror transaction on destination account; payee change on Accept uses Single/All/Cancel dialog — Single changes only the current transaction, All merges or renames across all transactions; when Payee changes on Accept, silently copies the saved Category_ID to all other unreviewed transactions with the same Payee_ID visible in the current tab; Merge popup; Delete key handler with Transfer-pair invalidation (both sides set Valid=0, both account balances recalculated); `getTabFilters(tabId)` exposes `{accountId, payeeId, catId}` for the Apply Pattern command; on tab open (`tableBuilt` event) auto-scrolls to the first unreviewed row or to the bottom if all rows are reviewed; `refreshInstance` preserves the table's scroll position across `setData` calls so Accept/Merge column actions do not reset the view
- `js/tab-payees.js` — Payees tab: table + 3-column form; payee name hyperlinks to filtered Transactions tab
- `js/tab-aliases.js` — Aliases tab: table + 3-column form with payee autocomplete; Convert to Pattern button (shown when row selected, hidden in New mode) opens a prompt pre-filled with the alias text for user editing into a regex, then validates and creates a Patterns record on OK (Cancel = no-op); payee name hyperlinks to filtered Transactions tab
- `js/tab-patterns.js` — Patterns tab: table + 3-column form with payee autocomplete and regex validation; payee name hyperlinks to filtered Transactions tab
- `js/tab-categories.js` — Categories tab: Tabulator table (Name, Type, Last Transaction) + 3-column form (left: Name; middle: Type dropdown Expense/Income/Other; right: New/Accept buttons); New resets Type to Expense; Accept saves Name and Type; category name hyperlinks to filtered Transactions tab; `loadFromBytes` migration adds Type column with DEFAULT 'Expense' for existing databases
- `js/tab-query.js` — Query tab: multiple simultaneous instances (`qry-N` IDs); SQL textarea (15% height) + Tabulator results table (85% height, `autoColumns: true`); Run button and Ctrl+Enter execute `DB.query()`; errors shown inline in red; previous Tabulator instance destroyed before each new run; `removeInstance()` cleans up on tab close
- `js/app.js` — main application: tab registry (`App.Tabs`), menu wiring (File/View/Reports/Tools), file I/O (`showOpenFilePicker` / `showSaveFilePicker`), URL-param DB auto-load (`?dataDir=` + `?db=`; `_dataDirUrl` built from `dataDir` param or falls back to `{pageDir}data`), timestamped save with last-file prefix and folder defaults (`_lastPrefix`, `_lastFileHandle`, `_dataDirUrl`, `_extractPrefix`); `_lastFileHandle` persisted to/from IndexedDB via `_saveHandleToIDB` / `_loadHandleFromIDB` (`MoneyApp` DB, `handles` store, key `'dbFile'`); Open/Save both use `id: 'money-db'` for cross-session folder memory; `cmdApplyPattern` (Tools > Apply pattern), `cmdRemoveDuplicates` (Tools > Remove duplicates — account picker, hard-deletes unreviewed transactions whose Reference_ID matches a reviewed valid transaction on the same account, nullifies FK references first, recalculates balance), `cmdAssignCategory` (Tools > Assign category — requires active Transactions tab; user picks a payee and a target category; updates Category_ID on all valid transactions for that payee visible in the tab; shows count on completion), `cmdMemoToPayee` (Tools > Memo to payee — account picker; finds valid transactions with Payee_ID IS NULL and non-empty Memo; applies 3-step import payee resolution using Memo as payee name; sets Category_ID to last-used category for resolved payee or 1; refreshes all open tabs; shows count), `cmdMergePayees` (Tools > Merge payees — From/To payee picker; updates Payee_ID on all valid transactions from the source payee to the target; does not deactivate the source payee; refreshes all open tabs; shows count), `cmdRefreshTab` (Refresh button — dispatches to active tab's refresh function; no-op for Query tabs), Delete key dispatcher, cross-tab refresh events, `resetTabs()` on open/new, `beforeunload` guard; `Tabs.close` and `Tabs.closeAll` call `QueryTab.removeInstance()` for `qry-*` tab IDs
- `js/tab-report-category.js` — Spend by Category report (`SpendByCategoryReport`): `open()` prompts for time frame via `selectTimeframe`, then opens a closeable tab (`rpt-cat-N`) with plain-HTML table of Expense-category totals for the period; amounts computed as `-SUM(Amount)` (positive = net spend); sorted descending; Grand Total row in `<tfoot>`; empty-period message if no rows; category names are hyperlinks — clicking one calls `TransactionsTab.openForCategoryFiltered` with the category ID/name and the report's date range and frame key
- `js/tab-report-payee.js` — Spend by Payee report (`SpendByPayeeReport`): same structure as category report but groups by Payee; SQL joins Transactions → Categories (filter `Type='Expense'`) → Payees; transactions with no payee shown as "Unassigned" (no hyperlink); payee name hyperlinks call `TransactionsTab.openForPayeeFiltered`; tab IDs `rpt-pay-N`
- `app.css` — full application styles; `#tab-strip` (flex row wrapper for tab bar + refresh button); `#tab-bar` (scrollable inner flex container, `flex: 1`); `#tab-refresh` (SVG icon button anchored at right end of strip); 3-column form layout (`.form-col`, `.form-col-btns`, `.form-field`, `.btn-spacer`); `.form-readonly` for informational fields; `.amt-cur` for Amount+Currency inline pair; `.qry-*` styles for Query tab layout; `.dlg-xl` (680px wide dialog), `.csv-map-grid` (4-column: 120px field label | 1fr CSS dropdown | 1fr pattern | 48px Neg) / `.csv-map-hdr` / `.csv-map-field` / `.csv-map-src` / `.csv-map-pattern` / `.csv-neg-label` / `.csv-map-err` for CSV column mapping dialog; `.dlg-checkbox-label` for checkbox rows in dialogs; `.rpt-*` styles for Report tab layout (scrollable padded area, dark header row, alternating body rows, bold grand-total footer row)
- `index.html` — single HTML entry point (no welcome screen; `#app` always visible); menu order: File / View / Reports / Tools

### Not Yet Implemented
- All planned features are implemented.
