/**
 * A pure TypeScript TAR stream generator.
 */

function stringToUint8Array(str: string, length: number): Uint8Array {
  const buf = new Uint8Array(length);
  const encoded = new TextEncoder().encode(str);
  buf.set(encoded.slice(0, length));
  return buf;
}

/**
 * Recursively gets all files from a directory handle.
 */
export async function getFilesRecursively(
  dirHandle: FileSystemDirectoryHandle,
  path = dirHandle.name + '/'
): Promise<{ file: File; path: string }[]> {
  const files: { file: File; path: string }[] = [];
  
  // @ts-ignore - TS doesn't have async iterators for FileSystemDirectoryHandle by default
  for await (const entry of dirHandle.values()) {
    if (entry.kind === 'file') {
      const file = await (entry as FileSystemFileHandle).getFile();
      files.push({ file, path: path + file.name });
    } else if (entry.kind === 'directory') {
      const subFiles = await getFilesRecursively(
        entry as FileSystemDirectoryHandle,
        path + entry.name + '/'
      );
      files.push(...subFiles);
    }
  }
  
  return files;
}

function padOctal(num: number, length: number): string {
  return num.toString(8).padStart(length - 1, '0') + '\0';
}

function createTarHeader(name: string, size: number, typeFlag: string): Uint8Array {
  const header = new Uint8Array(512);
  let prefix = '';
  let fileName = name;

  if (name.length > 100) {
    const splitIndex = name.lastIndexOf('/', 155);
    if (splitIndex !== -1) {
      prefix = name.substring(0, splitIndex);
      fileName = name.substring(splitIndex + 1);
    }
  }

  header.set(stringToUint8Array(fileName, 100), 0); // Name
  header.set(stringToUint8Array("0000644\0", 8), 100); // Mode
  header.set(stringToUint8Array("0000000\0", 8), 108); // UID
  header.set(stringToUint8Array("0000000\0", 8), 116); // GID
  header.set(stringToUint8Array(padOctal(size, 12), 12), 124); // Size
  header.set(stringToUint8Array(padOctal(Math.floor(Date.now() / 1000), 12), 12), 136); // MTime
  
  header.set(stringToUint8Array("        ", 8), 148); // Checksum placeholder
  header[156] = typeFlag.charCodeAt(0); // TypeFlag ('0' for file, '5' for dir)
  header.set(stringToUint8Array("", 100), 157); // LinkName
  header.set(stringToUint8Array("ustar\0", 6), 257); // Magic
  header.set(stringToUint8Array("00", 2), 263); // Version
  header.set(stringToUint8Array("", 32), 265); // Uname
  header.set(stringToUint8Array("", 32), 297); // Gname
  header.set(stringToUint8Array(prefix, 155), 345); // Prefix

  // Calculate checksum
  let checksum = 0;
  for (let i = 0; i < 512; i++) {
    checksum += header[i];
  }
  
  // Write checksum
  header.set(stringToUint8Array(padOctal(checksum, 7) + ' ', 8), 148);
  
  return header;
}

export function createTarStream(files: { file: File; path: string }[]): ReadableStream<Uint8Array> {
  let fileIndex = 0;
  let currentReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let currentFileSize = 0;
  let currentBytesRead = 0;
  let finished = false;

  return new ReadableStream({
    async pull(controller) {
      if (finished) return;

      if (!currentReader) {
        if (fileIndex >= files.length) {
          // Write End of Archive (two 512-byte null blocks)
          controller.enqueue(new Uint8Array(1024));
          finished = true;
          controller.close();
          return;
        }

        const currentFile = files[fileIndex];
        currentFileSize = currentFile.file.size;
        currentBytesRead = 0;

        // Yield header
        const header = createTarHeader(currentFile.path, currentFileSize, '0');
        controller.enqueue(header);
        
        currentReader = currentFile.file.stream().getReader();
        return; // Yield back to allow processing of the header
      }

      const { done, value } = await currentReader.read();

      if (done) {
        // Pad the file data to 512 bytes
        const paddingLength = (512 - (currentFileSize % 512)) % 512;
        if (paddingLength > 0) {
          controller.enqueue(new Uint8Array(paddingLength));
        }
        
        currentReader = null;
        fileIndex++;
      } else if (value) {
        currentBytesRead += value.length;
        controller.enqueue(value);
      }
    }
  });
}

export async function* bufferStream(
  stream: ReadableStream<Uint8Array>,
  chunkSize: number
): AsyncIterable<Uint8Array> {
  const reader = stream.getReader();
  let buffer = new Uint8Array(0);

  while (true) {
    const { done, value } = await reader.read();

    if (value) {
      const newBuffer = new Uint8Array(buffer.length + value.length);
      newBuffer.set(buffer, 0);
      newBuffer.set(value, buffer.length);
      buffer = newBuffer;

      while (buffer.length >= chunkSize) {
        yield buffer.slice(0, chunkSize);
        buffer = buffer.slice(chunkSize);
      }
    }

    if (done) {
      if (buffer.length > 0) {
        yield buffer;
      }
      break;
    }
  }
}
