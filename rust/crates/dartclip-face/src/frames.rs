use std::{
    io::{ErrorKind, Read},
    path::Path,
    process::{Child, ChildStdout, Command, Stdio},
};

use anyhow::{anyhow, ensure, Context, Result};
use image::RgbImage;
use serde_json::Value;

pub const PROXY_HEIGHT: u32 = 360;

#[derive(Clone, Copy, Debug)]
pub struct VideoInfo {
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    pub duration: f64,
}

impl VideoInfo {
    pub fn proxy_dimensions(self) -> (u32, u32) {
        let h = self.height.min(PROXY_HEIGHT);
        let w = (u64::from(self.width) * u64::from(h) / u64::from(self.height)) as u32;
        (w.max(1), h)
    }
}

fn parse_ratio(ratio: &str) -> Option<f64> {
    let (n, d) = ratio.split_once('/')?;
    let fps = n.parse::<f64>().ok()? / d.parse::<f64>().ok()?;
    (fps.is_finite() && fps > 0.0).then_some(fps)
}

pub fn probe_video(path: impl AsRef<Path>) -> Result<VideoInfo> {
    let path = path.as_ref();
    let mut cmd = Command::new("ffprobe");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    let result = cmd
        .args(["-v", "error", "-select_streams", "v:0", "-show_entries",
            "stream=width,height,avg_frame_rate,r_frame_rate,duration:stream_side_data=rotation:format=duration", "-of", "json", "-i"])
        .arg(path)
        .output().context("could not run ffprobe")?;
    ensure!(
        result.status.success(),
        "ffprobe failed for {}: {}",
        path.display(),
        String::from_utf8_lossy(&result.stderr)
    );
    let data: Value = serde_json::from_slice(&result.stdout)?;
    let v = data["streams"].get(0).context("no video stream")?;
    let dimension = |key: &str| {
        v[key]
            .as_u64()
            .and_then(|n| u32::try_from(n).ok())
            .filter(|&n| n > 0)
    };
    let mut width = dimension("width").context("missing video width")?;
    let mut height = dimension("height").context("missing video height")?;
    if v["side_data_list"]
        .as_array()
        .into_iter()
        .flatten()
        .any(|entry| {
            entry["rotation"]
                .as_f64()
                .is_some_and(|angle| (angle.rem_euclid(180.0) - 90.0).abs() < 1.0)
        })
    {
        std::mem::swap(&mut width, &mut height); // ffmpeg auto-rotates when transcoding
    }
    let fps = ["avg_frame_rate", "r_frame_rate"]
        .into_iter()
        .find_map(|k| v[k].as_str().and_then(parse_ratio))
        .context("missing video frame rate")?;
    let duration = [&v["duration"], &data["format"]["duration"]]
        .into_iter()
        .filter_map(|d| {
            d.as_str()
                .and_then(|d| d.parse::<f64>().ok())
                .or_else(|| d.as_f64())
        })
        .find(|d| d.is_finite() && *d > 0.0)
        .context("missing video duration")?;
    Ok(VideoInfo {
        width,
        height,
        fps,
        duration,
    })
}

#[derive(Debug)]
pub struct SampledFrame {
    /// Seconds since the start of the requested window.
    pub time: f64,
    pub rgb: RgbImage,
}

pub struct FrameSampler {
    child: Child,
    stdout: ChildStdout,
    dims: (u32, u32),
    bytes: usize,
    fps: f64,
    index: u64,
    done: bool,
}

impl FrameSampler {
    /// Streams a window as RGB24 frames at `sample_fps`. Pass the source FPS to
    /// inspect every frame of a constant-frame-rate input for hard cuts.
    pub fn new(
        path: impl AsRef<Path>,
        info: VideoInfo,
        start: f64,
        end: f64,
        sample_fps: f64,
    ) -> Result<Self> {
        ensure!(
            start.is_finite() && end.is_finite() && start >= 0.0 && end > start,
            "invalid video window"
        );
        ensure!(
            sample_fps.is_finite() && sample_fps > 0.0,
            "invalid sample FPS"
        );
        let dims = info.proxy_dimensions();
        let scale = format!("scale={}:{}:flags=area", dims.0, dims.1);
        // Drop unneeded frames BEFORE scaling; for cut detection sample_fps is
        // the native rate so this preserves every frame of CFR video.
        let vf = format!("fps={sample_fps:.12},{}", scale);
        let mut cmd = ffmpeg(path.as_ref(), start);
        cmd.args(["-t", &format!("{:.9}", end - start), "-vf", &vf]);
        Self::spawn(cmd, dims, sample_fps)
    }

    fn spawn(mut cmd: Command, dims: (u32, u32), fps: f64) -> Result<Self> {
        let bytes = (dims.0 as usize)
            .checked_mul(dims.1 as usize)
            .and_then(|n| n.checked_mul(3))
            .filter(|&n| n > 0)
            .context("invalid RGB frame dimensions")?;
        let mut child = cmd
            .args([
                "-threads:v",
                "1",
                "-c:v",
                "rawvideo",
                "-f",
                "rawvideo",
                "-pix_fmt",
                "rgb24",
                "pipe:1",
            ])
            .stdout(Stdio::piped())
            .spawn()
            .context("could not run ffmpeg")?;
        let stdout = child.stdout.take().expect("ffmpeg stdout is piped");
        Ok(Self {
            child,
            stdout,
            dims,
            bytes,
            fps,
            index: 0,
            done: false,
        })
    }
}

impl Iterator for FrameSampler {
    type Item = Result<SampledFrame>;

    fn next(&mut self) -> Option<Self::Item> {
        if self.done {
            return None;
        }
        let mut bytes = vec![0; self.bytes];
        let mut pos = 0;
        while pos < bytes.len() {
            match self.stdout.read(&mut bytes[pos..]) {
                Ok(0) => {
                    self.done = true;
                    return match self.child.wait() {
                        Ok(status) if status.success() && pos == 0 => None,
                        Ok(status) if !status.success() => {
                            Some(Err(anyhow!("ffmpeg exited with {status}")))
                        }
                        Ok(_) => Some(Err(anyhow!("truncated ffmpeg RGB frame"))),
                        Err(e) => Some(Err(e.into())),
                    };
                }
                Ok(n) => pos += n,
                Err(e) if e.kind() == ErrorKind::Interrupted => continue,
                Err(e) => {
                    self.done = true;
                    return Some(Err(e.into()));
                }
            }
        }
        let time = self.index as f64 / self.fps;
        self.index += 1;
        Some(Ok(SampledFrame {
            time,
            rgb: RgbImage::from_raw(self.dims.0, self.dims.1, bytes)
                .expect("checked RGB dimensions"),
        }))
    }
}

impl Drop for FrameSampler {
    fn drop(&mut self) {
        // Reap even after early termination or a broken pipe.
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn ffmpeg(path: &Path, time: f64) -> Command {
    let mut cmd = Command::new("ffmpeg");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    cmd.args([
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-filter_threads",
        "1",
        "-ss",
        &format!("{time:.9}"),
        "-i",
    ])
    .arg(path)
    .args(["-map", "0:v:0", "-an", "-sn", "-dn"]);
    cmd
}

/// Seeks directly near `time` (absolute seconds) and decodes only one proxy frame.
pub fn seek_frame(path: impl AsRef<Path>, info: VideoInfo, time: f64) -> Result<Option<RgbImage>> {
    ensure!(time.is_finite() && time >= 0.0, "invalid seek timestamp");
    let dims = info.proxy_dimensions();
    let mut cmd = ffmpeg(path.as_ref(), time);
    cmd.args([
        "-frames:v",
        "1",
        "-vf",
        &format!("scale={}:{}:flags=area", dims.0, dims.1),
    ]);
    let mut sampler = FrameSampler::spawn(cmd, dims, info.fps)?;
    let frame = sampler.next().transpose()?;
    // Wait for ffmpeg's status, including if the pipeline failed after writing.
    if let Some(result) = sampler.next() {
        result?;
    }
    Ok(frame.map(|f| f.rgb))
}
