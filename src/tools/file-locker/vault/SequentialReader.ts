export class BlobReader {
  blob: Blob;
  offset: number;
  size: number;

  constructor(blob: Blob) {
    this.blob = blob;
    this.offset = 0;
    this.size = blob.size;
  }

  async readBytes(length: number): Promise<Uint8Array | null> {
    if (this.offset >= this.size) return null;
    const end = Math.min(this.offset + length, this.size);
    const chunk = this.blob.slice(this.offset, end);
    const buf = await chunk.arrayBuffer();
    this.offset = end;
    return new Uint8Array(buf);
  }

  async cancel() {
    // No-op for BlobReader
  }
}

export class StreamReader {
  reader: ReadableStreamDefaultReader<Uint8Array>;
  buffer: Uint8Array;
  done: boolean;

  constructor(readableStream: ReadableStream<Uint8Array>) {
    this.reader = readableStream.getReader();
    this.buffer = new Uint8Array(0);
    this.done = false;
  }

  async readBytes(length: number): Promise<Uint8Array | null> {
    // Fill buffer until we have enough or stream is done
    while (this.buffer.length < length && !this.done) {
      const { value, done } = await this.reader.read();
      if (done) {
        this.done = true;
        break;
      }
      if (value) {
        const newBuffer = new Uint8Array(this.buffer.length + value.length);
        newBuffer.set(this.buffer, 0);
        newBuffer.set(value, this.buffer.length);
        this.buffer = newBuffer;
      }
    }

    if (this.buffer.length === 0) return null;

    // Return exactly length bytes, or whatever is left
    const toReturn = this.buffer.slice(0, length);
    this.buffer = this.buffer.slice(length);
    return toReturn;
  }

  async cancel() {
    try {
      await this.reader.cancel();
    } catch (e) {
      // Ignore
    }
  }
}
