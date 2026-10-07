declare module "@audio/pitch-yin" {
  export interface YinOptions {
    fs?: number;
    maxFreq?: number;
    minFreq?: number;
    threshold?: number;
  }

  export default function yin(
    data: Float32Array | Float64Array,
    options?: YinOptions,
  ): { clarity: number; freq: number } | null;
}
