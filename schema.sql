CREATE TABLE IF NOT EXISTS persone (
  id TEXT PRIMARY KEY,
  nome TEXT, cognome TEXT, anno INTEGER, scuola TEXT, zona TEXT, tel TEXT, note TEXT,
  ruolo TEXT NOT NULL CHECK (ruolo IN ('staff','capo','pr')),
  parent TEXT,
  no_stat INTEGER NOT NULL DEFAULT 0, -- fuori dai grafici di anno, scuola e zona
  creato_da TEXT,
  aggiornato TEXT
);
CREATE INDEX IF NOT EXISTS persone_parent ON persone(parent);
CREATE TABLE IF NOT EXISTS locali (
  id TEXT PRIMARY KEY,
  nome TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('locale','format')),
  eta_min INTEGER,
  misura TEXT -- solo format: 'persone' o 'incasso'
);
CREATE TABLE IF NOT EXISTS serate (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  nome TEXT,
  loc TEXT,
  fmt TEXT
);
CREATE TABLE IF NOT EXISTS risultati (
  serata_id TEXT NOT NULL,
  persona_id TEXT NOT NULL,
  b INTEGER NOT NULL DEFAULT 0,
  t INTEGER NOT NULL DEFAULT 0,
  e INTEGER NOT NULL DEFAULT 0, -- incasso tavoli in centesimi
  PRIMARY KEY (serata_id, persona_id)
);
CREATE INDEX IF NOT EXISTS risultati_persona ON risultati(persona_id);
CREATE TABLE IF NOT EXISTS utenti (
  email TEXT PRIMARY KEY,
  ruolo TEXT NOT NULL CHECK (ruolo IN ('admin','staff')),
  persona_id TEXT
);
CREATE TABLE IF NOT EXISTS impostazioni (
  chiave TEXT PRIMARY KEY, -- stagione_inizio, punti_persone, punti_euro, punti_segno
  valore TEXT
);
