// ── TEMPORARY DIAGNOSTICS — REMOVE AFTER TEST C VERIFIED ──────────────────────
// SW VERSION FINGERPRINT: OPFS-v1 (navigator.storage.getDirectory in fetch handler)
// If you see this in DevTools → Sources, the NEW SW is active.
// If you see "streamMap" anywhere, the OLD SW is active.
// ───────────────────────────────────────────────────────────────────────────────

self.addEventListener('install', (event) => {
  console.log('[SW DIAG] install fired — OPFS-v1 Service Worker installing');
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('[SW DIAG] activate fired — OPFS-v1 Service Worker now controlling all clients');
  event.waitUntil(clients.claim());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Intercept OPFS Export Requests
  // Expected format: /__filelocker_download__/<opfs_filename>
  if (url.pathname.startsWith('/__filelocker_download__/')) {
    const filename = decodeURIComponent(url.pathname.split('/').pop());

    // DIAG: Log every intercepted request with its method
    console.log(`[SW DIAG] Intercepted request — Method: ${event.request.method} — File: ${filename}`);

    event.respondWith((async () => {
      try {
        // DIAG: Step 1 — Access OPFS
        console.log('[SW DIAG] Calling navigator.storage.getDirectory()...');
        const opfsRoot = await navigator.storage.getDirectory();
        console.log('[SW DIAG] OPFS root obtained successfully');

        // DIAG: Step 2 — Get file handle
        console.log(`[SW DIAG] Calling getFileHandle("${filename}")...`);
        const fileHandle = await opfsRoot.getFileHandle(filename);
        console.log('[SW DIAG] File handle obtained successfully');

        // DIAG: Step 3 — Get File object
        console.log('[SW DIAG] Calling fileHandle.getFile()...');
        const file = await fileHandle.getFile();
        console.log(`[SW DIAG] File obtained. size=${file.size} bytes (${(file.size/1e6).toFixed(1)} MB)`);

        const range = event.request.headers.get('Range');
        
        if (range) {
          console.log(`[SW DIAG] Range request detected: ${range}`);
          const parts = range.replace(/bytes=/, '').split('-');
          const start = parseInt(parts[0], 10);
          const end = parts[1] ? parseInt(parts[1], 10) : file.size - 1;
          const chunksize = (end - start) + 1;
          
          const slicedFile = file.slice(start, end + 1);
          
          const headers = new Headers({
            'Content-Range': `bytes ${start}-${end}/${file.size}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': chunksize.toString(),
            'Content-Type': 'application/octet-stream',
            'Content-Disposition': `attachment; filename="${filename}"`,
          });
          
          return new Response(slicedFile.stream(), {
            status: 206,
            headers: headers
          });
        } else {
          console.log('[SW DIAG] Normal request (No Range header)');
          const headers = new Headers({
            'Accept-Ranges': 'bytes',
            'Content-Type': 'application/octet-stream',
            'Content-Length': file.size.toString(),
            'Content-Disposition': `attachment; filename="${filename}"`,
          });
          
          return new Response(file.stream(), {
            status: 200,
            headers: headers
          });
        }

      } catch (err) {
        // DIAG: Catch and distinguish error types
        console.error(`[SW DIAG] OPFS access FAILED — ${err.name}: ${err.message}`);
        return new Response(`Error retrieving file from secure storage: ${err.message}`, { status: 404 });
      }
    })());

    return; // Stop processing this fetch event
  }
});
// ── END TEMPORARY DIAGNOSTICS ─────────────────────────────────────────────────
