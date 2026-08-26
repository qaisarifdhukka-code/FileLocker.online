import { useState } from 'react';
import { argon2id } from 'hash-wasm';
import { LockOpen, File as FileIcon, Loader2, CheckCircle2, AlertCircle, Eye, EyeOff, RotateCcw, ShieldAlert, XCircle } from 'lucide-react';
import { BlobReader } from '../tools/file-locker/vault/SequentialReader';
import { FolderUntar } from '../tools/file-locker/vault/FolderUntar';

const MAGIC_EXPECTED = [0x56, 0x4C, 0x4B, 0x54]; // "VLKT"
const HEADER_BASE = 5;
const META_LEN_SIZE = 4;
const NONCE_SIZE = 8;
const CHUNK_PLAIN = 10 * 1024 * 1024;
const CHUNK_ENC = CHUNK_PLAIN + 12 + 16;

function hexToBytes(hex: string) {
  const b = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) b[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  return b;
}

export default function UnlockApp() {
  const [file, setFile] = useState<File | null>(null);
  const [meta, setMeta] = useState<any>(null);
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState('IDLE'); // IDLE, DECRYPTING, DONE, ERROR
  const [isDeriving, setIsDeriving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [progress, setProgress] = useState(0);

  const selectVault = async () => {
    try {
      // @ts-ignore
      const [fh] = await window.showOpenFilePicker({
        types: [{ description: 'Vault Files', accept: { '*/*': ['.vault'] } }]
      });
      const selected = await fh.getFile();

      const fixedBuf = await selected.slice(0, HEADER_BASE + META_LEN_SIZE).arrayBuffer();
      const fixedArr = new Uint8Array(fixedBuf);

      for (let i = 0; i < 4; i++) {
        if (fixedArr[i] !== MAGIC_EXPECTED[i]) throw new Error('Not a valid FileLocker file.');
      }

      const metaLen = new DataView(fixedBuf).getUint32(HEADER_BASE, true);
      const metaStart = HEADER_BASE + META_LEN_SIZE;
      const metaBuf = await selected.slice(metaStart, metaStart + metaLen).arrayBuffer();
      const parsedMeta = JSON.parse(new TextDecoder().decode(metaBuf));

      const dataStart = metaStart + metaLen + NONCE_SIZE;

      setFile(selected);
      setMeta({ ...parsedMeta, dataStart });
      setErrorMsg('');
    } catch (err: any) {
      if (err.name !== 'AbortError') setErrorMsg(err.message);
    }
  };

  const decryptVault = async () => {
    if (!password) { setErrorMsg('Please enter a password.'); return; }
    if (isDeriving || !file) return;

    try {
      setIsDeriving(true);
      setErrorMsg('');
      setStatus('DECRYPTING');

      const reader = new BlobReader(file);

      const fixedBuf = await reader.readBytes(HEADER_BASE + META_LEN_SIZE);
      if (!fixedBuf || fixedBuf.length < HEADER_BASE + META_LEN_SIZE) throw new Error('Invalid vault header');

      for (let i = 0; i < 4; i++) {
        if (fixedBuf[i] !== MAGIC_EXPECTED[i]) throw new Error('Not a valid FileLocker file.');
      }
      const metaLen = new DataView(fixedBuf.buffer, fixedBuf.byteOffset, fixedBuf.byteLength).getUint32(HEADER_BASE, true);

      const metaBuf = await reader.readBytes(metaLen);
      if (!metaBuf) throw new Error('Invalid metadata');
      const parsedMeta = JSON.parse(new TextDecoder().decode(metaBuf));

      await reader.readBytes(NONCE_SIZE);

      const salt = hexToBytes(parsedMeta.salt);
      const keyArray = await argon2id({
        password: password,
        salt: salt,
        parallelism: 1,
        iterations: 3,
        memorySize: 65536,
        hashLength: 32,
        outputType: 'binary'
      });

      const key = await crypto.subtle.importKey('raw', new Uint8Array(keyArray), { name: 'AES-GCM' }, false, ['decrypt']);

      let downloadName = parsedMeta.originalName;
      if (parsedMeta.encryptedName) {
        let decName;
        try {
          const encNameBuf = hexToBytes(parsedMeta.encryptedName);
          const nameIv = encNameBuf.slice(0, 12);

          try {
            const nameTag = encNameBuf.slice(12, 28);
            const nameData = encNameBuf.slice(28);
            const combinedName = new Uint8Array(nameData.length + nameTag.length);
            combinedName.set(nameData, 0);
            combinedName.set(nameTag, nameData.length);
            decName = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nameIv }, key, combinedName);
          } catch (e) {
            const tag = encNameBuf.slice(encNameBuf.length - 16);
            const data = encNameBuf.slice(12, encNameBuf.length - 16);
            const combinedName = new Uint8Array(data.length + tag.length);
            combinedName.set(data, 0);
            combinedName.set(tag, data.length);
            decName = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nameIv }, key, combinedName);
          }

          downloadName = new TextDecoder().decode(decName);
        } catch (e) {
          throw new Error('Invalid password or corrupted vault file.');
        }
      }

      const firstChunkBuf = await reader.readBytes(CHUNK_ENC);
      let firstChunkDec;
      if (firstChunkBuf && firstChunkBuf.length >= 28) {
        const iv = firstChunkBuf.slice(0, 12);
        const tag = firstChunkBuf.slice(12, 28);
        const data = firstChunkBuf.slice(28);
        const combined = new Uint8Array(data.length + tag.length);
        combined.set(data, 0);
        combined.set(tag, data.length);

        try {
          const decBuffer = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, combined);
          firstChunkDec = new Uint8Array(decBuffer);
        } catch (e) {
          throw new Error('Invalid password. Please try again.');
        }
      } else {
        throw new Error('Vault is empty or corrupted');
      }

      let writable;
      let untar: FolderUntar | null = null;
      try {
        if (parsedMeta.isFolder && downloadName.endsWith('.tar')) {
          // @ts-ignore
          const dirHandle = await window.showDirectoryPicker();
          untar = new FolderUntar(dirHandle);
        } else {
          // @ts-ignore
          const saveFh = await window.showSaveFilePicker({ suggestedName: downloadName });
          // @ts-ignore
          writable = await saveFh.createWritable();
        }
      } catch (e) {
        reset();
        return;
      }

      if (untar) {
        await untar.push(firstChunkDec, false);
      } else {
        await writable.write(firstChunkDec);
      }

      let bytesProcessed = firstChunkBuf.length;
      const totalDataSize = parsedMeta.fileSize || file.size - (HEADER_BASE + META_LEN_SIZE + metaLen + NONCE_SIZE);

      let chunkCounter = 1;
      while (true) {
        const chunkBuf = await reader.readBytes(CHUNK_ENC);
        if (!chunkBuf || chunkBuf.length === 0) break;
        if (chunkBuf.length < 28) break;

        const iv = chunkBuf.slice(0, 12);
        const tag = chunkBuf.slice(12, 28);
        const data = chunkBuf.slice(28);
        const combined = new Uint8Array(data.length + tag.length);
        combined.set(data, 0);
        combined.set(tag, data.length);

        const dec = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, combined);

        if (untar) {
          await untar.push(new Uint8Array(dec), false);
        } else {
          await writable.write(dec);
        }

        bytesProcessed += chunkBuf.length;
        if (totalDataSize > 0) {
          setProgress(Math.min(100, Math.round((bytesProcessed / totalDataSize) * 100)));
        }

        chunkCounter++;
        if (chunkCounter % 5 === 0) {
          await new Promise(resolve => setTimeout(resolve, 0));
        }
      }

      if (untar) {
        await untar.push(new Uint8Array(0), true);
      } else {
        await writable.close();
      }
      
      setPassword('');
      setIsDeriving(false);
      setStatus('DONE');

    } catch (err: any) {
      console.error(err);
      setIsDeriving(false);
      setStatus('ERROR');
      const msg = err.message || '';
      setErrorMsg(
        err.name === 'OperationError' || msg.includes('auth') || msg.includes('operation') || msg.includes('Invalid password')
          ? 'Invalid password. Please try again.'
          : (msg || 'Decryption failed.')
      );
    }
  };

  const reset = () => {
    setPassword('');
    setStatus('IDLE');
    setProgress(0);
    setErrorMsg('');
    setFile(null);
    setMeta(null);
  };

  return (
    <div className="w-full max-w-2xl mx-auto py-12 px-4 sm:px-6">
      
      <div className="text-center mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-3">Unlock a File</h1>
        <p className="text-gray-500">Restore a FileLocker protected file using its password.</p>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        
        {/* STEP 1: SELECT FILE & ENTER PASSWORD */}
        {status === 'IDLE' && (
          <div className="p-8 md:p-16 text-center">
            {!file ? (
              <div className="border-2 border-dashed border-[#d3e3fd] rounded-3xl p-12 max-w-2xl mx-auto flex flex-col items-center justify-center transition-all duration-300 hover:bg-[#f4f8fc] group bg-white">
                <div className="relative w-16 h-16 mb-5">
                  <div className="absolute inset-0 bg-brand-blue opacity-10 rounded-2xl group-hover:scale-110 group-hover:opacity-20 transition-all duration-300"></div>
                  <div className="absolute inset-0 flex items-center justify-center group-hover:-translate-y-1 transition-transform duration-300">
                    <LockOpen className="w-8 h-8 text-brand-blue" />
                  </div>
                </div>
                
                <h3 className="text-gray-700 font-semibold text-lg mb-2">
                  Drop your protected file here, or{' '}
                  <button onClick={selectVault} className="text-brand-blue font-bold hover:underline focus:outline-none">browse</button>
                </h3>
                <p className="text-gray-400 text-sm font-medium">Supports: .vault files</p>

                {errorMsg && (
                  <p className="mt-4 text-sm text-red-600 font-medium">{errorMsg}</p>
                )}
              </div>
            ) : (
              <div>
                <button onClick={reset} className="text-sm text-brand-blue hover:underline mb-6 flex items-center gap-1 font-medium">
                  <RotateCcw className="w-4 h-4" /> Change selection
                </button>

                <div className="bg-gray-50 rounded-lg p-4 border border-gray-200 flex items-center gap-4 mb-8">
                  <FileIcon className="w-8 h-8 text-gray-400" />
                  <div className="flex-1 min-w-0">
                    <h3 className="font-bold text-gray-900 truncate">{file.name}</h3>
                    {meta?.originalName && <p className="text-sm text-gray-500 truncate">Contains: {meta.originalName}</p>}
                  </div>
                </div>

                <div className="mb-8">
                  <label className="block text-sm font-bold text-gray-900 mb-2">Password</label>
                  <div className="relative">
                    <input 
                      type={showPassword ? 'text' : 'password'} 
                      value={password} 
                      onChange={(e) => setPassword(e.target.value)} 
                      onKeyDown={(e) => e.key === 'Enter' && decryptVault()}
                      placeholder="Enter the password" 
                      className="w-full px-4 py-3 bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-blue/20 focus:border-brand-blue transition-all text-gray-900"
                    />
                    <button onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-3 text-gray-400 hover:text-gray-700">
                      {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                    </button>
                  </div>
                  {meta?.hint && (
                    <p className="mt-2 text-sm text-brand-blue">Hint: {meta.hint}</p>
                  )}
                </div>

                {errorMsg && (
                  <div className="mb-6 p-4 bg-red-50 text-red-700 rounded-lg flex items-start gap-3 border border-red-100">
                    <AlertCircle className="w-5 h-5 shrink-0" />
                    <p className="text-sm font-medium">{errorMsg}</p>
                  </div>
                )}

                <button onClick={decryptVault} disabled={!password || isDeriving} className="w-full bg-brand-blue hover:bg-brand-blue-dark text-white font-bold py-4 px-6 rounded-lg transition-colors flex items-center justify-center gap-2 text-lg disabled:opacity-50 disabled:cursor-not-allowed">
                  {isDeriving ? <><Loader2 className="w-5 h-5 animate-spin" /> Unlocking...</> : <><LockOpen className="w-5 h-5" /> Unlock & Save</>}
                </button>
                <p className="text-center text-xs text-gray-400 mt-4">Your browser will ask you where to save the unlocked file.</p>
              </div>
            )}
          </div>
        )}

        {/* STEP 2: PROCESSING */}
        {status === 'DECRYPTING' && (
          <div className="p-8 md:p-12 text-center">
            <div className="w-16 h-16 mx-auto mb-6 relative">
              <Loader2 className="w-16 h-16 text-brand-blue animate-spin" />
              <div className="absolute inset-0 flex items-center justify-center">
                <LockOpen className="w-6 h-6 text-brand-blue" />
              </div>
            </div>
            
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Unlocking file</h2>
            <p className="text-gray-500 font-medium truncate max-w-sm mx-auto mb-8">{file?.name}</p>

            <div className="max-w-sm mx-auto mb-8">
              <div className="flex justify-between text-sm font-bold text-gray-700 mb-2">
                <span>Decrypting</span>
                <span className="text-brand-blue">{progress}%</span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
                <div className="bg-brand-blue h-full rounded-full transition-all duration-300" style={{ width: `${progress}%` }}></div>
              </div>
            </div>

            <p className="text-sm text-gray-500 max-w-sm mx-auto">
              Please don't close this tab until the process is complete.
            </p>
          </div>
        )}

        {/* STEP 3: DONE */}
        {status === 'DONE' && (
          <div className="p-8 md:p-12 text-center">
            <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
              <CheckCircle2 className="w-10 h-10 text-green-600" />
            </div>
            
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Unlock Complete</h2>
            <p className="text-gray-500 mb-8 max-w-sm mx-auto">Your file has been successfully decrypted and saved to your device.</p>

            <div className="flex flex-col sm:flex-row justify-center gap-4">
              <button onClick={reset} className="bg-white border border-gray-300 hover:bg-gray-50 text-gray-900 font-bold py-3 px-6 rounded-lg transition-colors">
                Unlock Another File
              </button>
            </div>
          </div>
        )}

        {/* ERROR */}
        {status === 'ERROR' && (
          <div className="p-8 md:p-12 text-center">
            <div className="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-6">
              <XCircle className="w-10 h-10 text-red-600" />
            </div>
            
            <h2 className="text-2xl font-bold text-gray-900 mb-2">System Error</h2>
            <p className="text-gray-500 mb-8 max-w-sm mx-auto">{errorMsg}</p>

            <button onClick={() => { setStatus('IDLE'); setIsDeriving(false); }} className="bg-white border border-gray-300 hover:bg-gray-50 text-gray-900 font-bold py-3 px-6 rounded-lg transition-colors">
              Try Again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
