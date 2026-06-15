# Money Tracker

A personal finance application for reviewing, categorising, and reporting on credit card and bank transactions. Runs entirely offline — no server, no cloud, no installation. The application is inspired by the venerable Microsoft Money app https://en.wikipedia.org/wiki/Microsoft_Money. 

---

## Concepts

- Each **transaction** is associated with an **account** and is linked to a **payee** and a **category**.
- Transactions with negative amounts are considered **debit** transactions and transactions with positive amounts are considered **credit** transaction.
- **Transfer** transactions are always paired: a debit transaction in one account is paired with a symmetrical credit transaction in another account.
- **Payee** is a logical entity that links similar transactions such as a store chain, or a comapny, or a naming umbrella for reporting convenience.
- **Category** is a user-defined label attached to transactions for groupping purposes. Categories can be typed as **Expense**, **Income** or **Other**. There are two built-in categories: **Unassigned** and **Transfer**, they should not be renamed or deleted.

---

## Getting Started

Download a standalone version of Chromium, unpack and place it into the `chrome\` folder. The application expects `chrome\chrome.exe`.
Windows version download is available here: https://github.com/Hibbiki/chromium-win64, MacOS version download is available here: https://chromium.woolyss.com/download/#mac-arm. On MacOS use `xattr -cr /Applications/Chromium.app` to prevent system errors when launching the Chromium app.

Double-click **`money.bat`** to launch the application. On first run it creates a `data\` folder next to the batch file and opens an empty database. Use **File › Save** to give it a name. If you prefer a different location for the database files, provide the data folder location as a command line argument or edit `money.bat` to change the default value.

On subsequent launches `money.bat` automatically opens the most recently saved database file from the `data\` folder.

---

## File Management

| Command | What it does |
|---|---|
| **File › New** | Creates a fresh empty database in memory |
| **File › Open** | Loads any `.db` file from disk |
| **File › Save** | Writes the current database to a new timestamped file |
| **File › Import** | Imports transactions from CSV, OFX, QFX, or QIF files |

**Tip — automatic backups:** every Save writes a *new* file (`money_202506121430.db`). The previous file is never overwritten, so your entire save history is preserved in the `data\` folder. To recover an older version just open it with File › Open.

---

## Importing Transactions

Select **File › Import** and pick a file. The application auto-detects the format.

- **OFX / QFX** — the account is matched automatically by its account number. You confirm the match or choose a different account, or create a new one.
- **CSV** — requires the destination account to be created beforehad. A column-mapping dialog appears so you can tell the application which CSV column maps to Date, Amount, Payee, etc. Mappings are saved and pre-filled on the next import from a similar file. Tick **Neg** on the Amount row if your bank exports debits as positive numbers.
- **QIF** — you select the destination account manually.

**Tip — skip already-imported transactions:** the account selection dialog includes an **Ignore known transactions** checkbox. When checked, any incoming transaction whose Reference ID already exists in that account is silently skipped. Use this when re-importing a file that overlaps with previously imported data.

**Tip — payee resolution on import:** the application tries to match each imported payee name in order — (1) exact match against known payee names, (2) exact match against aliases, (3) regex match against patterns. If no match is found a new payee is created automatically.

---

## Accounts Tab

Shows all active accounts with their current balance and a count of unreviewed transactions.

- Click an **account name** to open a Transactions tab for that account.
- Use the form at the bottom to edit account details or create a new account with the **New** button.
- Press **Delete** key with an account selected in the tabular view to deactivate it (only allowed if no transactions reference it).

---

## Transactions Tab

Multiple Transactions tabs can be open at the same time — one per account, payee, or category view.

### Reviewing transactions

Unreviewed transactions are shown in **bold**. Click **Accept** in the Action column (or press **Enter**) to mark a transaction as reviewed. Use **↑ / ↓ arrow keys** to move between rows without using the mouse.

### Editing a transaction

Click any row to load it into the form. Edit the fields, then click **Accept** to save. The Accept button also appears whenever the selected transaction is unreviewed, so one click both saves edits and marks it reviewed. To discard the changes simply navigate to another transaction record with clicking **Accept**.

**Tip — payee auto-fill:** when you select an existing payee from the autocomplete dropdown and the transaction's category is Unassigned, the category field is automatically filled with the most recent category used for that payee.

**Tip — changing a payee name:** if you type a new name in the Payee field and the name doesn't match any existing payee, a dialog asks whether you want to rename for **All** transactions (renames the payee record and saves the old name as an alias) or just this **Single** transaction (creates a new payee and keeps the old one). Similarly, if the new name matches a *different* existing payee you can merge all transactions or only reassign the current one.

### Transfers

Click **Transfer** to convert a transaction into a transfer between accounts. The application creates a mirror transaction on the destination account and keeps both sides linked. When you delete a transfer, both sides are removed together.

### Duplicate detection

Transactions that share the same date, account, and amount as an older transaction are flagged as potential duplicates and shown with an **orange background**, immediately after the transaction they may duplicate. Use **Merge** to confirm the duplicate (hides it) or **Unmerge** to treat it as independent.

### Balance column

- In an account view the running balance starts from the account's opening balance.
- In payee or category filtered views the balance starts from zero and accumulates across the displayed transactions.
- Linked (duplicate) transactions are excluded from the running balance.

---

## Payees Tab

Lists all payees. Click a payee name to open a Transactions tab showing all transactions for that payee.

**Tip — editing a payee name:** after you click Accept the table stays centred on the edited row — no scroll-to-top. The same is true for Aliases and Categories.

---

## Aliases Tab

Aliases are alternative names for a payee — typically the raw name that appears on a bank statement. When a transaction is imported with a name that matches an alias, it is automatically linked to the associated payee.

- Click **Convert to Pattern** to promote an alias to a regex pattern (useful when the raw name has a variable suffix like an order number).

---

## Patterns Tab

Patterns are regular expressions matched against imported payee names when no exact alias match is found. Patterns are tested in the order they were created; the first match wins.

**Example:** the pattern `^AMAZON.*` matches `AMAZON MARKETPLACE`, `AMAZON PRIME`, `AMAZON WEB SERVICES`, etc. and links them all to the same "Amazon" payee.

---

## Categories Tab

Lists all active categories. Click a category name to open a Transactions tab filtered to that category. Categories have a type: **Expense**, **Income**, or **Other**. Only the **Expense** transactions appear in the spending reports.

---

## Tools

### Apply pattern
Requires an open Transactions tab. Select a regex pattern and the application tests it against the Memo field of every unreviewed transaction visible in that tab. Matched transactions have their payee updated, and if the payee has any reviewed transactions their category is copied across too.

**Tip:** run this after importing a batch of new transactions to quickly assign payees to anything with a recognisable memo.

### Remove duplicates
Select an account. The tool finds unreviewed transactions whose Reference ID exactly matches a reviewed transaction in the same account and hard-deletes the unreviewed copy. Useful after importing a statement that overlaps with a previously reviewed import.

### Assign category
Requires an open Transactions tab. Pick a payee and a category — all valid transactions for that payee visible in the active tab are updated to the chosen category. The tab's account and category filters are respected.

### Memo to payee
Select an account. The tool finds valid transactions with no assigned payee but a non-empty Memo, then applies the standard payee-resolution logic using the Memo value as the payee name. Useful for weird transaction exports where payee field is not populated.

### Merge payees
Pick a **From** payee and a **To** payee. All valid transactions from the From payee are reassigned to the To payee. The From payee record is not automatically deactivated — delete it manually from the Payees tab afterwards if needed.

### Query database
Opens a SQL editor tab to interrogate the in-memory database. Write any SELECT query and press **Run** or **Ctrl+Enter** to execute it. Results appear in a table below. Multiple Query tabs can be open at once.

---

## Reports

### Spend by Category / Spend by Payee

Both reports ask for a time frame — **Year to date**, **Previous year**, or **All time** — then display a table of totals drawn from transactions in Expense-type categories, sorted from highest to lowest spend.

- Click any **category or payee name** in the report to open a Transactions tab showing the individual transactions that contributed to that total, pre-filtered to the same date range.
- Multiple report tabs can be open at once with different time frames.
- Only transactions categorized as **Expnse** are considered for the reports.

---

## Keyboard Shortcuts

| Key | Context | Action |
|---|---|---|
| **Delete** | Any tab with a selected row | Delete / deactivate the selected record |
| **Enter** | Transactions tab | Accept (review) the selected transaction |
| **↑ / ↓** | Transactions tab | Move selection up / down |
| **Y** | Yes/No dialog | Click Yes |
| **N** | Yes/No dialog | Click No |
| **Tab** | Yes/No dialog | Toggle focus between Yes and No |
| **Enter** | Yes/No dialog | Click the focused button |
| **Ctrl+Enter** | Query tab | Run the SQL query |

---

## Data Storage

The database is a standard SQLite file (`.db`). It is loaded entirely into memory while the application is running. All changes are **in-memory only** until you explicitly save.

**Always save before closing the browser window.** The application will warn you if you try to close with an open database, but the warning is the browser's native dialog — no custom message is shown.
