/**
 * Mic tap running on the audio thread.
 *
 * Its only job is to hand the main thread exactly one frame's worth of samples
 * at a time. Framing here rather than in the encoder keeps the timestamps we
 * generate honest: each message is a known number of samples, so the running
 * count is the true position in the stream.
 *
 * Plain JS on purpose — worklet modules are loaded by URL, not bundled with the
 * app, so there is no TypeScript to strip.
 */
class PcmFrameProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.frameSize = options.processorOptions.frameSize;
    this.buffer = new Float32Array(this.frameSize);
    this.filled = 0;
  }

  process(inputs) {
    const channel = inputs[0]?.[0];
    // No input connected yet, or the track ended. Staying alive is correct:
    // returning false here would permanently kill the node.
    if (!channel) return true;

    for (let i = 0; i < channel.length; i++) {
      this.buffer[this.filled++] = channel[i];
      if (this.filled === this.frameSize) {
        // Transfer a copy: the buffer is reused immediately for the next frame.
        const frame = this.buffer.slice();
        this.port.postMessage(frame, [frame.buffer]);
        this.filled = 0;
      }
    }
    return true;
  }
}

registerProcessor('pcm-frame-processor', PcmFrameProcessor);
