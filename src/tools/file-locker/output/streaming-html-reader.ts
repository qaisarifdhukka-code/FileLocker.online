/**
 * Streaming HTML Reader Prototype
 * 
 * To read the raw binary chunks appended to the end of the HTML file,
 * the recipient must supply the `File` object (e.g., via drag and drop).
 * 
 * This reader finds the binary boundary marker and streams the binary data
 * chunk-by-chunk for decryption.
 */

export class StreamingHtmlReader {
  private file: File;
  private binaryStartOffset: number = -1;

  constructor(file: File) {
    this.file = file;
  }

  /**
   * Scans the file to find the boundary marker and sets the binary offset.
   * We only scan the first few megabytes since the HTML shouldn't be massive.
   */
  async initialize(): Promise<void> {
    const boundary = '\n\n---FILELOCKER_BINARY_START---\n\n';
    
    // Read the first 5MB to find the boundary (HTML shouldn't exceed this)
    const scanSize = Math.min(this.file.size, 5 * 1024 * 1024);
    const slice = this.file.slice(0, scanSize);
    const text = await slice.text();
    
    const index = text.indexOf(boundary);
    if (index === -1) {
      throw new Error("Invalid FileLocker file. Boundary marker not found.");
    }
    
    // The exact byte offset where the raw binary data begins
    const encoder = new TextEncoder();
    const htmlPart = text.substring(0, index + boundary.length);
    this.binaryStartOffset = encoder.encode(htmlPart).length;
  }

  /**
   * Returns a ReadableStream that yields the raw encrypted binary chunks.
   * Each yielded chunk corresponds to the exact size written by the writer.
   */
  getChunkStream(chunkSize: number = 10 * 1024 * 1024): ReadableStream<Uint8Array> {
    if (this.binaryStartOffset === -1) {
      throw new Error("Reader not initialized. Call initialize() first.");
    }

    let currentOffset = this.binaryStartOffset;
    const file = this.file;
    
    // Desktop format adds 28 bytes of overhead per chunk (12 IV + 16 Tag)
    const encryptedChunkSize = chunkSize + 28;

    return new ReadableStream({
      async pull(controller) {
        if (currentOffset >= file.size) {
          controller.close();
          return;
        }

        const sliceEnd = Math.min(currentOffset + encryptedChunkSize, file.size);
        const chunkBlob = file.slice(currentOffset, sliceEnd);
        const arrayBuffer = await chunkBlob.arrayBuffer();
        
        controller.enqueue(new Uint8Array(arrayBuffer));
        currentOffset = sliceEnd;
      }
    });
  }
}
