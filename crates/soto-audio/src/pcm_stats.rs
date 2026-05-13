//! PCM i16 LE sample statistics shared by the recording writer (per-frame
//! level meter) and recording analysis (session-wide stats).

/// Peak amplitude (max |sample| / 32768) and RMS over the given i16 samples.
/// Returns (rms, peak), each in the range [0.0, 1.0]. Empty input returns
/// (0.0, 0.0).
pub(crate) fn rms_and_peak(samples: &[i16]) -> (f32, f32) {
    if samples.is_empty() {
        return (0.0, 0.0);
    }
    let peak = samples
        .iter()
        .map(|s| i32::from(*s).abs() as f32 / 32768.0)
        .fold(0.0f32, f32::max);
    let rms = (samples
        .iter()
        .map(|s| ((*s as f32) / 32768.0).powi(2))
        .sum::<f32>()
        / samples.len() as f32)
        .sqrt();
    (rms, peak)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_input_returns_zero() {
        assert_eq!(rms_and_peak(&[]), (0.0, 0.0));
    }

    #[test]
    fn all_zeros_return_zero() {
        let samples = vec![0i16; 1024];
        assert_eq!(rms_and_peak(&samples), (0.0, 0.0));
    }

    #[test]
    fn single_full_scale_sample_yields_peak_one() {
        let (_rms, peak) = rms_and_peak(&[i16::MAX]);
        assert!((peak - (32767.0 / 32768.0)).abs() < 1e-6, "peak={peak}");
    }

    #[test]
    fn negative_full_scale_uses_abs_for_peak() {
        let (_rms, peak) = rms_and_peak(&[i16::MIN]);
        assert!((peak - 1.0).abs() < 1e-6, "peak={peak}");
    }

    #[test]
    fn constant_amplitude_rms_equals_amplitude() {
        let value = 16_384i16;
        let samples = vec![value; 1000];
        let (rms, peak) = rms_and_peak(&samples);
        assert!((rms - 0.5).abs() < 1e-4, "rms={rms}");
        assert!((peak - 0.5).abs() < 1e-4, "peak={peak}");
    }
}
