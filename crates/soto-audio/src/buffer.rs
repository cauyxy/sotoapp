use std::sync::mpsc::{Receiver, TryRecvError};

use crate::file_recorder::RecorderError;
use crate::format::{AudioFrame, CapturedAudio, MicrophoneAudioFormat};
use crate::queue::AudioFrameQueue;

#[derive(Debug)]
pub struct AudioCaptureBuffer {
    format: MicrophoneAudioFormat,
    frames: Vec<AudioFrame>,
}

impl AudioCaptureBuffer {
    pub fn new(format: MicrophoneAudioFormat) -> Self {
        Self {
            format,
            frames: Vec::new(),
        }
    }

    pub fn drain_from(&mut self, receiver: &Receiver<AudioFrame>) -> usize {
        let mut drained = 0;
        loop {
            match receiver.try_recv() {
                Ok(frame) => {
                    self.frames.push(frame);
                    drained += 1;
                }
                Err(TryRecvError::Empty) => return drained,
                Err(TryRecvError::Disconnected) => return drained,
            }
        }
    }

    pub fn is_empty(&self) -> bool {
        self.frames.is_empty()
    }

    pub fn frame_count(&self) -> usize {
        self.frames.len()
    }

    pub fn finish(&mut self) -> CapturedAudio {
        let byte_count = self.frames.iter().map(|frame| frame.bytes.len()).sum();
        let mut bytes = Vec::with_capacity(byte_count);
        for frame in self.frames.drain(..) {
            bytes.extend_from_slice(&frame.bytes);
        }

        CapturedAudio {
            format: self.format.clone(),
            bytes,
        }
    }
}

pub struct BufferedAudioRecorder {
    queue: AudioFrameQueue,
    receiver: Receiver<AudioFrame>,
    buffer: AudioCaptureBuffer,
    is_recording: bool,
}

impl BufferedAudioRecorder {
    pub fn new(format: MicrophoneAudioFormat, frame_capacity: usize) -> Self {
        let (queue, receiver) = AudioFrameQueue::bounded(frame_capacity);
        Self {
            queue,
            receiver,
            buffer: AudioCaptureBuffer::new(format),
            is_recording: false,
        }
    }

    pub fn frame_queue(&self) -> AudioFrameQueue {
        self.queue.clone()
    }

    pub fn start(&mut self) -> Result<(), RecorderError> {
        if self.is_recording {
            return Err(RecorderError::AlreadyRecording);
        }
        self.drain_and_discard();
        self.is_recording = true;
        Ok(())
    }

    pub fn finish(&mut self) -> Result<CapturedAudio, RecorderError> {
        if !self.is_recording {
            return Err(RecorderError::NotRecording);
        }
        self.buffer.drain_from(&self.receiver);
        self.is_recording = false;
        Ok(self.buffer.finish())
    }

    pub fn cancel(&mut self) -> Result<(), RecorderError> {
        if !self.is_recording {
            return Err(RecorderError::NotRecording);
        }
        self.drain_and_discard();
        self.is_recording = false;
        Ok(())
    }

    fn drain_and_discard(&mut self) {
        let mut discard = AudioCaptureBuffer::new(self.buffer.format.clone());
        discard.drain_from(&self.receiver);
        let _ = discard.finish();
        let _ = self.buffer.finish();
    }
}
