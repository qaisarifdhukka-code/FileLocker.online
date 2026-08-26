/**
 * Web Crypto AES-GCM Encrypt
 * 
 * IMPORTANT: The Desktop App expects the chunk format to be:
 * [ IV (12 bytes) | Tag (16 bytes) | Ciphertext ]
 * 
 * Web Crypto `crypto.subtle.encrypt` outputs:
 * [ Ciphertext | Tag (16 bytes) ]
 * 
 * We manually extract the 16-byte tag from the end of the Web Crypto output,
 * and prepend it (along with the IV) to match the Desktop format.
 */
export async function encryptChunk(
  plainChunk: Uint8Array,
  key: CryptoKey,
  globalNonce: Uint8Array, // 8 bytes
  chunkCounter: number
): Promise<Uint8Array> {
  // 1. Construct the 12-byte IV for this chunk
  // IV = [ 8-byte global nonce ] + [ 4-byte chunk counter (Big Endian) ]
  const iv = new Uint8Array(12);
  iv.set(globalNonce, 0);
  
  const view = new DataView(iv.buffer);
  view.setUint32(8, chunkCounter, false); // false = Big Endian

  // 2. Encrypt using Web Crypto
  const encryptedBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    plainChunk
  );
  
  const webCryptoOutput = new Uint8Array(encryptedBuffer);
  
  // 3. Extract the tag and ciphertext
  const tagStart = webCryptoOutput.length - 16;
  const tag = webCryptoOutput.slice(tagStart);
  const ciphertext = webCryptoOutput.slice(0, tagStart);
  
  // 4. Reconstruct to match Desktop format: [ IV | Tag | Ciphertext ]
  const finalChunk = new Uint8Array(iv.length + tag.length + ciphertext.length);
  finalChunk.set(iv, 0);
  finalChunk.set(tag, iv.length);
  finalChunk.set(ciphertext, iv.length + tag.length);
  
  return finalChunk;
}
