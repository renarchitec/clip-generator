PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  transcript_source TEXT NOT NULL DEFAULT 'youtube',
  status TEXT NOT NULL DEFAULT 'queued',
  stage TEXT,
  progress REAL NOT NULL DEFAULT 0,
  mode TEXT NOT NULL DEFAULT 'auto',
  reframe TEXT NOT NULL DEFAULT 'face_tracking',
  captions INTEGER NOT NULL DEFAULT 1,
  two_speakers INTEGER NOT NULL DEFAULT 0,
  facecam INTEGER NOT NULL DEFAULT 0,
  aspect_ratio TEXT NOT NULL DEFAULT '9:16',
  caption_language TEXT NOT NULL DEFAULT 'auto',
  custom_hashtags_json TEXT NOT NULL DEFAULT '[]',
  max_source_sec INTEGER,
  description TEXT,
  clip_count INTEGER NOT NULL DEFAULT 3,
  target_duration_sec REAL NOT NULL DEFAULT 45,
  ranges_json TEXT,
  caption_style_json TEXT,
  watermark_json TEXT,
  outro_json TEXT,
  hook_banner INTEGER NOT NULL DEFAULT 0,
  normalize_audio INTEGER NOT NULL DEFAULT 1,
  error TEXT,
  message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT
);
CREATE TABLE IF NOT EXISTS clips (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  start_sec REAL NOT NULL,
  end_sec REAL NOT NULL,
  file_path TEXT NOT NULL,
  caption TEXT,
  hashtags_json TEXT NOT NULL DEFAULT '[]',
  platform_captions_json TEXT,
  transcript TEXT,
  viral_score INTEGER,
  hook_text TEXT,
  created_at TEXT NOT NULL,
  downloaded_at TEXT,
  UNIQUE(job_id, file_path)
);
CREATE INDEX IF NOT EXISTS clips_job_index ON clips(job_id);
CREATE INDEX IF NOT EXISTS clips_created_index ON clips(created_at);
CREATE TABLE IF NOT EXISTS watermarks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  duration_sec REAL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS outros (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  duration_sec REAL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS brief_history (
  id TEXT PRIMARY KEY,
  text TEXT NOT NULL UNIQUE,
  use_count INTEGER NOT NULL,
  last_used_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS kv_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL
);
