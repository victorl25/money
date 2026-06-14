/* Database schema and seed data */

const SCHEMA_SQL = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS Accounts (
  Account_ID       INTEGER PRIMARY KEY AUTOINCREMENT,
  Reference_ID     TEXT,
  Name             TEXT    NOT NULL,
  Type             TEXT    NOT NULL DEFAULT 'Bank',
  Starting_Balance REAL    DEFAULT 0,
  Balance          REAL    DEFAULT 0,
  Last_Updated     TEXT,
  Currency         TEXT    DEFAULT 'USD',
  Active           INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS Payees (
  Payee_ID INTEGER PRIMARY KEY AUTOINCREMENT,
  Name     TEXT    NOT NULL,
  Active   INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS Aliases (
  Alias_ID  INTEGER PRIMARY KEY AUTOINCREMENT,
  Payee_ID  INTEGER NOT NULL,
  Alias     TEXT    NOT NULL,
  Active    INTEGER DEFAULT 1,
  FOREIGN KEY (Payee_ID) REFERENCES Payees(Payee_ID)
);

CREATE INDEX IF NOT EXISTS idx_aliases_alias ON Aliases(Alias);

CREATE TABLE IF NOT EXISTS Patterns (
  Pattern_ID INTEGER PRIMARY KEY AUTOINCREMENT,
  Payee_ID   INTEGER NOT NULL,
  Pattern    TEXT    NOT NULL,
  Active     INTEGER DEFAULT 1,
  FOREIGN KEY (Payee_ID) REFERENCES Payees(Payee_ID)
);

CREATE INDEX IF NOT EXISTS idx_patterns_payee ON Patterns(Payee_ID);

CREATE TABLE IF NOT EXISTS Categories (
  Category_ID INTEGER PRIMARY KEY AUTOINCREMENT,
  Name        TEXT    NOT NULL,
  Type        TEXT    DEFAULT 'Expense',
  Active      INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS Transactions (
  Transaction_ID      INTEGER PRIMARY KEY AUTOINCREMENT,
  Reference_ID        TEXT,
  Date                TEXT    NOT NULL,
  Memo                TEXT,
  Account_ID          INTEGER NOT NULL,
  Transfer_Account_ID INTEGER,
  Payee_ID            INTEGER,
  Category_ID         INTEGER,
  Amount              REAL    NOT NULL,
  Type                TEXT    NOT NULL DEFAULT 'Debit',
  Currency            TEXT    DEFAULT 'USD',
  Reviewed            INTEGER DEFAULT 0,
  Linked_Transaction_ID INTEGER,
  Valid               INTEGER DEFAULT 1,
  FOREIGN KEY (Account_ID)          REFERENCES Accounts(Account_ID),
  FOREIGN KEY (Transfer_Account_ID) REFERENCES Accounts(Account_ID),
  FOREIGN KEY (Payee_ID)            REFERENCES Payees(Payee_ID),
  FOREIGN KEY (Category_ID)         REFERENCES Categories(Category_ID),
  FOREIGN KEY (Linked_Transaction_ID) REFERENCES Transactions(Transaction_ID)
);

CREATE INDEX IF NOT EXISTS idx_trn_date     ON Transactions(Date);
CREATE INDEX IF NOT EXISTS idx_trn_account  ON Transactions(Account_ID);
CREATE INDEX IF NOT EXISTS idx_trn_payee    ON Transactions(Payee_ID);
CREATE INDEX IF NOT EXISTS idx_trn_category ON Transactions(Category_ID);

CREATE TABLE IF NOT EXISTS Mappings (
  Mapping_ID INTEGER PRIMARY KEY AUTOINCREMENT,
  Source     TEXT    NOT NULL UNIQUE,
  Target     TEXT    NOT NULL,
  Pattern    TEXT,
  Negate     INTEGER DEFAULT 0
);
`;

const SEED_SQL = `
INSERT INTO Categories (Category_ID, Name, Type, Active) VALUES (1, 'Unassigned', 'Expense', 1);
INSERT INTO Categories (Category_ID, Name, Type, Active) VALUES (2, 'Transfer', 'Other', 1);
`;
