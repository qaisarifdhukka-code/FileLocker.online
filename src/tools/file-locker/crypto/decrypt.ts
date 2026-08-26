/**
 * Web Crypto AES-GCM Decrypt
 * 
 * The Desktop chunk format is:
 * [ IV (12 bytes) | Tag (16 bytes) | Ciphertext ]
 * 
 * Web Crypto `crypto.subtle.decrypt` expects:
 * [ Ciphertext | Tag (16 bytes) ]
 * 
 * We manually reconstruct the payload before passing to Web Crypto.
 */
export async function decryptChunk(
  encryptedChunkData: Uint8Array, // Contains IV + Tag + Ciphertext
  key: CryptoKey
): Promise<Uint8Array> {
  if (encryptedChunkData.length < 28) {
    throw new Error("Chunk is too small to contain IV and Tag.");
  }
  
  const iv = encryptedChunkData.slice(0, 12);
  const tag = encryptedChunkData.slice(12, 28);
  const ciphertext = encryptedChunkData.slice(28);
  
  // Reconstruct for Web Crypto: [ Ciphertext | Tag ]
  const webCryptoPayload = new Uint8Array(ciphertext.length + tag.length);
  webCryptoPayload.set(ciphertext, 0);
  webCryptoPayload.set(tag, ciphertext.length);
  
  // Decrypt
  const decryptedBuffer = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    webCryptoPayload
  );
  
  return new Uint8Array(decryptedBuffer);
}
