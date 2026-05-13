use crate::format::{AudioFrame, MicrophoneAudioFormat};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AudioConversionError {
    InvalidSampleRate,
    InvalidChannelCount,
}

#[derive(Debug)]
pub struct MicrophoneFrameConverter {
    input_sample_rate_hz: u32,
    input_channels: usize,
    next_source_position: f64,
}

impl MicrophoneFrameConverter {
    pub fn new(
        input_sample_rate_hz: u32,
        input_channels: usize,
    ) -> Result<Self, AudioConversionError> {
        if input_sample_rate_hz == 0 {
            return Err(AudioConversionError::InvalidSampleRate);
        }
        if input_channels == 0 {
            return Err(AudioConversionError::InvalidChannelCount);
        }

        Ok(Self {
            input_sample_rate_hz,
            input_channels,
            next_source_position: 0.0,
        })
    }

    pub fn push_f32_interleaved(&mut self, samples: &[f32]) -> Option<AudioFrame> {
        let input_frame_count = samples.len() / self.input_channels;
        if input_frame_count == 0 {
            return None;
        }

        let mut mono_samples = Vec::with_capacity(input_frame_count);
        for frame_index in 0..input_frame_count {
            let start = frame_index * self.input_channels;
            let sum = samples[start..start + self.input_channels]
                .iter()
                .copied()
                .map(|sample| sample.clamp(-1.0, 1.0))
                .sum::<f32>();
            mono_samples.push(sum / self.input_channels as f32);
        }

        let step = self.input_sample_rate_hz as f64
            / MicrophoneAudioFormat::mvp_pcm_16khz_mono().sample_rate_hz as f64;
        let mut bytes = Vec::new();
        while self.next_source_position < mono_samples.len() as f64 {
            let source_index = self.next_source_position.floor() as usize;
            let sample = f32_to_pcm_i16(mono_samples[source_index]);
            bytes.extend_from_slice(&sample.to_le_bytes());
            self.next_source_position += step;
        }
        self.next_source_position -= mono_samples.len() as f64;

        if bytes.is_empty() {
            None
        } else {
            Some(AudioFrame::new(bytes))
        }
    }

    pub fn push_i16_interleaved(&mut self, samples: &[i16]) -> Option<AudioFrame> {
        let samples = samples
            .iter()
            .copied()
            .map(i16_to_f32_sample)
            .collect::<Vec<_>>();
        self.push_f32_interleaved(&samples)
    }

    pub fn push_u16_interleaved(&mut self, samples: &[u16]) -> Option<AudioFrame> {
        let samples = samples
            .iter()
            .copied()
            .map(u16_to_f32_sample)
            .collect::<Vec<_>>();
        self.push_f32_interleaved(&samples)
    }
}

fn f32_to_pcm_i16(sample: f32) -> i16 {
    let sample = sample.clamp(-1.0, 1.0);
    if sample <= -1.0 {
        i16::MIN
    } else {
        (sample * i16::MAX as f32).round() as i16
    }
}

fn i16_to_f32_sample(sample: i16) -> f32 {
    if sample == i16::MAX {
        1.0
    } else {
        sample as f32 / 32_768.0
    }
}

fn u16_to_f32_sample(sample: u16) -> f32 {
    if sample == u16::MAX {
        1.0
    } else {
        (sample as f32 - 32_768.0) / 32_768.0
    }
}
