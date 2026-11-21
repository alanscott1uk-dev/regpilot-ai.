declare module "@yarflam/potion-base-8m" {
  export function embed(texts: string[]): Promise<Float32Array[]>;
  export function cosineSimilarity(a: Float32Array, b: Float32Array): number;
}
