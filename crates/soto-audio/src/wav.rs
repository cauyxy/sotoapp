use std::{
    fs::{self, File},
    io::{self, Read, Write},
    path::Path,
};

use crate::format::{CapturedRecordingFile, MicrophoneAudioFormat};

pub fn read_recording_file_audio_bytes(recording: &CapturedRecordingFile) -> io::Result<Vec<u8>> {
    match recording.format.as_str() {
        "wav" => read_wav_pcm_data(&recording.path),
        "pcm" => fs::read(&recording.path),
        _ => Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!("unsupported recording file format: {}", recording.format),
        )),
    }
}

pub(crate) fn duration_ms_for_pcm_bytes(
    byte_count: u64,
    sample_rate_hz: u32,
    channels: u32,
    encoding: &str,
) -> u64 {
    if encoding != "pcm_s16le" {
        return 0;
    }
    let bytes_per_frame = channels.saturating_mul(2);
    if bytes_per_frame == 0 || sample_rate_hz == 0 {
        return 0;
    }
    let frames = byte_count / bytes_per_frame as u64;
    frames.saturating_mul(1_000) / u64::from(sample_rate_hz)
}

pub(crate) fn write_wav_header(
    file: &mut File,
    format: &MicrophoneAudioFormat,
    data_byte_count: u64,
) -> io::Result<()> {
    if format.encoding != "pcm_s16le" {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("unsupported WAV encoding: {}", format.encoding),
        ));
    }
    let data_len = u32::try_from(data_byte_count).map_err(|_| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            "recording is too large for a RIFF/WAV data chunk",
        )
    })?;
    let channels = u16::try_from(format.channels)
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "too many WAV channels"))?;
    let bits_per_sample = 16u16;
    let block_align = channels
        .checked_mul(bits_per_sample / 8)
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "invalid block align"))?;
    let byte_rate = format
        .sample_rate_hz
        .checked_mul(u32::from(block_align))
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "invalid byte rate"))?;

    file.write_all(b"RIFF")?;
    file.write_all(&(36u32 + data_len).to_le_bytes())?;
    file.write_all(b"WAVE")?;
    file.write_all(b"fmt ")?;
    file.write_all(&16u32.to_le_bytes())?;
    file.write_all(&1u16.to_le_bytes())?;
    file.write_all(&channels.to_le_bytes())?;
    file.write_all(&format.sample_rate_hz.to_le_bytes())?;
    file.write_all(&byte_rate.to_le_bytes())?;
    file.write_all(&block_align.to_le_bytes())?;
    file.write_all(&bits_per_sample.to_le_bytes())?;
    file.write_all(b"data")?;
    file.write_all(&data_len.to_le_bytes())?;
    Ok(())
}

pub(crate) fn read_wav_pcm_data(path: &Path) -> io::Result<Vec<u8>> {
    let mut file = File::open(path)?;
    let mut header = [0u8; 44];
    file.read_exact(&mut header)?;
    if &header[0..4] != b"RIFF" || &header[8..12] != b"WAVE" || &header[36..40] != b"data" {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "recording WAV header is not Soto PCM16 WAV",
        ));
    }
    let data_len = u32::from_le_bytes(header[40..44].try_into().unwrap()) as usize;
    let mut audio = Vec::new();
    file.read_to_end(&mut audio)?;
    if audio.len() > data_len {
        audio.truncate(data_len);
    }
    Ok(audio)
}
