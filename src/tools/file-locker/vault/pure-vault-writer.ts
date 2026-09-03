import { encryptChunk } from '../crypto/encrypt';
import { getFilesRecursively, createTarStream, bufferStream } from './FolderTar';
import { CHUNK_SIZE, VAULT_MAGIC, VAULT_VERSION } from './constants';

/**
 * Creates a pure binary `.vault` file using the File System Access API (showSaveFilePicker).
 * 
 * Vault Format (identical to the desktop provisioning-app):
 * [MAGIC:4][VERSION:1][META_LEN:4 LE][META_JSON][CHUNK_NONCE:8][CHUNKS...]
 * Each chunk: [IV:12][TAG:16][CIPHERTEXT]
 * 
 * This format is 100% compatible with the existing unlock-app.
 */
export type VaultSource = {
  name: string;
  size: number; // For folders, this is estimated sum of file sizes
  isFolder?: boolean;
  dirHandle?: any;
  file?: any;
  getStream: () => AsyncIterable<Uint8Array>;
};

export async function createPureVault(
  source: VaultSource,
  key: CryptoKey,
  globalNonce: Uint8Array,
  metadataJson: string,
  onProgress?: (percent: number, label?: string) => void
): Promise<{ status: 'success' | 'os_lock', filename?: string }> {
  const totalSize = source.size;
  const CHUNK_SIZE = 10 * 1024 * 1024; // 10 MB
  let stage = 'Initializing';
  let fileHandle;
  let writable;

  try {
    stage = 'Generating unique filename';
    // Generate collision-safe filename
    const dateStr = new Date().toISOString().replace(/[:\-T]/g, '').slice(0, 14);
    const randHex = Math.floor(Math.random() * 0xffff).toString(16).padStart(4, '0');
    let baseName = source.name;
    const lastDot = baseName.lastIndexOf('.');
    if (lastDot !== -1) {
      baseName = baseName.substring(0, lastDot);
    }
    const safeFilename = `${baseName}-${dateStr}-${randHex}.vault`;

    stage = 'Opening save picker';
    // @ts-ignore
    fileHandle = await window.showSaveFilePicker({
      suggestedName: safeFilename
    });

    stage = 'Creating writable stream';
    writable = await fileHandle.createWritable();

    // --- PHASE 3: Added Metadata Header ---
    stage = 'Encoding metadata';
    const encoder = new TextEncoder();
    const metaBuf = encoder.encode(metadataJson);

    stage = 'Writing header';
    // Write header: MAGIC(4) + VERSION(1) + META_LEN(4 LE) + META_JSON + CHUNK_NONCE(8)
    const headerBuf = new Uint8Array(4 + 1 + 4 + metaBuf.length + 8);
    headerBuf.set(VAULT_MAGIC, 0);
    headerBuf.set([VAULT_VERSION], 4);
    const view = new DataView(headerBuf.buffer);
    view.setUint32(5, metaBuf.length, true); // Little Endian
    headerBuf.set(metaBuf, 9);
    headerBuf.set(globalNonce, 9 + metaBuf.length);

    await writable.write(headerBuf);
    // --------------------------------------

    // Phase 2: NO HEADER, NO PROGRESS UPDATES. YES CRYPTO.
    // -> Now Phase 3: YES HEADER, NO PROGRESS UPDATES. YES CRYPTO.
    let offset = 0;
    let chunkCounter = 0;
    const stream = source.getStream();

    for await (const plainChunk of stream) {
      stage = `Encrypting chunk at offset ${offset}`;
      const encryptedChunk = await encryptChunk(plainChunk, key, globalNonce, chunkCounter);

      stage = `Writing encrypted chunk at offset ${offset}`;
      await writable.write(encryptedChunk);

      offset += plainChunk.length;
      chunkCounter++;

      if (onProgress) {
        // Original unthrottled progress update (once per 10MB chunk = ~3 times per second)
        onProgress(Math.min(99, Math.round((offset / totalSize) * 100)));
      }

      // Yield to event loop for GC
      if (chunkCounter % 5 === 0) {
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }

    stage = 'Closing writable stream';
    // Anti-Lock Mechanism: Wait for Windows Defender to finish scanning the .crswap file
    // before we attempt to close() and trigger the rename.
    console.log("[finalize] Waiting 10 seconds for OS locks to release...");
    for (let i = 10; i > 0; i--) {
      if (onProgress) onProgress(99, `Finalizing... please wait ${i}s for OS locks to release`);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    console.log("[finalize] All chunks written successfully.");
    console.log("[finalize] Calling writable.close()");

    try {
      if (onProgress) onProgress(99, 'Renaming file to .vault...');
      await writable.close();
      console.log("[finalize] writable.close() SUCCESS");
      if (onProgress) onProgress(100, 'Encryption complete');
      return { status: 'success', filename: fileHandle?.name };
    } catch (error: any) {
      console.error("[finalize] writable.close() FAILED", error);
      
      if (error.name === 'InvalidModificationError' || (error.message && error.message.includes('state had changed'))) {
        try {
          if (fileHandle && typeof fileHandle.remove === 'function') {
            await fileHandle.remove();
            console.log("[finalize] Removed 0-byte placeholder file");
          }
        } catch (rmErr) {
          console.error("[finalize] Failed to remove 0-byte placeholder", rmErr);
        }
        return { status: 'os_lock', filename: fileHandle?.name };
      }
      
      throw error;
    }
  } catch (err: any) {
    console.error(`[${stage}] Original error:`, err);
    try {
      if (writable) await writable.abort();
    } catch (abortErr) {
      console.error(`Error during writable.abort():`, abortErr);
    }
    throw new Error(`[${stage}] ${err.message}`);
  }
}
