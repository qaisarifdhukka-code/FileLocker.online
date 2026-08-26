import { StreamingHtmlReader } from '../output/streaming-html-reader';
import { decryptChunk } from '../crypto/decrypt';

export async function parseVaultHeader(lockedFile: File) {
  const htmlReader = new StreamingHtmlReader(lockedFile);
  await htmlReader.initialize();
  
  // Read enough bytes to parse the header (Magic + Version + MetaLen + Meta + Nonce)
  const fileSlice = lockedFile.slice(htmlReader.binaryStartOffset, htmlReader.binaryStartOffset + 1024 * 1024);
  const buffer = await fileSlice.arrayBuffer();
  const dataView = new DataView(buffer);
  
  const magic = new Uint8Array(buffer, 0, 4);
  const magicStr = new TextDecoder().decode(magic);
  if (magicStr !== 'VLKT') {
    throw new Error('Invalid vault file: Missing VLKT magic bytes.');
  }
  
  const metaLen = dataView.getUint32(5, true);
  
  const metaBytes = new Uint8Array(buffer, 9, metaLen);
  const metaJson = new TextDecoder().decode(metaBytes);
  const metadata = JSON.parse(metaJson);
  
  const nonceStart = 9 + metaLen;
  const globalNonce = new Uint8Array(buffer, nonceStart, 8);
  
  const payloadStart = htmlReader.binaryStartOffset + nonceStart + 8;
  const totalEncryptedSize = lockedFile.size - payloadStart;
  
  return { metadata, globalNonce, payloadStart, totalEncryptedSize };
}

export async function decryptVault(
  lockedFile: File,
  payloadStart: number,
  totalEncryptedSize: number,
  key: CryptoKey,
  outputWritable: any, // FileSystemWritableFileStream
  onProgress?: (percent: number) => void
): Promise<void> {
  const CHUNK_SIZE = 10 * 1024 * 1024;
  const ENCRYPTED_CHUNK_SIZE = CHUNK_SIZE + 28; // IV(12) + Tag(16)
  
  let chunkCounter = 0;
  let leftover = new Uint8Array(0);
  let bytesProcessed = 0;
  
  // Slice the file to bypass HTML and Header, streaming only the encrypted payload
  const payloadBlob = lockedFile.slice(payloadStart);
  const payloadStream = payloadBlob.stream();
  const payloadReader = payloadStream.getReader();
  
  while (true) {
    const { done, value } = await payloadReader.read();
    
    if (value) {
      const newLeftover = new Uint8Array(leftover.length + value.length);
      newLeftover.set(leftover, 0);
      newLeftover.set(value, leftover.length);
      leftover = newLeftover;
      
      while (leftover.length >= ENCRYPTED_CHUNK_SIZE) {
        const encryptedChunk = leftover.slice(0, ENCRYPTED_CHUNK_SIZE);
        const plainChunk = await decryptChunk(encryptedChunk, key);
        await outputWritable.write(plainChunk);
        
        chunkCounter++;
        bytesProcessed += ENCRYPTED_CHUNK_SIZE;
        leftover = leftover.slice(ENCRYPTED_CHUNK_SIZE);
        
        if (onProgress) onProgress(Math.min(99, Math.round((bytesProcessed / totalEncryptedSize) * 100)));
        if (chunkCounter % 5 === 0) await new Promise(r => setTimeout(r, 0));
      }
    }
    
    if (done) {
      if (leftover.length > 0) {
        const plainChunk = await decryptChunk(leftover, key);
        await outputWritable.write(plainChunk);
        bytesProcessed += leftover.length;
        if (onProgress) onProgress(Math.min(99, Math.round((bytesProcessed / totalEncryptedSize) * 100)));
      }
      break;
    }
  }
  
  if (onProgress) onProgress(100);
  
  try {
    await outputWritable.close();
  } catch (err: any) {
    if (err.name === 'NotReadableError' || err.message.includes('state had changed') || err.message.includes('modified')) {
      throw new Error("Antivirus Lock: Decryption finished, but your antivirus is scanning the final file. Rename the .crswap file manually to access it.");
    }
    throw err;
  }
}
