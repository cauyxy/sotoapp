use std::{
    fs::{self, File},
    io::Read,
    path::PathBuf,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MicrophoneAudioFormat {
    pub sample_rate_hz: u32,
    pub channels: u32,
    pub encoding: String,
}

impl MicrophoneAudioFormat {
    pub fn mvp_pcm_16khz_mono() -> Self {
        Self {
            sample_rate_hz: 16_000,
            channels: 1,
            encoding: "pcm_s16le".into(),
        }
    }

    pub fn to_recording_audio_format(&self) -> RecordingAudioFormat {
        RecordingAudioFormat {
            sample_rate_hz: self.sample_rate_hz,
            channels: self.channels,
            encoding: self.encoding.clone(),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RecordingAudioFormat {
    pub sample_rate_hz: u32,
    pub channels: u32,
    pub encoding: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RecordingFile {
    pub path: PathBuf,
    pub format: String,
    pub duration_ms: u64,
    pub byte_count: u64,
    pub audio_format: RecordingAudioFormat,
}

impl From<&CapturedRecordingFile> for RecordingFile {
    fn from(recording: &CapturedRecordingFile) -> Self {
        Self {
            path: recording.path.clone(),
            format: recording.format.clone(),
            duration_ms: recording.duration_ms,
            byte_count: recording.byte_count,
            audio_format: RecordingAudioFormat {
                sample_rate_hz: recording.sample_rate_hz,
                channels: recording.channels,
                encoding: recording.encoding.clone(),
            },
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AudioFrame {
    pub bytes: Vec<u8>,
}

impl AudioFrame {
    pub fn new(bytes: Vec<u8>) -> Self {
        Self { bytes }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CapturedAudio {
    pub format: MicrophoneAudioFormat,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CapturedRecordingFile {
    pub path: PathBuf,
    pub format: String,
    pub duration_ms: u64,
    pub byte_count: u64,
    pub sample_rate_hz: u32,
    pub channels: u32,
    pub encoding: String,
    pub frames_received: u64,
    pub frames_written: u64,
    pub dropped_frames: u64,
    pub queue_full: u64,
}

impl CapturedRecordingFile {
    pub fn audio_format(&self) -> MicrophoneAudioFormat {
        MicrophoneAudioFormat {
            sample_rate_hz: self.sample_rate_hz,
            channels: self.channels,
            encoding: self.encoding.clone(),
        }
    }

    pub fn from_path(path: impl Into<PathBuf>) -> Result<Self, String> {
        let path = path.into();
        let mut file = File::open(&path).map_err(|e| e.to_string())?;
        let mut header = [0u8; 44];
        file.read_exact(&mut header).map_err(|e| e.to_string())?;
        if &header[0..4] != b"RIFF" || &header[8..12] != b"WAVE" {
            return Err("not a RIFF/WAVE file".into());
        }

        let channels = u16::from_le_bytes([header[22], header[23]]) as u32;
        let sample_rate_hz = u32::from_le_bytes([header[24], header[25], header[26], header[27]]);
        let bits_per_sample = u16::from_le_bytes([header[34], header[35]]);

        if channels == 0 || sample_rate_hz == 0 {
            return Err("invalid WAV header: zero channels or sample rate".into());
        }

        let file_size = fs::metadata(&path).map_err(|e| e.to_string())?.len();
        let byte_count = file_size.saturating_sub(44);
        let bytes_per_sample = (bits_per_sample as u64).div_ceil(8);
        let samples = byte_count.checked_div(bytes_per_sample).unwrap_or(0);
        let duration_ms = if sample_rate_hz > 0 && channels > 0 {
            (samples * 1000) / (sample_rate_hz as u64 * channels as u64)
        } else {
            0
        };

        Ok(Self {
            path,
            format: "wav".into(),
            duration_ms,
            byte_count,
            sample_rate_hz,
            channels,
            encoding: "pcm_s16le".into(),
            frames_received: 0,
            frames_written: 0,
            dropped_frames: 0,
            queue_full: 0,
        })
    }
}
