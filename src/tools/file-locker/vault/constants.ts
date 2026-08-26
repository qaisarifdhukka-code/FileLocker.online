export const VAULT_MAGIC = new Uint8Array([0x56, 0x4C, 0x4B, 0x54]); // 'VLKT'
export const VAULT_VERSION = 0x01;
export const CHUNK_SIZE = 10 * 1024 * 1024; // 10 MB

// Argon2id parameters (must match desktop exactly)
export const ARGON2_CONFIG = {
  parallelism: 1,
  iterations: 3,
  memorySize: 65536, // 64 MB
  hashLength: 32, // 256-bit key
  outputType: 'binary' as const
};
