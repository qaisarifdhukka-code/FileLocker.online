/**
 * Streaming HTML Writer Prototype
 * 
 * This module solves the RAM limitation for massive files. 
 * It streams encrypted chunks directly to the user's disk using the File System Access API.
 * 
 * Crucially, to prevent the recipient's browser from crashing by parsing gigabytes of Base64 strings in the DOM, 
 * this writer appends RAW BINARY data to the end of the HTML file. 
 * 
 * Because it's raw binary appended to HTML, the recipient's browser ignores it when rendering.
 * To unlock, the recipient's UI must ask them to "Drag this .locked.html file here" to read the binary payload natively.
 */

export class StreamingHtmlWriter {
  private writer: WritableStreamDefaultWriter<Uint8Array>;
  private headerWritten: boolean = false;

  constructor(writer: WritableStreamDefaultWriter<Uint8Array>) {
    this.writer = writer;
  }

  /**
   * Initializes the stream and writes the HTML Unlocker template.
   */
  async initialize(htmlTemplate: string, metadataJson: string) {
    // We inject the metadata into the HTML so the unlocker knows the salt, file name, and chunk sizes
    const templateWithMeta = htmlTemplate.replace(
      '<!-- METADATA_INJECTION -->',
      `<script id="vault-meta" type="application/json">${metadataJson}</script>`
    );

    // Write the complete HTML (it acts as the header of our hybrid file)
    await this.writer.write(new TextEncoder().encode(templateWithMeta));

    // Write a unique boundary marker so the reader knows exactly where the raw binary starts
    const boundary = new TextEncoder().encode('\n\n---FILELOCKER_BINARY_START---\n\n');
    await this.writer.write(boundary);

    this.headerWritten = true;
  }

  /**
   * Appends a raw encrypted binary chunk to the file on disk.
   */
  async appendChunk(encryptedChunk: Uint8Array) {
    if (!this.headerWritten) {
      throw new Error("Writer not initialized. Call initialize() first.");
    }
    // Stream directly to disk, avoiding RAM bloat
    await this.writer.write(encryptedChunk);
  }

  /**
   * Writes the Vault Header block (magic, version, metadata len).
   */
  async writeHeader(headerBuf: Uint8Array) {
    await this.writer.write(headerBuf);
  }

  /**
   * Writes a data chunk.
   */
  async writeChunk(chunkBuf: Uint8Array) {
    await this.writer.write(chunkBuf);
  }

  /**
   * Closes the file stream.
   */
  async close() {
    if (this.writer) {
      await this.writer.close();
    }
  }
}

export async function createDownloadStream(filename: string, totalSize?: number): Promise<WritableStreamDefaultWriter<Uint8Array>> {
  if (!('serviceWorker' in navigator)) {
    throw new Error('Service Workers are not supported in this browser.');
  }
  
  await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;

  const { readable, writable } = new TransformStream();
  
  // Create a unique URL for this stream. We omit the filename from the URL to prevent encoding normalization bugs; 
  // the filename is still safely enforced by the Content-Disposition header.
  const path = `/__filelocker_download__/${Math.random().toString(36).slice(2)}`;
  const url = new URL(path, window.location.origin).href;

  const headers = new Headers({
    'Content-Type': 'application/octet-stream',
    'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
  });
  // Do NOT set Content-Length! The final file is larger than totalSize because of the HTML header and GCM tags.
  // Setting a smaller Content-Length causes the browser download manager to prematurely truncate or reject the stream.

  const registration = await navigator.serviceWorker.ready;
  const sw = registration.active;
  if (!sw) {
    throw new Error("Critical: Service worker is not active.");
  }

  await new Promise<void>((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = (e) => resolve();
    
    sw.postMessage({
      type: 'START_DOWNLOAD',
      url: path,
      stream: readable,
      headers: Object.fromEntries(headers.entries())
    }, [readable, channel.port2]);
  });

  // Trigger download via anchor link.
  // Now that the user gesture is preserved, this will not be blocked.
  // We avoid iframes here because Chrome's iframe-to-download conversion makes TWO requests,
  // which destroys the single-use ReadableStream on the first cancelled request!
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  
  setTimeout(() => a.remove(), 1000);

  return writable.getWriter();
}
