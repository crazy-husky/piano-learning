const PROCESSOR_NAME = "staff-game-lookahead-limiter";

class StaffGameLookaheadLimiter extends AudioWorkletProcessor {
  constructor({ processorOptions = {} } = {}) {
    super();
    const lookAheadMs = Math.max(1, processorOptions.lookAheadMs ?? 5);
    const releaseMs = Math.max(1, processorOptions.releaseMs ?? 60);
    const ceilingDb = Math.min(-0.1, processorOptions.ceilingDb ?? -2);

    this.lookAheadFrames = Math.max(1, Math.round((sampleRate * lookAheadMs) / 1_000));
    this.delayLength = this.lookAheadFrames + 1;
    this.dequeCapacity = this.delayLength + 1;
    this.ceiling = 10 ** (ceilingDb / 20);
    this.releaseCoefficient = Math.exp(-1 / (sampleRate * (releaseMs / 1_000)));
    this.delayLines = [];
    this.peakDequeFrames = new Float64Array(this.dequeCapacity);
    this.peakDequeValues = new Float32Array(this.dequeCapacity);
    this.peakDequeHead = 0;
    this.peakDequeTail = 0;
    this.writeIndex = 0;
    this.frameIndex = 0;
    this.currentGain = 1;
    this.maximumInputPeak = 0;
    this.maximumOutputPeak = 0;
    this.minimumGainApplied = 1;

    this.port.onmessage = ({ data }) => {
      if (data?.type !== "read-peaks") return;
      this.port.postMessage({
        type: "peaks",
        maximumInputPeak: this.maximumInputPeak,
        maximumOutputPeak: this.maximumOutputPeak,
        minimumGainApplied: this.minimumGainApplied,
        ceiling: this.ceiling,
        lookAheadFrames: this.lookAheadFrames,
      });
      this.maximumInputPeak = 0;
      this.maximumOutputPeak = 0;
      this.minimumGainApplied = 1;
    };
  }

  ensureDelayLines(channelCount) {
    while (this.delayLines.length < channelCount) {
      this.delayLines.push(new Float32Array(this.delayLength));
    }
  }

  process(inputs, outputs) {
    const inputChannels = inputs[0] ?? [];
    const outputChannels = outputs[0] ?? [];
    if (outputChannels.length === 0) return true;

    const frameCount = outputChannels[0].length;
    if (inputChannels.length === 0) {
      outputChannels.forEach((channel) => channel.fill(0));
      return true;
    }

    this.ensureDelayLines(inputChannels.length);
    const inputChannelCount = inputChannels.length;

    for (let frame = 0; frame < frameCount; frame += 1) {
      let inputPeak = 0;
      for (let channel = 0; channel < inputChannelCount; channel += 1) {
        const sample = inputChannels[channel][frame];
        const finiteSample = Number.isFinite(sample) ? sample : 0;
        this.delayLines[channel][this.writeIndex] = finiteSample;
        inputPeak = Math.max(inputPeak, Math.abs(finiteSample));
      }
      this.maximumInputPeak = Math.max(this.maximumInputPeak, inputPeak);

      while (
        this.peakDequeTail > this.peakDequeHead &&
        this.peakDequeValues[(this.peakDequeTail - 1) % this.dequeCapacity] <= inputPeak
      ) {
        this.peakDequeTail -= 1;
      }
      const dequeInsertIndex = this.peakDequeTail % this.dequeCapacity;
      this.peakDequeFrames[dequeInsertIndex] = this.frameIndex;
      this.peakDequeValues[dequeInsertIndex] = inputPeak;
      this.peakDequeTail += 1;

      const firstLookAheadFrame = this.frameIndex - this.lookAheadFrames;
      while (
        this.peakDequeTail > this.peakDequeHead &&
        this.peakDequeFrames[this.peakDequeHead % this.dequeCapacity] < firstLookAheadFrame
      ) {
        this.peakDequeHead += 1;
      }

      const lookAheadPeak = this.peakDequeValues[this.peakDequeHead % this.dequeCapacity];
      const targetGain =
        lookAheadPeak > this.ceiling ? this.ceiling / Math.max(lookAheadPeak, 1e-12) : 1;
      if (targetGain < this.currentGain) {
        this.currentGain = targetGain;
      } else {
        this.currentGain = targetGain + (this.currentGain - targetGain) * this.releaseCoefficient;
      }
      this.minimumGainApplied = Math.min(this.minimumGainApplied, this.currentGain);

      const delayedReadIndex = (this.writeIndex + 1) % this.delayLength;
      if (this.frameIndex >= this.lookAheadFrames) {
        for (let channel = 0; channel < outputChannels.length; channel += 1) {
          const inputChannel = Math.min(channel, inputChannelCount - 1);
          const outputSample = this.delayLines[inputChannel][delayedReadIndex] * this.currentGain;
          outputChannels[channel][frame] = outputSample;
          this.maximumOutputPeak = Math.max(this.maximumOutputPeak, Math.abs(outputSample));
        }
      } else {
        outputChannels.forEach((channel) => {
          channel[frame] = 0;
        });
      }

      this.writeIndex = (this.writeIndex + 1) % this.delayLength;
      this.frameIndex += 1;
    }

    return true;
  }
}

registerProcessor(PROCESSOR_NAME, StaffGameLookaheadLimiter);
