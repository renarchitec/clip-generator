use super::*;
use rusqlite::{params, Connection, OptionalExtension, Row};

fn is_legacy_prisma_db(path: &Path) -> bool {
    if !path.is_file() {
        return false;
    }
    let Ok(conn) = Connection::open(path) else {
        return false;
    };
    let mut stmt = match conn.prepare("PRAGMA table_info(clips)") {
        Ok(s) => s,
        Err(_) => return false,
    };
    let cols: Vec<String> = stmt
        .query_map([], |r| r.get::<_, String>(1))
        .ok()
        .map(|rows| rows.filter_map(Result::ok).collect())
        .unwrap_or_default();
    !cols.is_empty() && !cols.iter().any(|c| c == "job_id")
}

pub(crate) fn open(dir: &Path) -> anyhow::Result<Connection> {
    let default_path = dir.join("dartclip.db");
    let db_path = if is_legacy_prisma_db(&default_path) {
        dir.join("dartclip-local.db")
    } else {
        default_path
    };
    let db = Connection::open(db_path)?;
    db.busy_timeout(std::time::Duration::from_secs(5))?;
    db.execute_batch(include_str!("schema.sql"))?;
    db.execute("UPDATE jobs SET status='failed', error='The desktop app closed before this job finished', finished_at=?1, updated_at=?1 WHERE status IN ('queued','running')", [now()])?;
    Ok(db)
}

fn json_field(row: &Row<'_>, name: &str, default: Value) -> rusqlite::Result<Value> {
    let Some(text) = row.get::<_, Option<String>>(name)? else {
        return Ok(default);
    };
    serde_json::from_str(&text).map_err(|e| {
        rusqlite::Error::FromSqlConversionFailure(
            row.as_ref().column_index(name).unwrap_or_default(),
            rusqlite::types::Type::Text,
            Box::new(e),
        )
    })
}

pub(crate) fn job(row: &Row<'_>) -> rusqlite::Result<Value> {
    Ok(json!({
        "id":row.get::<_,String>("id")?, "url":row.get::<_,String>("url")?,
        "status":row.get::<_,String>("status")?, "stage":row.get::<_,Option<String>>("stage")?,
        "progress":row.get::<_,f64>("progress")?, "mode":row.get::<_,String>("mode")?,
        "reframe":row.get::<_,String>("reframe")?, "captions":row.get::<_,bool>("captions")?,
        "twoSpeakers":row.get::<_,bool>("two_speakers")?, "facecam":row.get::<_,bool>("facecam")?,
        "aspectRatio":row.get::<_,String>("aspect_ratio")?, "captionLanguage":row.get::<_,String>("caption_language")?,
        "customHashtags":json_field(row,"custom_hashtags_json",json!([]))?, "maxSourceSec":row.get::<_,Option<i64>>("max_source_sec")?,
        "description":row.get::<_,Option<String>>("description")?, "clipCount":row.get::<_,i64>("clip_count")?,
        "targetDurationSec":row.get::<_,f64>("target_duration_sec")?, "ranges":json_field(row,"ranges_json",Value::Null)?,
        "captionStyle":json_field(row,"caption_style_json",Value::Null)?, "watermark":json_field(row,"watermark_json",Value::Null)?,
        "outro":json_field(row,"outro_json",Value::Null)?, "hookBanner":row.get::<_,bool>("hook_banner")?,
        "normalizeAudio":row.get::<_,bool>("normalize_audio")?, "error":row.get::<_,Option<String>>("error")?,
        "message":row.get::<_,Option<String>>("message")?, "createdAt":row.get::<_,String>("created_at")?,
        "updatedAt":row.get::<_,String>("updated_at")?, "startedAt":row.get::<_,Option<String>>("started_at")?,
        "finishedAt":row.get::<_,Option<String>>("finished_at")?,
    }))
}

pub(crate) fn clip(row: &Row<'_>) -> rusqlite::Result<Value> {
    Ok(json!({
        "id":row.get::<_,String>("id")?, "title":row.get::<_,String>("title")?,
        "startSec":row.get::<_,f64>("start_sec")?, "endSec":row.get::<_,f64>("end_sec")?,
        "createdAt":row.get::<_,String>("created_at")?, "downloadedAt":row.get::<_,Option<String>>("downloaded_at")?,
        "deletedAt":null, "caption":row.get::<_,Option<String>>("caption")?,
        "hashtags":json_field(row,"hashtags_json",json!([]))?, "platformCaptions":json_field(row,"platform_captions_json",Value::Null)?,
        "viralScore":row.get::<_,Option<i64>>("viral_score")?, "hookText":row.get::<_,Option<String>>("hook_text")?, "publications":[],
    }))
}

pub(crate) fn snapshot(db: &Connection, id: &str) -> ApiResult<Value> {
    let mut value = db.query_row("SELECT * FROM jobs WHERE id=?", [id], job)?;
    attach_clips(db, &mut value)?;
    Ok(value)
}
pub(crate) fn attach_clips(db: &Connection, job: &mut Value) -> ApiResult<()> {
    let mut query = db.prepare("SELECT * FROM clips WHERE job_id=? ORDER BY start_sec, rowid")?;
    let clips = query
        .query_map([job["id"].as_str()], clip)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    job["clipsCount"] = json!(clips.len());
    job["clips"] = json!(clips);
    Ok(())
}

pub(crate) fn setting(db: &Connection, key: &str) -> ApiResult<Value> {
    Ok(db
        .query_row(
            "SELECT value_json FROM kv_settings WHERE key=?",
            [key],
            |r| json_field(r, "value_json", Value::Null),
        )
        .optional()?
        .unwrap_or(Value::Null))
}
pub(crate) fn set_setting(db: &Connection, key: &str, value: &Value) -> ApiResult<()> {
    db.execute("INSERT INTO kv_settings (key,value_json) VALUES (?1,?2) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json", params![key, value.to_string()])?;
    Ok(())
}

pub(crate) fn brief(row: &Row<'_>) -> rusqlite::Result<Value> {
    Ok(
        json!({"id":row.get::<_,String>("id")?, "text":row.get::<_,String>("text")?, "useCount":row.get::<_,i64>("use_count")?, "lastUsedAt":row.get::<_,String>("last_used_at")?, "createdAt":row.get::<_,String>("created_at")?}),
    )
}
pub(crate) fn record_brief(db: &Connection, text: &str) -> ApiResult<Value> {
    let record = db.query_row("INSERT INTO brief_history (id,text,use_count,last_used_at,created_at) VALUES (?1,?2,1,?3,?3) ON CONFLICT(text) DO UPDATE SET use_count=use_count+1,last_used_at=excluded.last_used_at RETURNING *", params![id(),text,now()], brief)?;
    db.execute("DELETE FROM brief_history WHERE id IN (SELECT id FROM brief_history ORDER BY last_used_at DESC,rowid DESC LIMIT -1 OFFSET 30)", [])?;
    Ok(record)
}
