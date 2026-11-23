export class PRNG {
  private a: number;

  constructor(seed: number) {
    // Ensure the seed is an integer
    this.a = seed | 0; 
  }

  /**
   * Returns a deterministic float between 0 (inclusive) and 1 (exclusive).
   */
  public next(): number {
    let t = this.a += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /**
   * Helper: Returns a deterministic integer between min (inclusive) and max (exclusive).
   */
  public nextInt(min: number, max: number): number {
    return Math.floor(this.next() * (max - min)) + min;
  }
}