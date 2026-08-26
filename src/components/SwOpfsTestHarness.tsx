import React, { useState, useEffect } from 'react';

export default function SwOpfsTestHarness() {
  const [status, setStatus] = useState<string>('Ready');
  const [progress, setProgress] = useState<number>(0);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  
  const OPFS_FILE_NAME = 'test_vault.bin';
  const CHUNK_SIZE = 10 * 1024 * 1024; // 10 MB

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      // Nuclear option for local testing: Unregister all ghosts, then register the real one
      navigator.serviceWorker.getRegistrations().then((registrations) => {
        for (let reg of registrations) {
          reg.unregister();
        }
        navigator.serviceWorker.register('/sw.js').then((reg) => {
          console.log('Service Worker registered successfully with scope:', reg.scope);
        });
      });
    }
  }, []);

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
      }

      // 2. Lazy Cleanup of old file
      setStatus('Cleaning up old staging files...');
      try {
        const opfsRoot = await navigator.storage.getDirectory();
        await opfsRoot.removeEntry(OPFS_FILE_NAME);
      } catch (e) {
        // Ignore if it doesn't exist
      }

      // 3. OPFS Write
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
        // Predictable pattern for verification
        const byteVal = i % 256;
        chunk.fill(byteVal);
        
        expectedChecksum = (expectedChecksum + (byteVal * CHUNK_SIZE)) % 256;

        await writable.write(chunk);
        setProgress(((i + 1) / numChunks) * 100);
      }
      
      setStatus('Closing stream...');
      await writable.close();

      // 4. Export Setup
      setStatus('Registering with Service Worker...');
      
      // We don't need to postMessage the File object. The SW reads it directly from OPFS.
      // We just create a standard anchor link to the SW intercepted URL.
      setDownloadUrl(`/__filelocker_download__/${encodeURIComponent(OPFS_FILE_NAME)}`);
      
      setStatus('Success! Please click Export below. It should download seamlessly without .crswap.');
      
    } catch (err: any) {
      console.error(err);
      setStatus(`Error: ${err.message}`);
    }
  };

  // TEMPORARY DIAGNOSTIC: Fetch the actual file via SW to see why it fails
  const testSwPing = async () => {
    try {
      setStatus(`Fetching /__filelocker_download__/${OPFS_FILE_NAME}...`);
      const response = await fetch(`/__filelocker_download__/${encodeURIComponent(OPFS_FILE_NAME)}`);
      
      if (response.ok) {
        setStatus(`SW Fetch SUCCESS! Status: ${response.status}. Content-Length: ${response.headers.get('Content-Length')}. The SW CAN read the file!`);
      } else {
        const text = await response.text();
        setStatus(`SW Fetch FAILED (${response.status}): ${text.substring(0, 150)}`);
      }
    } catch(e: any) {
      setStatus(`SW Fetch Exception: ${e.message}`);
    }
  };

  const manualCleanup = async () => {
    try {
      const opfsRoot = await navigator.storage.getDirectory();
      await opfsRoot.removeEntry(OPFS_FILE_NAME);
      setStatus('Cleanup complete. Storage freed.');
      setDownloadUrl(null);
    } catch (err: any) {
      setStatus(`Cleanup failed: ${err.message}`);
    }
  };

  // FILE SYSTEM ACCESS API EXPORT
  const exportViaFSA = async () => {
    try {
      setStatus('Prompting for save location...');
      // @ts-ignore - showSaveFilePicker is not in standard TS DOM yet
      const destHandle = await window.showSaveFilePicker({
        suggestedName: OPFS_FILE_NAME,
      });
      
      setStatus('Opening OPFS file...');
      const opfsRoot = await navigator.storage.getDirectory();
      const sourceHandle = await opfsRoot.getFileHandle(OPFS_FILE_NAME);
      const sourceFile = await sourceHandle.getFile();
      
      setStatus('Streaming data directly to disk... Please wait.');
      const writable = await destHandle.createWritable();
      const reader = sourceFile.stream().getReader();
      let bytesWritten = 0;
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        await writable.write(value);
        bytesWritten += value.byteLength;
        setProgress((bytesWritten / sourceFile.size) * 100);
      }
      
      setStatus('Finalizing file on disk (closing handle)...');
      await writable.close();
      
      setStatus('Export complete! File streamed securely to disk with 0 RAM overhead.');
    } catch(e: any) {
      if (e.name === 'AbortError') {
        setStatus('Export cancelled by user.');
      } else {
        setStatus(`Export failed: ${e.message}`);
      }
    }
  };

  return (
    <div style={{ border: '1px dashed #333', padding: '1rem', marginBottom: '2rem' }}>
      <h2>Stage 4: Service Worker OPFS Export (Test C)</h2>
      <p>This isolates the Service Worker OPFS read and native Download Manager flow.</p>

      <div style={{ marginBottom: '1rem' }}>
        <button onClick={() => runTest(500)} style={{ marginRight: '1rem' }}>Run 500 MB Test</button>
        <button onClick={() => runTest(1024)} style={{ marginRight: '1rem' }}>Run 1 GB Test</button>
        <button onClick={() => runTest(3400)} style={{ marginRight: '1rem' }}>Run 3.4 GB Test</button>
        <button onClick={manualCleanup} style={{ marginRight: '1rem' }}>Manual Cleanup</button>
        <button onClick={testSwPing} style={{ background: '#c00', color: 'white', padding: '0.3rem 0.8rem', marginRight: '1rem' }}>Fetch File (Diagnostic)</button>
        <button onClick={exportViaFSA} style={{ background: '#080', color: 'white', padding: '0.3rem 0.8rem' }}>Export via FSA</button>
      </div>

      <div style={{ marginBottom: '1rem' }}>
        <strong>Status:</strong> {status}<br/>
        <strong>Progress:</strong> {progress.toFixed(1)}%
      </div>

      {downloadUrl && (
        <div style={{ padding: '1rem', background: '#eef' }}>
          <h3>Export Ready</h3>
          <p>The file is finalized in OPFS. Click below to trigger the Service Worker interceptor.</p>
          <a href={downloadUrl} download={OPFS_FILE_NAME} style={{ padding: '0.5rem 1rem', background: 'green', color: 'white', textDecoration: 'none', borderRadius: '4px', display: 'inline-block' }}>
            Export file to Downloads
          </a>
        </div>
      )}
    </div>
  );
}
