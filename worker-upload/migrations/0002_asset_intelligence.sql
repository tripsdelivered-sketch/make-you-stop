CREATE TABLE IF NOT EXISTS asset_intelligence (
  asset_id TEXT PRIMARY KEY,
  origin_order_id TEXT NOT NULL,
  origin_job_id TEXT NOT NULL,
  customer_id TEXT,
  brand_id TEXT,
  reuse_permission TEXT NOT NULL,
  source_fingerprint TEXT NOT NULL,
  media_type TEXT,
  width INTEGER,
  height INTEGER,
  orientation TEXT,
  duration_ms INTEGER,
  product_or_subject_id TEXT,
  asset_role TEXT,
  subject_type TEXT,
  asset_tags_json TEXT,
  analysis_status TEXT NOT NULL
    CHECK (analysis_status IN ('complete', 'uncertain', 'failed')),
  analysis_confidence REAL,
  analysis_version TEXT NOT NULL,
  analyzed_at TEXT NOT NULL,
  cleanup_status TEXT NOT NULL DEFAULT 'not_required'
    CHECK (cleanup_status IN ('not_required', 'pending', 'complete', 'failed_retry')),
  cleanup_attempt_count INTEGER NOT NULL DEFAULT 0,
  last_cleanup_error TEXT,
  next_cleanup_at TEXT,
  analysis_provider_id TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_asset_intelligence_owner
  ON asset_intelligence (customer_id, brand_id);

CREATE INDEX IF NOT EXISTS idx_asset_intelligence_origin
  ON asset_intelligence (origin_order_id, origin_job_id);

CREATE INDEX IF NOT EXISTS idx_asset_intelligence_fingerprint
  ON asset_intelligence (asset_id, source_fingerprint);

CREATE INDEX IF NOT EXISTS idx_asset_intelligence_cleanup
  ON asset_intelligence (cleanup_status, next_cleanup_at);
