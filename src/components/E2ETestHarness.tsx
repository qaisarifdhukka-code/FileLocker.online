import React, { useState } from 'react';
import { deriveKey } from '../tools/file-locker/crypto/argon2';
import { createPureVault } from '../tools/file-locker/vault/pure-vault-writer';

/**
 * E2E Test Harness — Production-ready flow using the proven vault format.
 * 
 * This encrypts a file into a pure binary .vault file (identical format to
 * the desktop provisioning-app). The resulting .vault file is unlocked by
 * the existing unlock-app.html viewer.
 * 
 * Flow:
 * 1. User selects a file and types a password.
 * 2. Argon2id derives the key.
 * 3. A .vault file is streamed directly to disk (0 RAM, any file size).
 * 4. User opens unlock-app.html and selects the .vault file to decrypt.
 */
export const E2ETestHarness: React.FC = () => {
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState('Ready');
  const [progress, setProgress] = useState(0);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  const startFlow = async () => {
    if (!file) { setError('Please select a file first.'); return; }
    if (!password) { setError('Please enter a password.'); return; }

    setError('');
    setDone(false);
    setProgress(0);

    try {
      setStatus('Generating random salt and nonce...');
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const globalNonce = crypto.getRandomValues(new Uint8Array(8));

      setStatus('Deriving key using Argon2id (takes ~2 seconds)...');
      const derivedKeyBytes = await deriveKey(password, salt);
      const cryptoKey = await crypto.subtle.importKey(
        'raw', derivedKeyBytes, { name: 'AES-GCM' }, false, ['encrypt']
      );

      // Salt stored as hex string so unlock-app can read it back
      const saltHex = Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join('');

      const metadata = {
        name: file.name,
        originalName: file.name,
        size: file.size,
        type: file.type,
        salt: saltHex,
      };

      setStatus(`Prompting save location for ${file.name}.vault...`);

      await createPureVault(
        file,
        cryptoKey,
        globalNonce,
        JSON.stringify(metadata),
        (percent) => {
          setProgress(percent);
          setStatus(percent < 100
            ? `Encrypting & writing to disk: ${percent}%`
            : 'Finalizing vault on disk...');
        }
      );

      setDone(true);
      setStatus(`Vault saved successfully!`);
    } catch (e: any) {
      if (e.name === 'AbortError') {
        setStatus('Cancelled.');
      } else {
        setError(e.message);
        setStatus('Error.');
        console.error(e);
      }
    }
  };

  return (
    <div style={{
      maxWidth: '560px', margin: '40px auto', fontFamily: 'system-ui, sans-serif',
      border: '1px solid #d1d5db', padding: '28px', borderRadius: '10px',
      boxShadow: '0 1px 4px rgba(0,0,0,0.08)', background: '#fff'
    }}>
      <h2 style={{ marginTop: 0, fontSize: '20px', fontWeight: 700, color: '#111827' }}>
        🔒 FileLocker — E2E Vault Test
      </h2>
      <p style={{ color: '#6b7280', fontSize: '14px', marginBottom: '20px' }}>
        Encrypts a file into a <code>.vault</code> binary using the same format as the desktop app.
        Unlock with <strong>unlock-app.html</strong>.
      </p>

      <div style={{ marginBottom: '16px' }}>
        <label style={{ display: 'block', fontWeight: 600, fontSize: '13px', marginBottom: '6px', color: '#374151' }}>
          1. Select file to lock
        </label>
        <input type="file" onChange={(e) => { setFile(e.target.files?.[0] || null); setDone(false); setError(''); }}
          style={{ width: '100%', fontSize: '13px' }} />
        {file && (
          <div style={{ marginTop: '6px', fontSize: '12px', color: '#6b7280' }}>
            Selected: <strong>{file.name}</strong> ({(file.size / 1024 / 1024).toFixed(2)} MB)
          </div>
        )}
      </div>

      <div style={{ marginBottom: '20px' }}>
        <label style={{ display: 'block', fontWeight: 600, fontSize: '13px', marginBottom: '6px', color: '#374151' }}>
          2. Set a password
        </label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && startFlow()}
          placeholder="Enter a strong password"
          style={{
            width: '100%', padding: '8px 12px', fontSize: '14px',
            border: '1px solid #d1d5db', borderRadius: '6px', boxSizing: 'border-box'
          }}
        />
      </div>

      <button
        onClick={startFlow}
        disabled={!file || !password}
        style={{
          width: '100%', padding: '10px', fontSize: '15px', fontWeight: 700,
          background: !file || !password ? '#9ca3af' : '#2563EB',
          color: '#fff', border: 'none', borderRadius: '6px', cursor: !file || !password ? 'not-allowed' : 'pointer'
        }}
      >
        3. Encrypt & Save .vault File
      </button>

      {(status !== 'Ready' && status !== 'Cancelled.') && (
        <div style={{ marginTop: '16px' }}>
          <div style={{ fontSize: '13px', color: '#374151', marginBottom: '6px' }}>{status}</div>
          {progress > 0 && progress < 100 && (
            <div style={{ background: '#e5e7eb', borderRadius: '4px', height: '6px', overflow: 'hidden' }}>
              <div style={{ width: `${progress}%`, height: '100%', background: '#2563EB', transition: 'width 0.2s' }} />
            </div>
          )}
        </div>
      )}

      {error && (
        <div style={{ marginTop: '14px', padding: '10px 14px', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: '6px', color: '#b91c1c', fontSize: '13px' }}>
          ❌ {error}
        </div>
      )}

      {done && (
        <div style={{ marginTop: '14px', padding: '14px', background: '#f0fdf4', border: '1px solid #86efac', borderRadius: '8px' }}>
          <div style={{ fontWeight: 700, color: '#166534', fontSize: '14px', marginBottom: '8px' }}>
            ✅ Vault created successfully!
          </div>
          <div style={{ fontSize: '13px', color: '#374151', lineHeight: '1.6' }}>
            <strong>To unlock the file:</strong>
            <ol style={{ marginTop: '6px', paddingLeft: '20px' }}>
              <li>Open <a href="/unlock-app.html" target="_blank" style={{ color: '#2563EB' }}>unlock-app.html</a></li>
              <li>Click <strong>"Select Vault File"</strong></li>
              <li>Select the <code>.vault</code> file you just saved</li>
              <li>Enter your password and click <strong>"Unlock & Download"</strong></li>
            </ol>
          </div>
        </div>
      )}
    </div>
  );
};
