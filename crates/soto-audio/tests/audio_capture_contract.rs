use soto_audio::{
    AudioCaptureBuffer, AudioConversionError, AudioFrame, AudioFrameQueue, BufferedAudioRecorder,
    BufferedRecordingFileRecorder, MicrophoneAudioFormat, MicrophoneFrameConverter,
    NativeMicrophoneRecorder, QueueFrameError, RecorderError, RecordingAudioFormat,
    RecordingFileRecorder, read_recording_file_audio_bytes,
};

#[test]
fn microphone_format_matches_doubao_streaming_requirements() {
    let format = MicrophoneAudioFormat::mvp_pcm_16khz_mono();

    assert_eq!(format.sample_rate_hz, 16_000);
    assert_eq!(format.channels, 1);
    assert_eq!(format.encoding, "pcm_s16le");
    assert_eq!(
        format.to_recording_audio_format(),
        RecordingAudioFormat {
            sample_rate_hz: 16_000,
            channels: 1,
            encoding: "pcm_s16le".into(),
        }
    );
}

#[test]
fn audio_frame_queue_accepts_frames_without_blocking_and_reports_overflow() {
    let (queue, receiver) = AudioFrameQueue::bounded(1);

    assert_eq!(queue.push(AudioFrame::new(vec![1, 2])), Ok(()));
    assert_eq!(
        queue.push(AudioFrame::new(vec![3, 4])).unwrap_err(),
        QueueFrameError::Full(AudioFrame::new(vec![3, 4]))
    );
    assert_eq!(receiver.try_recv().unwrap(), AudioFrame::new(vec![1, 2]));
}

#[test]
fn microphone_converter_downmixes_stereo_f32_to_16khz_mono_pcm16() {
    let mut converter = MicrophoneFrameConverter::new(16_000, 2).unwrap();

    let frame = converter
        .push_f32_interleaved(&[0.5, -0.5, 1.0, 1.0, -1.0, -1.0])
        .expect("converted frame");

    assert_eq!(
        frame.bytes,
        [
            0x00, 0x00, // 0.0
            0xff, 0x7f, // 1.0
            0x00, 0x80, // -1.0
        ]
    );
}

#[test]
fn microphone_converter_resamples_48khz_mono_to_16khz_pcm16_frames() {
    let mut converter = MicrophoneFrameConverter::new(48_000, 1).unwrap();

    let frame = converter
        .push_f32_interleaved(&[0.0, 0.25, 0.5, 0.75, 1.0, -1.0])
        .expect("converted frame");

    assert_eq!(
        frame.bytes,
        [
            0x00, 0x00, // source frame 0
            0xff, 0x5f, // source frame 3, 0.75
        ]
    );
}

#[test]
fn microphone_converter_preserves_resampling_phase_across_callback_chunks() {
    let mut converter = MicrophoneFrameConverter::new(48_000, 1).unwrap();

    let first = converter
        .push_f32_interleaved(&[0.25, 0.5])
        .expect("first converted frame");
    let second = converter
        .push_f32_interleaved(&[0.75, 1.0])
        .expect("second converted frame");

    assert_eq!(first.bytes, [0x00, 0x20]);
    assert_eq!(second.bytes, [0xff, 0x7f]);
}

#[test]
fn microphone_converter_accepts_i16_and_u16_interleaved_samples() {
    let mut i16_converter = MicrophoneFrameConverter::new(16_000, 1).unwrap();
    let mut u16_converter = MicrophoneFrameConverter::new(16_000, 1).unwrap();

    let i16_frame = i16_converter
        .push_i16_interleaved(&[i16::MIN, 0, i16::MAX])
        .expect("i16 frame");
    let u16_frame = u16_converter
        .push_u16_interleaved(&[0, 32_768, u16::MAX])
        .expect("u16 frame");

    assert_eq!(
        i16_frame.bytes,
        [
            0x00, 0x80, // -1.0
            0x00, 0x00, // 0.0
            0xff, 0x7f, // 1.0
        ]
    );
    assert_eq!(
        u16_frame.bytes,
        [
            0x00, 0x80, // -1.0
            0x00, 0x00, // centered unsigned silence
            0xff, 0x7f, // 1.0
        ]
    );
}

#[test]
fn microphone_converter_rejects_invalid_input_format() {
    assert_eq!(
        MicrophoneFrameConverter::new(0, 1).unwrap_err(),
        AudioConversionError::InvalidSampleRate
    );
    assert_eq!(
        MicrophoneFrameConverter::new(16_000, 0).unwrap_err(),
        AudioConversionError::InvalidChannelCount
    );
}

#[test]
fn capture_buffer_drains_frames_in_order_and_finalizes_once() {
    let (queue, receiver) = AudioFrameQueue::bounded(4);
    let mut buffer = AudioCaptureBuffer::new(MicrophoneAudioFormat::mvp_pcm_16khz_mono());

    queue.push(AudioFrame::new(vec![1, 2])).unwrap();
    queue.push(AudioFrame::new(vec![3, 4])).unwrap();

    assert_eq!(buffer.drain_from(&receiver), 2);
    assert!(!buffer.is_empty());
    assert_eq!(buffer.frame_count(), 2);

    let captured = buffer.finish();

    assert_eq!(captured.format, MicrophoneAudioFormat::mvp_pcm_16khz_mono());
    assert_eq!(captured.bytes, vec![1, 2, 3, 4]);
    assert!(buffer.is_empty());
    assert_eq!(buffer.frame_count(), 0);
}

#[test]
fn silent_capture_finalizes_to_empty_audio() {
    let mut buffer = AudioCaptureBuffer::new(MicrophoneAudioFormat::mvp_pcm_16khz_mono());

    let captured = buffer.finish();

    assert!(captured.bytes.is_empty());
}

#[test]
fn buffered_recorder_finishes_pending_frames_in_order() {
    let mut recorder = BufferedAudioRecorder::new(MicrophoneAudioFormat::mvp_pcm_16khz_mono(), 4);
    let queue = recorder.frame_queue();

    recorder.start().unwrap();
    queue.push(AudioFrame::new(vec![1, 2])).unwrap();
    queue.push(AudioFrame::new(vec![3, 4])).unwrap();

    let captured = recorder.finish().unwrap();

    assert_eq!(captured.format, MicrophoneAudioFormat::mvp_pcm_16khz_mono());
    assert_eq!(captured.bytes, vec![1, 2, 3, 4]);
}

#[test]
fn buffered_recorder_rejects_invalid_lifecycle_edges() {
    let mut recorder = BufferedAudioRecorder::new(MicrophoneAudioFormat::mvp_pcm_16khz_mono(), 4);

    assert_eq!(recorder.finish().unwrap_err(), RecorderError::NotRecording);
    recorder.start().unwrap();
    assert_eq!(
        recorder.start().unwrap_err(),
        RecorderError::AlreadyRecording
    );
}

#[test]
fn buffered_recorder_cancel_drops_pending_frames_and_allows_restart() {
    let mut recorder = BufferedAudioRecorder::new(MicrophoneAudioFormat::mvp_pcm_16khz_mono(), 4);
    let queue = recorder.frame_queue();

    recorder.start().unwrap();
    queue.push(AudioFrame::new(vec![9, 9])).unwrap();
    recorder.cancel().unwrap();
    assert_eq!(recorder.finish().unwrap_err(), RecorderError::NotRecording);

    recorder.start().unwrap();
    queue.push(AudioFrame::new(vec![5])).unwrap();
    let captured = recorder.finish().unwrap();

    assert_eq!(captured.bytes, vec![5]);
}

#[test]
fn native_microphone_recorder_exposes_mvp_output_format_and_records_to_file_artifacts() {
    let recorder = NativeMicrophoneRecorder::new_with_frame_capacity(4);

    assert_eq!(
        recorder.format(),
        &MicrophoneAudioFormat::mvp_pcm_16khz_mono()
    );
    assert!(recorder.frame_queue().is_none());
}

#[test]
fn native_microphone_recorder_tracks_requested_device_id() {
    let recorder =
        NativeMicrophoneRecorder::new_with_device_id(Some("Built-in Microphone".into()), 4);

    assert_eq!(recorder.device_id(), Some("Built-in Microphone"));
}

#[test]
fn recording_file_recorder_finishes_complete_wav_artifact_and_flushes_last_frame() {
    let temp = tempfile::tempdir().expect("tempdir");
    let mut recorder = BufferedRecordingFileRecorder::new_in_directory(
        MicrophoneAudioFormat::mvp_pcm_16khz_mono(),
        temp.path(),
    );

    recorder.start().unwrap();
    let queue = recorder.frame_queue().expect("active frame queue");
    queue.push(AudioFrame::new(pcm_i16_bytes(0..100))).unwrap();
    queue
        .push(AudioFrame::new(pcm_i16_bytes(100..1_500)))
        .unwrap();
    queue
        .push(AudioFrame::new(pcm_i16_bytes(1_500..1_600)))
        .unwrap();

    let captured = recorder.finish().unwrap();

    assert!(captured.path.exists());
    assert_eq!(captured.format, "wav");
    assert_eq!(captured.sample_rate_hz, 16_000);
    assert_eq!(captured.channels, 1);
    assert_eq!(captured.encoding, "pcm_s16le");
    assert_eq!(captured.byte_count, 3_200);
    assert_eq!(captured.duration_ms, 100);
    assert_eq!(std::fs::metadata(&captured.path).unwrap().len(), 3_244);
    assert_eq!(captured.frames_received, 3);
    assert_eq!(captured.frames_written, 3);
    assert_eq!(captured.dropped_frames, 0);
    assert_eq!(captured.queue_full, 0);

    let audio = read_recording_file_audio_bytes(&captured).unwrap();
    assert_eq!(audio.len(), 3_200);
    assert_eq!(pcm_sample_at(&audio, 0), 0);
    assert_eq!(pcm_sample_at(&audio, 800), 800);
    assert_eq!(pcm_sample_at(&audio, 1_599), 1_599);
}

#[test]
fn analyze_recording_reports_zero_peak_for_silent_pcm() {
    let dir = tempfile::tempdir().unwrap();
    let mut recorder = BufferedRecordingFileRecorder::new_in_directory(
        MicrophoneAudioFormat::mvp_pcm_16khz_mono(),
        dir.path(),
    );
    recorder.start().unwrap();
    let queue = recorder.frame_queue().unwrap();
    queue.push(AudioFrame::new(vec![0u8; 32_000])).unwrap();
    let captured = recorder.finish().unwrap();

    let stats = soto_audio::analyze_recording(&captured).unwrap();

    assert_eq!(stats.duration_ms, 1_000);
    assert_eq!(stats.peak, 0.0);
    assert_eq!(stats.rms, 0.0);
    assert_eq!(stats.sample_count, 16_000);
}

#[test]
fn analyze_recording_reports_peak_for_loud_pcm() {
    let dir = tempfile::tempdir().unwrap();
    let mut recorder = BufferedRecordingFileRecorder::new_in_directory(
        MicrophoneAudioFormat::mvp_pcm_16khz_mono(),
        dir.path(),
    );
    recorder.start().unwrap();
    let queue = recorder.frame_queue().unwrap();
    let samples: Vec<i16> = vec![16_384i16; 4_000];
    let bytes: Vec<u8> = samples.iter().flat_map(|s| s.to_le_bytes()).collect();
    queue.push(AudioFrame::new(bytes)).unwrap();
    let captured = recorder.finish().unwrap();

    let stats = soto_audio::analyze_recording(&captured).unwrap();

    assert_eq!(stats.duration_ms, 250);
    assert!((stats.peak - 0.5).abs() < 1e-4, "peak={}", stats.peak);
    assert!((stats.rms - 0.5).abs() < 1e-4, "rms={}", stats.rms);
    assert_eq!(stats.sample_count, 4_000);
}

#[test]
fn recorder_does_not_drop_tail_when_recording_exceeds_queue_capacity() {
    let temp = tempfile::tempdir().expect("tempdir");
    let mut recorder = BufferedRecordingFileRecorder::new_in_directory(
        MicrophoneAudioFormat::mvp_pcm_16khz_mono(),
        temp.path(),
    );

    recorder.start().unwrap();
    let queue = recorder.frame_queue().expect("active frame queue");
    for frame_index in 0..80 {
        queue
            .push(AudioFrame::new(pcm_i16_bytes(frame_index..frame_index + 1)))
            .unwrap();
    }

    let captured = recorder.finish().unwrap();
    let audio = read_recording_file_audio_bytes(&captured).unwrap();

    assert_eq!(captured.frames_received, 80);
    assert_eq!(captured.frames_written, 80);
    assert_eq!(captured.dropped_frames, 0);
    assert_eq!(captured.queue_full, 0);
    assert_eq!(audio.len(), 160);
    assert_eq!(pcm_sample_at(&audio, 0), 0);
    assert_eq!(pcm_sample_at(&audio, 63), 63);
    assert_eq!(pcm_sample_at(&audio, 79), 79);
}

#[test]
fn recording_file_recorder_cancel_deletes_temporary_file_and_allows_restart() {
    let temp = tempfile::tempdir().expect("tempdir");
    let mut recorder = BufferedRecordingFileRecorder::new_in_directory(
        MicrophoneAudioFormat::mvp_pcm_16khz_mono(),
        temp.path(),
    );

    recorder.start().unwrap();
    let first_path = recorder
        .active_recording_path()
        .expect("active recording path")
        .to_path_buf();
    assert!(first_path.exists());
    recorder
        .frame_queue()
        .expect("active frame queue")
        .push(AudioFrame::new(pcm_i16_bytes(1..2)))
        .unwrap();
    recorder.cancel().unwrap();

    assert!(!first_path.exists());
    recorder.start().unwrap();
    recorder
        .frame_queue()
        .expect("active frame queue")
        .push(AudioFrame::new(pcm_i16_bytes(7..8)))
        .unwrap();
    let captured = recorder.finish().unwrap();

    assert_ne!(captured.path, first_path);
    assert_eq!(read_recording_file_audio_bytes(&captured).unwrap(), [7, 0]);
}

#[test]
fn level_snapshot_returns_none_before_start_and_after_finish() {
    let mut rec = BufferedRecordingFileRecorder::new(MicrophoneAudioFormat::mvp_pcm_16khz_mono());
    assert!(rec.level_snapshot_handle().is_none());
    rec.start().unwrap();
    let handle = rec.level_snapshot_handle().expect("handle while recording");
    assert_eq!(handle.snapshot(), None, "no frames yet");
    rec.finish().unwrap();
    assert!(rec.level_snapshot_handle().is_none());
}

fn pcm_i16_bytes(range: std::ops::Range<i16>) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(range.len() * 2);
    for sample in range {
        bytes.extend_from_slice(&sample.to_le_bytes());
    }
    bytes
}

fn pcm_sample_at(bytes: &[u8], index: usize) -> i16 {
    let offset = index * 2;
    i16::from_le_bytes(bytes[offset..offset + 2].try_into().unwrap())
}
