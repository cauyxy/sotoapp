use std::sync::{
    Arc, Mutex,
    atomic::Ordering,
    mpsc::{self, Receiver, SyncSender, TrySendError},
};

use crate::file_recorder::{RecordingFileStats, RecordingWriterMessage};
use crate::format::AudioFrame;

/// A handle that allows reading the most recently computed RMS and peak level
/// from a recording session's writer thread.
#[derive(Clone)]
pub struct LevelSnapshotHandle {
    cell: Arc<Mutex<Option<(f32, f32)>>>,
}

impl LevelSnapshotHandle {
    /// Returns `(rms, peak)` of the most recent frame written.
    ///
    /// Returns `None` only if no frame has been written yet. After the recorder
    /// finishes, the cell retains the value of the final frame for the lifetime
    /// of any outstanding handle. Callers that need a "stopped" signal should
    /// observe the recorder lifecycle separately (e.g., the level-emit task in
    /// `soto-tauri/mic_test.rs` is aborted when stop is called).
    pub fn snapshot(&self) -> Option<(f32, f32)> {
        *self.cell.lock().unwrap()
    }
}

impl LevelSnapshotHandle {
    pub(crate) fn from_cell(cell: Arc<Mutex<Option<(f32, f32)>>>) -> Self {
        Self { cell }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum QueueFrameError {
    Full(AudioFrame),
    Disconnected(AudioFrame),
}

#[derive(Clone)]
pub(crate) enum AudioFrameQueueSender {
    Bounded(SyncSender<AudioFrame>),
    Recording {
        sender: mpsc::Sender<RecordingWriterMessage>,
        stats: Arc<RecordingFileStats>,
    },
}

#[derive(Clone)]
pub struct AudioFrameQueue {
    sender: AudioFrameQueueSender,
}

impl AudioFrameQueue {
    pub fn bounded(capacity: usize) -> (Self, Receiver<AudioFrame>) {
        let (sender, receiver) = mpsc::sync_channel(capacity);
        (
            Self {
                sender: AudioFrameQueueSender::Bounded(sender),
            },
            receiver,
        )
    }

    pub(crate) fn recording(
        sender: mpsc::Sender<RecordingWriterMessage>,
        stats: Arc<RecordingFileStats>,
    ) -> Self {
        Self {
            sender: AudioFrameQueueSender::Recording { sender, stats },
        }
    }

    pub fn push(&self, frame: AudioFrame) -> Result<(), QueueFrameError> {
        match &self.sender {
            AudioFrameQueueSender::Bounded(sender) => {
                sender.try_send(frame).map_err(|error| match error {
                    TrySendError::Full(frame) => QueueFrameError::Full(frame),
                    TrySendError::Disconnected(frame) => QueueFrameError::Disconnected(frame),
                })
            }
            AudioFrameQueueSender::Recording { sender, stats } => {
                stats.frames_received.fetch_add(1, Ordering::Relaxed);
                match sender.send(RecordingWriterMessage::Frame(frame)) {
                    Ok(()) => Ok(()),
                    Err(error) => match error.0 {
                        RecordingWriterMessage::Frame(frame) => {
                            stats.dropped_frames.fetch_add(1, Ordering::Relaxed);
                            Err(QueueFrameError::Disconnected(frame))
                        }
                        RecordingWriterMessage::Finish(_) | RecordingWriterMessage::Cancel(_) => {
                            unreachable!("frame queue only sends recording frames")
                        }
                    },
                }
            }
        }
    }
}
