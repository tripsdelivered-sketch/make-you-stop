CREATE TABLE IF NOT EXISTS deliverable_asset_provenance (
  provenance_id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  deliverable_id TEXT NOT NULL,
  render_id TEXT,
  scene_number INTEGER NOT NULL,
  asset_id TEXT NOT NULL,
  origin_order_id TEXT NOT NULL,
  origin_job_id TEXT NOT NULL,
  customer_id TEXT,
  brand_id TEXT,
  source_type TEXT NOT NULL,
  media_type TEXT NOT NULL,
  mime_type TEXT,
  source_fingerprint TEXT NOT NULL,
  reuse_permission TEXT NOT NULL,
  assignment_status TEXT,
  assignment_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (deliverable_id, render_id, scene_number, asset_id)
);

CREATE INDEX IF NOT EXISTS idx_deliverable_asset_provenance_order
  ON deliverable_asset_provenance (order_id, job_id);

CREATE INDEX IF NOT EXISTS idx_deliverable_asset_provenance_deliverable
  ON deliverable_asset_provenance (deliverable_id, render_id);

CREATE INDEX IF NOT EXISTS idx_deliverable_asset_provenance_asset
  ON deliverable_asset_provenance (asset_id);
