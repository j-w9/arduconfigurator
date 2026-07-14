// @arduconfig/log-analysis — protocol/UI-independent analysis of ArduPilot
// flight logs. The dataflash parser is the shared foundation; individual
// analyses (MAGFit compass calibration, filter tuning, …) build on it.

export {
  parseDataflashLog,
  type ParsedDataflashLog,
  type DataflashFormat,
  type DataflashMessage
} from './dataflash-parser.js'

export {
  powerSpectrum,
  findSpectralPeaks,
  type PowerSpectrum,
  type SpectralPeak,
  type PeakOptions
} from './gyro-fft.js'

export {
  analyzeLogTuning,
  analyzeLogBuffer,
  paramsFromLog,
  type LogTuningResult,
  type TuningRecommendation,
  type AxisSpectrum,
  type Axis,
  type Confidence
} from './notch-tuning-analysis.js'
