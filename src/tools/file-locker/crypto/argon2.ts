import { argon2id } from 'hash-wasm';
import { ARGON2_CONFIG } from '../vault/constants';

/**
 * Derives a 32-byte encryption key from the password and salt
 * using Argon2id with parameters matching the desktop application.
 */
export async function deriveKey(password: string, salt: Uint8Array): Promise<Uint8Array> {
  return await argon2id({
    password: password,
    salt: salt,
    parallelism: ARGON2_CONFIG.parallelism,
    iterations: ARGON2_CONFIG.iterations,
    memorySize: ARGON2_CONFIG.memorySize,
    hashLength: ARGON2_CONFIG.hashLength,
    outputType: ARGON2_CONFIG.outputType
  });
}
