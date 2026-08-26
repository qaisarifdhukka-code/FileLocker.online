import { StreamingHtmlWriter, createDownloadStream } from '../output/streaming-html-writer';
import { encryptChunk } from '../crypto/encrypt';
import { CHUNK_SIZE, VAULT_MAGIC, VAULT_VERSION } from './constants';

export async function createVault(
  inputFile: File,
  key: CryptoKey,
  globalNonce: Uint8Array,
  htmlTemplate: string,
  metadataJson: string,
  htmlWriter: StreamingHtmlWriter,
  onProgress?: (percent: number) => void
): Promise<void> {
  const totalSize = inputFile.size;

  // 1. Initialize HTML + Metadata (writes the text portion)
  await htmlWriter.initialize(htmlTemplate, metadataJson);

  // 2. Write Vault Header (Magic bytes + Version + MetaLen + Meta + Nonce)
  // This begins the raw binary section of the file
  const encoder = new TextEncoder();
  const metaBuf = encoder.encode(metadataJson);
  
  const headerBuf = new Uint8Array(4 + 1 + 4 + metaBuf.length + 8);
  headerBuf.set(VAULT_MAGIC, 0);
  headerBuf.set([VAULT_VERSION], 4);
  
  const view = new DataView(headerBuf.buffer);
  view.setUint32(5, metaBuf.length, true); // Little Endian for MetaLen
  
  headerBuf.set(metaBuf, 9);
  headerBuf.set(globalNonce, 9 + metaBuf.length);
  
  await htmlWriter.appendChunk(headerBuf);

  // 3. Stream and Encrypt Chunks
  let offset = 0;
  let chunkCounter = 0;

  const stream = inputFile.stream();
  const reader = stream.getReader();
  let leftover = new Uint8Array(0);

  while (true) {
    const { done, value } = await reader.read();

    if (value) {
      // Accumulate data
      const newLeftover = new Uint8Array(leftover.length + value.length);
      newLeftover.set(leftover, 0);
      newLeftover.set(value, leftover.length);
      leftover = newLeftover;

      // Process exactly CHUNK_SIZE pieces
      while (leftover.length >= CHUNK_SIZE) {
        const plainChunk = leftover.slice(0, CHUNK_SIZE);
        const encryptedChunk = await encryptChunk(plainChunk, key, globalNonce, chunkCounter);
        await htmlWriter.appendChunk(encryptedChunk);

        offset += CHUNK_SIZE;
        chunkCounter++;
        leftover = leftover.slice(CHUNK_SIZE);

        if (onProgress) {
          onProgress(Math.min(99, Math.round((offset / totalSize) * 100)));
        }

        // Yield to event loop to allow Garbage Collection
        if (chunkCounter % 5 === 0) {
          await new Promise(resolve => setTimeout(resolve, 0));
        }
      }
    }

    if (done) {
      // Flush the remaining tail
      if (leftover.length > 0) {
        const encryptedChunk = await encryptChunk(leftover, key, globalNonce, chunkCounter);
        await htmlWriter.appendChunk(encryptedChunk);
        offset += leftover.length;
        if (onProgress) {
          onProgress(Math.min(99, Math.round((offset / totalSize) * 100)));
        }
      }
      break;
    }
  }

  // 4. Close the stream
  if (onProgress) onProgress(100);
  
  try {
    await htmlWriter.close();
  } catch (err: any) {
    throw new Error(`CRITICAL: Stream permanently failed during close: ${err.message}`);
  }
}
