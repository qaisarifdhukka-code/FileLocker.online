# File System Access API Stream Locking Analysis

## The Core Problem
The `InvalidModificationError` is a well-known architectural limitation of the Chromium File System Access API when used for long-running stream operations on Windows.

When you use `showSaveFilePicker()` and `createWritable()`, Chromium does the following:
1. Creates a 0-byte placeholder file (e.g., `file.vault`).
2. Creates a temporary `.crswap` file where it actually writes the data.
3. Upon `writable.close()`, Chromium replaces the 0-byte placeholder with the `.crswap` file.

**The Fatal Flaw:** Chromium strictly enforces that the 0-byte placeholder file must **not** be modified by anything else while the stream is open. However, if encryption takes a long time (e.g., a 3GB file takes minutes), Windows background services (Windows Defender, Search Indexer, OneDrive) will eventually notice this new 0-byte file and scan/index it. This scan updates the file's metadata (like "Last Accessed"), which Chromium detects as "tampering". When you finally call `close()`, Chromium panics and throws the error, leaving both files stranded.

*Note: The 10-second wait currently in your code doesn't fix this because the "tampering" (metadata update) by the OS already happened at some point during the long encryption process, not just at the end.*

## Proposed Solutions

Since this is a strict OS/Browser behavior clash, the solution requires changing the **delivery mechanism**, not the encryption logic. Here are the best ways to fix the UX without hacking around with `.crswap` files.

### Solution 1: Stage in OPFS (Recommended)
**Origin Private File System (OPFS)** is a private, sandboxed file system provided by the browser that is hidden from Windows Defender and indexers.

**Workflow:**
1. Start encryption, but stream the encrypted chunks directly into a temporary file in OPFS. Since OPFS is sandboxed, no OS antivirus will scan it mid-stream.
2. Once encryption reaches 100%, prompt the user with `showSaveFilePicker()`.
3. Pipe the completed OPFS file directly to the user's chosen file.
**Why it works:** The final copy from OPFS to the user's disk is extremely fast (just I/O, no encryption bottleneck). It finishes in seconds, well before Windows Defender has time to notice the 0-byte placeholder and scan it.

### Solution 2: Service Worker Streaming (The "StreamSaver" Approach)
Instead of using the File System Access API (`showSaveFilePicker()`), you use a Service Worker to emulate a standard server download. 

**Workflow:**
1. The app generates a fake download URL and triggers a regular browser download.
2. A Service Worker intercepts this request and responds with a `ReadableStream`.
3. The main thread pushes encrypted chunks into this stream as they are generated.
**Why it works:** This uses the browser's native download manager instead of the `.crswap` swap-and-check mechanism. The native download manager is designed to handle long-running streams and OS locks gracefully. (Libraries like `streamsaver.js` handle this boilerplate).

### Solution 3: The "UX Apology" (Not Recommended)
If you absolutely cannot change the saving architecture right now, the only way to avoid the crash is to warn the user:
Catch the `InvalidModificationError` during `writable.close()`, and show a UI modal explaining: *"Because this file is very large, Windows locked the file before we could finish saving it. The file was successfully encrypted, but you must manually go to your folder and remove the `.crswap` extension to use it."* 
*(As you noted, this is terrible patch-work UX, so I strongly suggest Solution 1).*
