-- db/schema.sql — Cloudflare D1 (SQLite). Free tier: 5 GB, plenty for leads.
-- Create once:   npx wrangler d1 create apexforge-leads
-- Apply:         npx wrangler d1 execute apexforge-leads --remote --file db/schema.sql
-- One database serves every site; the `site` column separates them.

CREATE TABLE IF NOT EXISTS leads (
  id             TEXT PRIMARY KEY,          -- uuid
  created_at     TEXT NOT NULL,             -- ISO timestamp (UTC)
  site           TEXT NOT NULL,             -- site slug
  vertical       TEXT NOT NULL,
  service        TEXT,
  first_name     TEXT, last_name TEXT,
  email          TEXT,
  phone          TEXT,                      -- E.164 (+1XXXXXXXXXX)
  zip            TEXT, city TEXT,
  answers_json   TEXT,                      -- all vertical-specific answers
  score          INTEGER, tier TEXT, suggested_price REAL,
  duplicate_of   TEXT,                      -- id of earlier lead w/ same phone+site (30 days)

  -- Operator CRM fields
  status         TEXT NOT NULL DEFAULT 'new',   -- new|contacted|qualified|sold|returned|dnc|bad
  buyer          TEXT,                          -- who bought / was routed
  sold_price     REAL,
  notes          TEXT,
  updated_at     TEXT,

  -- Consent proof (keep 5+ years). Never edit these after insert.
  consent_text   TEXT NOT NULL,
  consent_hash   TEXT NOT NULL,             -- sha256 of consent_text
  consent_at     TEXT NOT NULL,
  ip             TEXT, user_agent TEXT, page_url TEXT, referrer TEXT,
  utm_json       TEXT,
  time_on_page_s INTEGER,

  -- Optional Koinos settlement (hash only — never PII on chain)
  lead_hash      TEXT,                      -- sha256(id|phone|created_at|site)
  chain_tx       TEXT
);

CREATE INDEX IF NOT EXISTS idx_leads_site_created ON leads(site, created_at);
CREATE INDEX IF NOT EXISTS idx_leads_phone ON leads(phone, site);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_ip_created ON leads(ip, created_at);
