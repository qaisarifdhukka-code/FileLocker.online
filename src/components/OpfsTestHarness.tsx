import React, { useState } from 'react';

export default function OpfsTestHarness() {
  const [status, setStatus] = useState<string>('Ready');
  const [progress, setProgress] = useState<number>(0);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [activeFileRef, setActiveFileRef] = useState<File | null>(null);
  
  const OPFS_FILE_NAME = 'synthetic_test.bin';
  const CHUNK_SIZE = 10 * 1024 * 1024; // 10 MB

  const runTest = async (targetSizeMB: number) => {
    try {
      setDownloadUrl(null);
      setProgress(0);
      const targetSizeBytes = targetSizeMB * 1024 * 1024;
      
      // 1. Quota Check
      setStatus('Checking storage quota...');
      if (!navigator.storage || !navigator.storage.estimate) {
        throw new Error("Storage estimation API not supported.");
      }
      const estimate = await navigator.storage.estimate();
      const requiredBytes = targetSizeBytes + (500 * 1024 * 1024); // 500 MB safety overhead
      
      if (estimate.quota !== undefined && estimate.usage !== undefined) {
        const available = estimate.quota - estimate.usage;
        if (available < requiredBytes) {
          throw new Error(`Insufficient storage. Required: ${(requiredBytes/1e9).toFixed(2)} GB, Available: ${(available/1e9).toFixed(2)} GB`);
        }
        console.log(`Quota check passed. Available: ${(available/1e9).toFixed(2)} GB`);
      }

      // 2. OPFS Write
      setStatus('Getting OPFS directory...');
      const opfsRoot = await navigator.storage.getDirectory();
      const fileHandle = await opfsRoot.getFileHandle(OPFS_FILE_NAME, { create: true });
      
      setStatus('Creating writable stream (main thread)...');
      const writable = await fileHandle.createWritable();
      
      const numChunks = Math.ceil(targetSizeBytes / CHUNK_SIZE);
      let expectedChecksum = 0;

      setStatus(`Writing ${targetSizeMB} MB synthetic chunks to OPFS...`);
      const chunk = new Uint8Array(CHUNK_SIZE);
      for (let i = 0; i < numChunks; i++) {
        // To avoid generating random data which is slow, we use a predictable pattern
        const byteVal = i % 256;
        chunk.fill(byteVal);
        
        // Calculate expected checksum (simple modulo sum for verification)
        expectedChecksum = (expectedChecksum + (byteVal * CHUNK_SIZE)) % 256;

        await writable.write(chunk);
        setProgress(((i + 1) / numChunks) * 100);
      }
      
      setStatus('Closing stream...');
      await writable.close();

      // 3. OPFS Read & Verify
      setStatus('Reading file back for verification...');
      setProgress(0);
      const file = await fileHandle.getFile();
      if (file.size !== numChunks * CHUNK_SIZE) { 
        throw new Error(`Size mismatch. Expected ${numChunks * CHUNK_SIZE}, got ${file.size}`);
      }

      let readChecksum = 0;
      let offset = 0;
      
      // Read sequentially
      while (offset < file.size) {
        const slice = file.slice(offset, offset + CHUNK_SIZE);
        const buffer = await slice.arrayBuffer();
        const view = new Uint8Array(buffer);
        
        for (let i = 0; i < view.length; i++) {
          readChecksum = (readChecksum + view[i]) % 256;
        }
        
        offset += CHUNK_SIZE;
        setProgress((offset / file.size) * 100);
      }

      if (readChecksum !== expectedChecksum) {
        throw new Error(`Checksum mismatch! Expected ${expectedChecksum}, got ${readChecksum}. OPFS corruption detected.`);
      }

      // 4. Export
      setStatus('Creating Object URL for export...');
      setActiveFileRef(file);
      const url = URL.createObjectURL(file);
      setDownloadUrl(url);
      
      setStatus('Success! Please click Export below, then use PowerShell Get-FileHash to verify the downloaded file against itself if you used a real file, or just test export size for synthetic.');
      
    } catch (err: any) {
      console.error(err);
      setStatus(`Error: ${err.message}`);
    }
  };

  const cleanup = async () => {
    try {
      const opfsRoot = await navigator.storage.getDirectory();
      await opfsRoot.removeEntry(OPFS_FILE_NAME);
      if (downloadUrl) URL.revokeObjectURL(downloadUrl);
      setDownloadUrl(null);
      setStatus('Cleanup complete.');
      setProgress(0);
    } catch (err: any) {
      setStatus(`Cleanup failed: ${err.message}`);
    }
  };

  return (
    <div style={{ marginTop: '2rem', padding: '1rem', border: '2px dashed #444' }}>
      <h2>Stage 1: OPFS Infrastructure PoC (Test A)</h2>
      <p>This isolates the browser/storage/download problem without any encryption logic.</p>
      
      <div style={{ marginBottom: '1rem' }}>
        <button onClick={() => runTest(500)} style={{ marginRight: '1rem' }}>Run 500 MB Test</button>
        <button onClick={() => runTest(1024)} style={{ marginRight: '1rem' }}>Run 1 GB Test</button>
        <button onClick={() => runTest(3400)} style={{ marginRight: '1rem' }}>Run 3.4 GB Test</button>
        <button onClick={cleanup}>Cleanup OPFS Storage</button>
      </div>

      <div style={{ marginBottom: '1rem' }}>
        <strong>Status:</strong> {status}<br/>
        <strong>Progress:</strong> {progress.toFixed(1)}%
      </div>

      {downloadUrl && (
        <div style={{ padding: '1rem', background: '#eef' }}>
          <h3>Export Ready</h3>
          <p>The file is fully staged in OPFS. Click below to trigger Chrome's Download Manager.</p>
          <a href={downloadUrl} download={OPFS_FILE_NAME} style={{ padding: '0.5rem 1rem', background: 'green', color: 'white', textDecoration: 'none', borderRadius: '4px' }}>
            Export file to Downloads
          </a>
        </div>
      )}
    </div>
  );
}
