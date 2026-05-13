mod analysis;
mod buffer;
mod conversion;
mod file_recorder;
mod format;
mod native;
mod pcm_stats;
mod queue;
mod wav;

pub use analysis::{RecordingAudioStats, analyze_recording};
pub use buffer::{AudioCaptureBuffer, BufferedAudioRecorder};
pub use conversion::{AudioConversionError, MicrophoneFrameConverter};
pub use file_recorder::{BufferedRecordingFileRecorder, RecorderError, RecordingFileRecorder};
pub use format::{
    AudioFrame, CapturedAudio, CapturedRecordingFile, MicrophoneAudioFormat, RecordingAudioFormat,
    RecordingFile,
};
pub use native::{
    MicrophoneDevice, NativeMicrophoneRecorder, NativeMicrophoneRecorderError,
    list_microphone_devices,
};
pub use queue::{AudioFrameQueue, LevelSnapshotHandle, QueueFrameError};
pub use wav::read_recording_file_audio_bytes;
