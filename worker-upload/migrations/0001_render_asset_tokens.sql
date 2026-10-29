CREATE TABLE IF NOT EXISTS render_asset_tokens (
  token_hash TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER,
  display_name TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_render_asset_tokens_asset
ON render_asset_tokens(asset_id);
