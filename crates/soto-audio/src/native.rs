use std::{
    fmt, fs,
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
    },
};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use serde::Serialize;

use crate::conversion::{AudioConversionError, MicrophoneFrameConverter};
use crate::file_recorder::{BufferedRecordingFileRecorder, RecorderError, RecordingFileRecorder};
use crate::format::{AudioFrame, CapturedRecordingFile, MicrophoneAudioFormat};
use crate::queue::{AudioFrameQueue, LevelSnapshotHandle, QueueFrameError};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct MicrophoneDevice {
    pub id: String,
    pub name: String,
    pub is_default: bool,
}

#[derive(Debug)]
pub enum NativeMicrophoneRecorderError {
    AlreadyRecording,
    NotRecording,
    RecordingFile(String),
    DefaultInputDeviceUnavailable,
    InputDeviceUnavailable(String),
    InputDevices(String),
    DefaultInputConfig(String),
    InvalidInputFormat(AudioConversionError),
    UnsupportedSampleFormat(String),
    BuildStream(String),
    PlayStream(String),
}

impl fmt::Display for NativeMicrophoneRecorderError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::AlreadyRecording => write!(formatter, "audio recorder is already recording"),
            Self::NotRecording => write!(formatter, "audio recorder is not recording"),
            Self::RecordingFile(message) => write!(formatter, "{message}"),
            Self::DefaultInputDeviceUnavailable => {
                write!(formatter, "default microphone input device is unavailable")
            }
            Self::InputDeviceUnavailable(device_id) => {
                write!(
                    formatter,
                    "microphone input device is unavailable: {device_id}"
                )
            }
            Self::InputDevices(message) => {
                write!(
                    formatter,
                    "microphone input devices could not be listed: {message}"
                )
            }
            Self::DefaultInputConfig(message) => {
                write!(
                    formatter,
                    "default microphone input config is unavailable: {message}"
                )
            }
            Self::InvalidInputFormat(error) => {
                write!(formatter, "microphone input format is invalid: {error:?}")
            }
            Self::UnsupportedSampleFormat(format) => {
                write!(
                    formatter,
                    "microphone sample format is unsupported: {format}"
                )
            }
            Self::BuildStream(message) => {
                write!(
                    formatter,
                    "microphone input stream could not be built: {message}"
                )
            }
            Self::PlayStream(message) => {
                write!(
                    formatter,
                    "microphone input stream could not start: {message}"
                )
            }
        }
    }
}

impl std::error::Error for NativeMicrophoneRecorderError {}

pub struct NativeMicrophoneRecorder {
    format: MicrophoneAudioFormat,
    recording: BufferedRecordingFileRecorder,
    device_id: Option<String>,
    stream: Option<NativeMicrophoneInputStream>,
}

impl NativeMicrophoneRecorder {
    pub fn new() -> Self {
        Self::new_with_frame_capacity(64)
    }

    pub fn new_with_frame_capacity(frame_capacity: usize) -> Self {
        Self::new_with_device_id(None, frame_capacity)
    }

    pub fn new_with_device_id(device_id: Option<String>, frame_capacity: usize) -> Self {
        let format = MicrophoneAudioFormat::mvp_pcm_16khz_mono();
        let _ = frame_capacity;
        Self {
            recording: BufferedRecordingFileRecorder::new(format.clone()),
            device_id,
            format,
            stream: None,
        }
    }

    pub fn format(&self) -> &MicrophoneAudioFormat {
        &self.format
    }

    pub fn frame_queue(&self) -> Option<AudioFrameQueue> {
        self.recording.frame_queue()
    }

    pub fn level_snapshot_handle(&self) -> Option<LevelSnapshotHandle> {
        self.recording.level_snapshot_handle()
    }

    pub fn device_id(&self) -> Option<&str> {
        self.device_id.as_deref()
    }

    pub fn start(&mut self) -> Result<(), NativeMicrophoneRecorderError> {
        if self.stream.is_some() {
            return Err(NativeMicrophoneRecorderError::AlreadyRecording);
        }

        eprintln!(
            "[soto-audio] native recorder start: requested_device_id={:?}",
            self.device_id
        );
        self.recording
            .start()
            .map_err(native_recorder_lifecycle_error)?;
        let queue = self.frame_queue().ok_or_else(|| {
            NativeMicrophoneRecorderError::RecordingFile(
                "recording file session did not expose an audio frame queue".into(),
            )
        })?;
        let active_stream = match build_input_stream(queue, self.device_id.as_deref()) {
            Ok(stream) => stream,
            Err(error) => {
                let _ = self.recording.cancel();
                return Err(error);
            }
        };
        if let Err(error) = active_stream.stream.play() {
            let _ = self.recording.cancel();
            eprintln!("[soto-audio] native recorder start: stream.play FAILED: {error}");
            return Err(NativeMicrophoneRecorderError::PlayStream(error.to_string()));
        }
        eprintln!(
            "[soto-audio] native recorder start: stream.play ok ({})",
            active_stream.diagnostics.summary()
        );
        self.stream = Some(active_stream);

        Ok(())
    }

    pub fn finish(&mut self) -> Result<CapturedRecordingFile, NativeMicrophoneRecorderError> {
        let diagnostics = self.stream.take().map(|active_stream| {
            let NativeMicrophoneInputStream {
                stream,
                diagnostics,
            } = active_stream;
            drop(stream);
            diagnostics
        });
        let recording = self
            .recording
            .finish()
            .map_err(native_recorder_lifecycle_error)?;
        let file_bytes = fs::metadata(&recording.path)
            .map(|metadata| metadata.len())
            .unwrap_or(0);
        if let Some(diagnostics) = diagnostics {
            eprintln!(
                "[soto-audio] native recorder finish: {} recorded_ms={} file_bytes={} file_audio_bytes={} frames_received={} frames_written={} dropped_frames={} queue_full={} stats={}",
                diagnostics.summary(),
                recording.duration_ms,
                file_bytes,
                recording.byte_count,
                recording.frames_received,
                recording.frames_written,
                recording.dropped_frames,
                recording.queue_full,
                diagnostics.stats.snapshot().summary()
            );
        } else {
            eprintln!(
                "[soto-audio] native recorder finish: no active stream recorded_ms={} file_bytes={} file_audio_bytes={} frames_received={} frames_written={} dropped_frames={} queue_full={}",
                recording.duration_ms,
                file_bytes,
                recording.byte_count,
                recording.frames_received,
                recording.frames_written,
                recording.dropped_frames,
                recording.queue_full
            );
        }
        Ok(recording)
    }

    pub fn cancel(&mut self) -> Result<(), NativeMicrophoneRecorderError> {
        if let Some(active_stream) = self.stream.take() {
            let NativeMicrophoneInputStream {
                stream,
                diagnostics,
            } = active_stream;
            drop(stream);
            eprintln!(
                "[soto-audio] native recorder cancel: {} stats={}",
                diagnostics.summary(),
                diagnostics.stats.snapshot().summary()
            );
        }
        self.recording
            .cancel()
            .map_err(native_recorder_lifecycle_error)
    }
}

pub fn list_microphone_devices() -> Result<Vec<MicrophoneDevice>, NativeMicrophoneRecorderError> {
    let host = cpal::default_host();
    let default_name = host
        .default_input_device()
        .and_then(|device| device.name().ok());
    let devices = host
        .input_devices()
        .map_err(|error| NativeMicrophoneRecorderError::InputDevices(error.to_string()))?;

    devices
        .map(|device| {
            let name = device
                .name()
                .map_err(|error| NativeMicrophoneRecorderError::InputDevices(error.to_string()))?;
            Ok(MicrophoneDevice {
                id: name.clone(),
                is_default: default_name.as_deref() == Some(name.as_str()),
                name,
            })
        })
        .collect()
}

impl Default for NativeMicrophoneRecorder {
    fn default() -> Self {
        Self::new()
    }
}

fn native_recorder_lifecycle_error(error: RecorderError) -> NativeMicrophoneRecorderError {
    match error {
        RecorderError::AlreadyRecording => NativeMicrophoneRecorderError::AlreadyRecording,
        RecorderError::NotRecording => NativeMicrophoneRecorderError::NotRecording,
        error => NativeMicrophoneRecorderError::RecordingFile(error.to_string()),
    }
}

fn build_input_stream(
    queue: AudioFrameQueue,
    device_id: Option<&str>,
) -> Result<NativeMicrophoneInputStream, NativeMicrophoneRecorderError> {
    let host = cpal::default_host();
    let device = if let Some(device_id) = device_id {
        find_input_device(&host, device_id)?
    } else {
        host.default_input_device()
            .ok_or(NativeMicrophoneRecorderError::DefaultInputDeviceUnavailable)?
    };
    let device_name = device
        .name()
        .unwrap_or_else(|error| format!("<name unavailable: {error}>"));
    let supported_config = device
        .default_input_config()
        .map_err(|error| NativeMicrophoneRecorderError::DefaultInputConfig(error.to_string()))?;
    let input_sample_rate_hz = supported_config.sample_rate().0;
    let input_channels = supported_config.channels() as usize;
    let converter = MicrophoneFrameConverter::new(input_sample_rate_hz, input_channels)
        .map_err(NativeMicrophoneRecorderError::InvalidInputFormat)?;
    let stream_config = supported_config.config();
    let sample_format = supported_config.sample_format();
    let diagnostics = NativeMicrophoneInputStreamDiagnostics {
        requested_device_id: device_id.map(str::to_string),
        device_name,
        sample_format: format!("{sample_format:?}"),
        input_sample_rate_hz,
        input_channels,
        buffer_size: format!("{:?}", stream_config.buffer_size),
        stats: Arc::new(NativeMicrophoneStreamStats::default()),
    };
    eprintln!("[soto-audio] build_input_stream: {}", diagnostics.summary());

    let stream = match sample_format {
        cpal::SampleFormat::F32 => build_f32_input_stream(
            &device,
            &stream_config,
            converter,
            queue,
            diagnostics.stats.clone(),
        ),
        cpal::SampleFormat::I16 => build_i16_input_stream(
            &device,
            &stream_config,
            converter,
            queue,
            diagnostics.stats.clone(),
        ),
        cpal::SampleFormat::U16 => build_u16_input_stream(
            &device,
            &stream_config,
            converter,
            queue,
            diagnostics.stats.clone(),
        ),
        format => Err(NativeMicrophoneRecorderError::UnsupportedSampleFormat(
            format!("{format:?}"),
        )),
    }?;

    Ok(NativeMicrophoneInputStream {
        stream,
        diagnostics,
    })
}

fn find_input_device(
    host: &cpal::Host,
    device_id: &str,
) -> Result<cpal::Device, NativeMicrophoneRecorderError> {
    host.input_devices()
        .map_err(|error| NativeMicrophoneRecorderError::InputDevices(error.to_string()))?
        .find_map(|device| match device.name() {
            Ok(name) if name == device_id => Some(device),
            _ => None,
        })
        .ok_or_else(|| NativeMicrophoneRecorderError::InputDeviceUnavailable(device_id.into()))
}

fn build_f32_input_stream(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    mut converter: MicrophoneFrameConverter,
    queue: AudioFrameQueue,
    stats: Arc<NativeMicrophoneStreamStats>,
) -> Result<cpal::Stream, NativeMicrophoneRecorderError> {
    device
        .build_input_stream(
            config,
            move |samples: &[f32], _| {
                record_input_callback(&stats, samples.len());
                if let Some(frame) = converter.push_f32_interleaved(samples) {
                    push_converted_frame(&queue, &stats, frame);
                } else {
                    stats.empty_conversion_count.fetch_add(1, Ordering::Relaxed);
                }
            },
            move |error| {
                eprintln!("[soto-audio] input stream error: {error}");
            },
            None,
        )
        .map_err(|error| NativeMicrophoneRecorderError::BuildStream(error.to_string()))
}

fn build_i16_input_stream(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    mut converter: MicrophoneFrameConverter,
    queue: AudioFrameQueue,
    stats: Arc<NativeMicrophoneStreamStats>,
) -> Result<cpal::Stream, NativeMicrophoneRecorderError> {
    device
        .build_input_stream(
            config,
            move |samples: &[i16], _| {
                record_input_callback(&stats, samples.len());
                if let Some(frame) = converter.push_i16_interleaved(samples) {
                    push_converted_frame(&queue, &stats, frame);
                } else {
                    stats.empty_conversion_count.fetch_add(1, Ordering::Relaxed);
                }
            },
            move |error| {
                eprintln!("[soto-audio] input stream error: {error}");
            },
            None,
        )
        .map_err(|error| NativeMicrophoneRecorderError::BuildStream(error.to_string()))
}

fn build_u16_input_stream(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    mut converter: MicrophoneFrameConverter,
    queue: AudioFrameQueue,
    stats: Arc<NativeMicrophoneStreamStats>,
) -> Result<cpal::Stream, NativeMicrophoneRecorderError> {
    device
        .build_input_stream(
            config,
            move |samples: &[u16], _| {
                record_input_callback(&stats, samples.len());
                if let Some(frame) = converter.push_u16_interleaved(samples) {
                    push_converted_frame(&queue, &stats, frame);
                } else {
                    stats.empty_conversion_count.fetch_add(1, Ordering::Relaxed);
                }
            },
            move |error| {
                eprintln!("[soto-audio] input stream error: {error}");
            },
            None,
        )
        .map_err(|error| NativeMicrophoneRecorderError::BuildStream(error.to_string()))
}

struct NativeMicrophoneInputStream {
    stream: cpal::Stream,
    diagnostics: NativeMicrophoneInputStreamDiagnostics,
}

struct NativeMicrophoneInputStreamDiagnostics {
    requested_device_id: Option<String>,
    device_name: String,
    sample_format: String,
    input_sample_rate_hz: u32,
    input_channels: usize,
    buffer_size: String,
    stats: Arc<NativeMicrophoneStreamStats>,
}

impl NativeMicrophoneInputStreamDiagnostics {
    fn summary(&self) -> String {
        format!(
            "requested_device_id={:?} device_name={:?} sample_format={} input_sample_rate_hz={} input_channels={} buffer_size={}",
            self.requested_device_id,
            self.device_name,
            self.sample_format,
            self.input_sample_rate_hz,
            self.input_channels,
            self.buffer_size
        )
    }
}

#[derive(Default)]
struct NativeMicrophoneStreamStats {
    callback_count: AtomicU64,
    source_sample_count: AtomicU64,
    queued_frame_count: AtomicU64,
    queued_byte_count: AtomicU64,
    empty_conversion_count: AtomicU64,
    queue_full_count: AtomicU64,
    queue_disconnected_count: AtomicU64,
}

impl NativeMicrophoneStreamStats {
    fn snapshot(&self) -> NativeMicrophoneStreamStatsSnapshot {
        NativeMicrophoneStreamStatsSnapshot {
            callback_count: self.callback_count.load(Ordering::Relaxed),
            source_sample_count: self.source_sample_count.load(Ordering::Relaxed),
            queued_frame_count: self.queued_frame_count.load(Ordering::Relaxed),
            queued_byte_count: self.queued_byte_count.load(Ordering::Relaxed),
            empty_conversion_count: self.empty_conversion_count.load(Ordering::Relaxed),
            queue_full_count: self.queue_full_count.load(Ordering::Relaxed),
            queue_disconnected_count: self.queue_disconnected_count.load(Ordering::Relaxed),
        }
    }
}

struct NativeMicrophoneStreamStatsSnapshot {
    callback_count: u64,
    source_sample_count: u64,
    queued_frame_count: u64,
    queued_byte_count: u64,
    empty_conversion_count: u64,
    queue_full_count: u64,
    queue_disconnected_count: u64,
}

impl NativeMicrophoneStreamStatsSnapshot {
    fn summary(&self) -> String {
        format!(
            "callbacks={} source_samples={} queued_frames={} queued_bytes={} empty_conversions={} queue_full={} queue_disconnected={}",
            self.callback_count,
            self.source_sample_count,
            self.queued_frame_count,
            self.queued_byte_count,
            self.empty_conversion_count,
            self.queue_full_count,
            self.queue_disconnected_count
        )
    }
}

fn record_input_callback(stats: &NativeMicrophoneStreamStats, sample_count: usize) {
    stats.callback_count.fetch_add(1, Ordering::Relaxed);
    stats
        .source_sample_count
        .fetch_add(sample_count as u64, Ordering::Relaxed);
}

fn push_converted_frame(
    queue: &AudioFrameQueue,
    stats: &NativeMicrophoneStreamStats,
    frame: AudioFrame,
) {
    let byte_count = frame.bytes.len() as u64;
    match queue.push(frame) {
        Ok(()) => {
            stats.queued_frame_count.fetch_add(1, Ordering::Relaxed);
            stats
                .queued_byte_count
                .fetch_add(byte_count, Ordering::Relaxed);
        }
        Err(QueueFrameError::Full(_)) => {
            stats.queue_full_count.fetch_add(1, Ordering::Relaxed);
        }
        Err(QueueFrameError::Disconnected(_)) => {
            stats
                .queue_disconnected_count
                .fetch_add(1, Ordering::Relaxed);
        }
    }
}
