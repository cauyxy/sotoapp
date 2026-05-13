use std::{
    fmt,
    fs::{self, File},
    io::{Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
        mpsc::{self, Receiver},
    },
    thread,
};

use uuid::Uuid;

use crate::format::{CapturedRecordingFile, MicrophoneAudioFormat};
use crate::queue::{AudioFrameQueue, LevelSnapshotHandle};
use crate::wav::{duration_ms_for_pcm_bytes, write_wav_header};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RecorderError {
    AlreadyRecording,
    NotRecording,
    CreateRecordingDirectory(String),
    CreateRecordingFile(String),
    WriteRecordingFile(String),
    FinishRecordingFile(String),
    CancelRecordingFile(String),
    WriterStopped(String),
}

impl fmt::Display for RecorderError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::AlreadyRecording => write!(formatter, "audio recorder is already recording"),
            Self::NotRecording => write!(formatter, "audio recorder is not recording"),
            Self::CreateRecordingDirectory(message) => {
                write!(
                    formatter,
                    "recording directory could not be created: {message}"
                )
            }
            Self::CreateRecordingFile(message) => {
                write!(formatter, "recording file could not be created: {message}")
            }
            Self::WriteRecordingFile(message) => {
                write!(formatter, "recording file could not be written: {message}")
            }
            Self::FinishRecordingFile(message) => {
                write!(
                    formatter,
                    "recording file could not be finalized: {message}"
                )
            }
            Self::CancelRecordingFile(message) => {
                write!(
                    formatter,
                    "recording file could not be cancelled: {message}"
                )
            }
            Self::WriterStopped(message) => {
                write!(formatter, "recording writer stopped: {message}")
            }
        }
    }
}

impl std::error::Error for RecorderError {}

pub trait RecordingFileRecorder {
    fn start(&mut self) -> Result<(), RecorderError>;
    fn finish(&mut self) -> Result<CapturedRecordingFile, RecorderError>;
    fn cancel(&mut self) -> Result<(), RecorderError>;
}

pub struct BufferedRecordingFileRecorder {
    format: MicrophoneAudioFormat,
    directory: PathBuf,
    active: Option<RecordingFileSession>,
}

impl BufferedRecordingFileRecorder {
    pub fn new(format: MicrophoneAudioFormat) -> Self {
        Self::new_in_directory(format, default_recording_directory())
    }

    pub fn new_in_directory(format: MicrophoneAudioFormat, directory: impl Into<PathBuf>) -> Self {
        Self {
            format,
            directory: directory.into(),
            active: None,
        }
    }

    pub fn frame_queue(&self) -> Option<AudioFrameQueue> {
        self.active.as_ref().map(|session| session.queue.clone())
    }

    pub fn active_recording_path(&self) -> Option<&Path> {
        self.active.as_ref().map(|session| session.path.as_path())
    }

    pub fn level_snapshot_handle(&self) -> Option<LevelSnapshotHandle> {
        self.active
            .as_ref()
            .map(|s| LevelSnapshotHandle::from_cell(s.level.clone()))
    }
}

impl RecordingFileRecorder for BufferedRecordingFileRecorder {
    fn start(&mut self) -> Result<(), RecorderError> {
        if self.active.is_some() {
            return Err(RecorderError::AlreadyRecording);
        }

        fs::create_dir_all(&self.directory)
            .map_err(|error| RecorderError::CreateRecordingDirectory(error.to_string()))?;
        let path = self
            .directory
            .join(format!("soto-recording-{}.wav", Uuid::new_v4()));
        let mut file = File::create(&path)
            .map_err(|error| RecorderError::CreateRecordingFile(error.to_string()))?;
        write_wav_header(&mut file, &self.format, 0)
            .map_err(|error| RecorderError::CreateRecordingFile(error.to_string()))?;

        let (sender, receiver) = mpsc::channel();
        let stats = Arc::new(RecordingFileStats::default());
        let queue = AudioFrameQueue::recording(sender.clone(), stats.clone());
        let writer_path = path.clone();
        let writer_format = self.format.clone();
        let writer_stats = stats.clone();
        let level = Arc::new(Mutex::new(None::<(f32, f32)>));
        let writer_level = level.clone();
        let writer = thread::spawn(move || {
            recording_file_writer_loop(
                file,
                writer_path,
                writer_format,
                receiver,
                writer_stats,
                writer_level,
            );
        });

        self.active = Some(RecordingFileSession {
            path,
            queue,
            sender,
            writer: Some(writer),
            stats,
            level,
        });
        Ok(())
    }

    fn finish(&mut self) -> Result<CapturedRecordingFile, RecorderError> {
        let session = self.active.take().ok_or(RecorderError::NotRecording)?;
        let (reply_sender, reply_receiver) = mpsc::channel();
        session
            .sender
            .send(RecordingWriterMessage::Finish(reply_sender))
            .map_err(|_| RecorderError::WriterStopped("finish command could not be sent".into()))?;
        let summary = reply_receiver
            .recv()
            .map_err(|_| RecorderError::WriterStopped("finish reply was not received".into()))?
            .map_err(RecorderError::FinishRecordingFile)?;
        join_recording_writer(session.writer)?;

        Ok(CapturedRecordingFile {
            path: session.path,
            format: "wav".into(),
            duration_ms: summary.duration_ms,
            byte_count: summary.audio_byte_count,
            sample_rate_hz: self.format.sample_rate_hz,
            channels: self.format.channels,
            encoding: self.format.encoding.clone(),
            frames_received: summary.frames_received,
            frames_written: summary.frames_written,
            dropped_frames: summary.dropped_frames,
            queue_full: summary.queue_full,
        })
    }

    fn cancel(&mut self) -> Result<(), RecorderError> {
        let session = self.active.take().ok_or(RecorderError::NotRecording)?;
        let (reply_sender, reply_receiver) = mpsc::channel();
        session
            .sender
            .send(RecordingWriterMessage::Cancel(reply_sender))
            .map_err(|_| RecorderError::WriterStopped("cancel command could not be sent".into()))?;
        reply_receiver
            .recv()
            .map_err(|_| RecorderError::WriterStopped("cancel reply was not received".into()))?
            .map_err(RecorderError::CancelRecordingFile)?;
        join_recording_writer(session.writer)?;
        Ok(())
    }
}

struct RecordingFileSession {
    path: PathBuf,
    queue: AudioFrameQueue,
    sender: mpsc::Sender<RecordingWriterMessage>,
    writer: Option<thread::JoinHandle<()>>,
    #[allow(dead_code)]
    stats: Arc<RecordingFileStats>,
    level: Arc<Mutex<Option<(f32, f32)>>>,
}

pub(crate) enum RecordingWriterMessage {
    Frame(crate::format::AudioFrame),
    Finish(mpsc::Sender<Result<RecordingWriterSummary, String>>),
    Cancel(mpsc::Sender<Result<(), String>>),
}

#[derive(Default)]
pub(crate) struct RecordingFileStats {
    pub(crate) frames_received: AtomicU64,
    frames_written: AtomicU64,
    audio_bytes_written: AtomicU64,
    pub(crate) dropped_frames: AtomicU64,
    queue_full: AtomicU64,
}

impl RecordingFileStats {
    fn snapshot(&self) -> RecordingFileStatsSnapshot {
        RecordingFileStatsSnapshot {
            frames_received: self.frames_received.load(Ordering::Relaxed),
            frames_written: self.frames_written.load(Ordering::Relaxed),
            audio_byte_count: self.audio_bytes_written.load(Ordering::Relaxed),
            dropped_frames: self.dropped_frames.load(Ordering::Relaxed),
            queue_full: self.queue_full.load(Ordering::Relaxed),
        }
    }
}

struct RecordingFileStatsSnapshot {
    frames_received: u64,
    frames_written: u64,
    audio_byte_count: u64,
    dropped_frames: u64,
    queue_full: u64,
}

pub(crate) struct RecordingWriterSummary {
    duration_ms: u64,
    audio_byte_count: u64,
    frames_received: u64,
    frames_written: u64,
    dropped_frames: u64,
    queue_full: u64,
}

fn recording_file_writer_loop(
    mut file: File,
    path: PathBuf,
    format: MicrophoneAudioFormat,
    receiver: Receiver<RecordingWriterMessage>,
    stats: Arc<RecordingFileStats>,
    session_level: Arc<Mutex<Option<(f32, f32)>>>,
) {
    while let Ok(message) = receiver.recv() {
        match message {
            RecordingWriterMessage::Frame(frame) => {
                if let Err(error) = file.write_all(&frame.bytes) {
                    stats.dropped_frames.fetch_add(1, Ordering::Relaxed);
                    eprintln!("[soto-audio] recording writer: write frame FAILED: {error}");
                    continue;
                }
                stats.frames_written.fetch_add(1, Ordering::Relaxed);
                stats
                    .audio_bytes_written
                    .fetch_add(frame.bytes.len() as u64, Ordering::Relaxed);

                // Compute per-frame RMS and peak from the PCM i16 LE bytes.
                let samples: Vec<i16> = frame
                    .bytes
                    .chunks_exact(2)
                    .map(|b| i16::from_le_bytes([b[0], b[1]]))
                    .collect();
                if !samples.is_empty() {
                    let (rms, peak) = crate::pcm_stats::rms_and_peak(&samples);
                    if let Ok(mut guard) = session_level.lock() {
                        *guard = Some((rms, peak));
                    }
                }
            }
            RecordingWriterMessage::Finish(reply) => {
                let result = finalize_recording_file(&mut file, &format, &stats);
                let _ = reply.send(result);
                return;
            }
            RecordingWriterMessage::Cancel(reply) => {
                drop(file);
                let result = fs::remove_file(&path).map_err(|error| error.to_string());
                let _ = reply.send(result);
                return;
            }
        }
    }
}

fn finalize_recording_file(
    file: &mut File,
    format: &MicrophoneAudioFormat,
    stats: &RecordingFileStats,
) -> Result<RecordingWriterSummary, String> {
    file.flush().map_err(|error| error.to_string())?;
    let snapshot = stats.snapshot();
    file.seek(SeekFrom::Start(0))
        .map_err(|error| error.to_string())?;
    write_wav_header(file, format, snapshot.audio_byte_count).map_err(|error| error.to_string())?;
    file.flush().map_err(|error| error.to_string())?;

    Ok(RecordingWriterSummary {
        duration_ms: duration_ms_for_pcm_bytes(
            snapshot.audio_byte_count,
            format.sample_rate_hz,
            format.channels,
            &format.encoding,
        ),
        audio_byte_count: snapshot.audio_byte_count,
        frames_received: snapshot.frames_received,
        frames_written: snapshot.frames_written,
        dropped_frames: snapshot.dropped_frames,
        queue_full: snapshot.queue_full,
    })
}

fn join_recording_writer(writer: Option<thread::JoinHandle<()>>) -> Result<(), RecorderError> {
    if let Some(writer) = writer {
        writer
            .join()
            .map_err(|_| RecorderError::WriterStopped("recording writer panicked".into()))?;
    }
    Ok(())
}

fn default_recording_directory() -> PathBuf {
    std::env::temp_dir().join("soto-recordings")
}
