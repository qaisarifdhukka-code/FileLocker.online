/**
 * A streaming TAR unpacker that reads decrypted chunks and perfectly
 * restores the original folder natively using the File System Access API.
 */

export class FolderUntar {
  private dirHandle: FileSystemDirectoryHandle;
  private buffer: Uint8Array = new Uint8Array(0);
  
  private state: 'READ_HEADER' | 'READ_DATA' | 'SKIP_PADDING' = 'READ_HEADER';
  private currentFileName: string = '';
  private currentFileSize: number = 0;
  private currentFileWritten: number = 0;
  private currentWritable: FileSystemWritableFileStream | null = null;
  private paddingToSkip: number = 0;
  
  private pendingWrites: Promise<void>[] = [];

  constructor(dirHandle: FileSystemDirectoryHandle) {
    this.dirHandle = dirHandle;
  }

  private appendBuffer(chunk: Uint8Array) {
    const newBuf = new Uint8Array(this.buffer.length + chunk.length);
    newBuf.set(this.buffer, 0);
    newBuf.set(chunk, this.buffer.length);
    this.buffer = newBuf;
  }
  
  private parseOctal(bytes: Uint8Array): number {
    let str = new TextDecoder().decode(bytes).replace(/\0/g, '').trim();
    return parseInt(str, 8) || 0;
  }

  private parseString(bytes: Uint8Array): string {
    const nullIdx = bytes.indexOf(0);
    const slice = nullIdx !== -1 ? bytes.slice(0, nullIdx) : bytes;
    return new TextDecoder().decode(slice);
  }

  public async push(chunk: Uint8Array, isFinal: boolean = false) {
    this.appendBuffer(chunk);

    while (true) {
      if (this.state === 'READ_HEADER') {
        if (this.buffer.length < 512) break; // Need more data for header
        
        const header = this.buffer.slice(0, 512);
        this.buffer = this.buffer.slice(512);

        // Check for End of Archive (empty block)
        if (header.every(b => b === 0)) {
          // It's the end!
          continue;
        }

        const name = this.parseString(header.slice(0, 100));
        const prefix = this.parseString(header.slice(345, 500));
        this.currentFileName = prefix ? `${prefix}/${name}` : name;
        this.currentFileSize = this.parseOctal(header.slice(124, 136));
        const typeFlag = String.fromCharCode(header[156] || 48); // '0' is 48

        this.currentFileWritten = 0;
        this.paddingToSkip = (512 - (this.currentFileSize % 512)) % 512;

        if (typeFlag === '0' || typeFlag === '\0') {
          // It's a file
          await this.initCurrentFile();
          this.state = this.currentFileSize > 0 ? 'READ_DATA' : 'SKIP_PADDING';
        } else if (typeFlag === '5') {
          // It's a directory
          await this.initCurrentDirectory();
          this.state = 'READ_HEADER';
        } else {
          // Ignore other types, just skip data
          this.state = this.currentFileSize > 0 ? 'READ_DATA' : 'SKIP_PADDING';
        }
      }

      if (this.state === 'READ_DATA') {
        const remainingFileBytes = this.currentFileSize - this.currentFileWritten;
        if (remainingFileBytes === 0) {
          this.state = 'SKIP_PADDING';
          continue;
        }

        if (this.buffer.length === 0) break; // Need more data

        const bytesToWrite = Math.min(this.buffer.length, remainingFileBytes);
        const dataChunk = this.buffer.slice(0, bytesToWrite);
        this.buffer = this.buffer.slice(bytesToWrite);

        if (this.currentWritable) {
          // We push to pending writes to allow parallel streaming but wait before accepting next encrypted chunk
          this.pendingWrites.push(this.currentWritable.write(dataChunk));
        }
        
        this.currentFileWritten += bytesToWrite;

        if (this.currentFileWritten >= this.currentFileSize) {
          if (this.currentWritable) {
            this.pendingWrites.push(this.currentWritable.close());
            this.currentWritable = null;
          }
          this.state = 'SKIP_PADDING';
        }
      }

      if (this.state === 'SKIP_PADDING') {
        if (this.paddingToSkip === 0) {
          this.state = 'READ_HEADER';
          continue;
        }

        if (this.buffer.length === 0) break; // Need more data

        const skipNow = Math.min(this.buffer.length, this.paddingToSkip);
        this.buffer = this.buffer.slice(skipNow);
        this.paddingToSkip -= skipNow;

        if (this.paddingToSkip === 0) {
          this.state = 'READ_HEADER';
        }
      }
    }

    // Wait for all disk writes from this chunk to finish before returning
    await Promise.all(this.pendingWrites);
    this.pendingWrites = [];
  }

  private async initCurrentDirectory() {
    const parts = this.currentFileName.split('/').filter(Boolean);
    let currentDir = this.dirHandle;
    for (const part of parts) {
      currentDir = await currentDir.getDirectoryHandle(part, { create: true });
    }
  }

  private async initCurrentFile() {
    const parts = this.currentFileName.split('/').filter(Boolean);
    const fileName = parts.pop();
    if (!fileName) return;

    let currentDir = this.dirHandle;
    for (const part of parts) {
      currentDir = await currentDir.getDirectoryHandle(part, { create: true });
    }

    const fileHandle = await currentDir.getFileHandle(fileName, { create: true });
    this.currentWritable = await fileHandle.createWritable();
  }
}
