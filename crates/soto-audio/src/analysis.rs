//! Session-wide audio statistics for a captured recording file.
//!
//! Used by `soto-app::run_voice_session` to short-circuit speech recognition
//! when a recording is silent or otherwise empty.

use std::io;

use crate::format::CapturedRecordingFile;
use crate::pcm_stats::rms_and_peak;
use crate::wav::read_recording_file_audio_bytes;

#[derive(Debug, Clone, PartialEq)]
pub struct RecordingAudioStats {
    /// Recording duration in milliseconds (mirrors `CapturedRecordingFile.duration_ms`).
    pub duration_ms: u64,
    /// Peak amplitude over the whole recording, range [0.0, 1.0].
    pub peak: f32,
    /// Root-mean-square amplitude over the whole recording, range [0.0, 1.0].
    pub rms: f32,
    /// Number of PCM samples scanned.
    pub sample_count: u64,
}

/// Decode a captured recording's PCM body and compute session-wide statistics.
///
/// Currently supports `pcm_s16le` encoded WAV files (the only format the
/// recording pipeline emits today). Returns an `InvalidData` error for any
/// other encoding.
pub fn analyze_recording(recording: &CapturedRecordingFile) -> io::Result<RecordingAudioStats> {
    if recording.encoding != "pcm_s16le" {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!("unsupported recording encoding: {}", recording.encoding),
        ));
    }
    let bytes = read_recording_file_audio_bytes(recording)?;
    let samples: Vec<i16> = bytes
        .chunks_exact(2)
        .map(|b| i16::from_le_bytes([b[0], b[1]]))
        .collect();
    let (rms, peak) = rms_and_peak(&samples);
    Ok(RecordingAudioStats {
        duration_ms: recording.duration_ms,
        peak,
        rms,
        sample_count: samples.len() as u64,
    })
}
