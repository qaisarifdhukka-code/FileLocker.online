import { useState } from 'react';
import { Lock, File as FileIcon, Folder, CheckCircle2, Loader2, AlertCircle, Eye, EyeOff, RotateCcw } from 'lucide-react';
import { argon2id } from 'hash-wasm';
import { createPureVault, type VaultSource } from '../tools/file-locker/vault/pure-vault-writer';
import { createTarStream, getFilesRecursively, bufferStream } from '../tools/file-locker/vault/FolderTar';

function formatBytes(bytes: number) {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

const STEPS = { SELECT: 0, CONFIGURE: 1, PROCESSING: 2, DONE: 3 };

type AppSource = {
  name: string;
  size: number;
  isFolder: boolean;
  file?: File;
  dirHandle?: any;
};

type ProvisioningMode = 'file' | 'folder' | 'both';

type ProvisioningAppProps = {
  initialMode?: ProvisioningMode;
  hideHeader?: boolean;
};

export default function ProvisioningApp({ initialMode = 'both', hideHeader = false }: ProvisioningAppProps) {
  const [step, setStep] = useState(STEPS.SELECT);
  const [selectedSource, setSelectedSource] = useState<AppSource | null>(null);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState('');
  const [error, setError] = useState('');

  const handleSelectFile = async () => {
    try {
      // @ts-ignore
      const [handle] = await window.showOpenFilePicker({
        types: [{ description: 'All Files', accept: { '*/*': [] } }]
      });
      const file = await handle.getFile();
      setSelectedSource({ file, name: file.name, size: file.size, isFolder: false });
      setStep(STEPS.CONFIGURE);
    } catch (e: any) {
      if (e.name !== 'AbortError') setError(e.message);
    }
  };

  const handleSelectFolder = async () => {
    try {
      // @ts-ignore
      const dirHandle = await window.showDirectoryPicker();
      let totalSize = 0;
      const files = await getFilesRecursively(dirHandle);
      for (const f of files) {
        totalSize += f.file.size;
      }
      setSelectedSource({ dirHandle, name: dirHandle.name, size: totalSize, isFolder: true });
      setStep(STEPS.CONFIGURE);
    } catch (e: any) {
      if (e.name !== 'AbortError') setError(e.message);
    }
  };

  const handleProvision = async () => {
    if (!selectedSource) return;
    if (password.length < 4) {
      setPasswordError('Password must be at least 4 characters.');
      return;
    }
    setPasswordError('');
    setError('');
    setProgress(0);
    setProgressLabel('Preparing file...');
    setStep(STEPS.PROCESSING);
    
    try {
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const globalNonce = crypto.getRandomValues(new Uint8Array(8));
      
      const keyArray = await argon2id({
        password: password,
        salt: salt,
        parallelism: 1,
        iterations: 3,
        memorySize: 65536,
        hashLength: 32,
        outputType: 'binary'
      });
      const key = await crypto.subtle.importKey('raw', new Uint8Array(keyArray), { name: 'AES-GCM' }, false, ['encrypt']);
      
      const metadata = {
        originalName: selectedSource.isFolder ? selectedSource.name + ".tar" : selectedSource.name,
        encryptedName: null,
        fileSize: selectedSource.size,
        isFolder: selectedSource.isFolder,
        salt: Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join(''),
        hint: null,
        branding: { firmName: "FileLocker Online", primaryColor: "#2563EB" }
      };

      setProgressLabel('Protecting your file...');
      
      const vaultSource: VaultSource = {
        name: selectedSource.name,
        size: selectedSource.size,
        isFolder: selectedSource.isFolder,
        getStream: async function* () {
          if (selectedSource.isFolder && selectedSource.dirHandle) {
            const files = await getFilesRecursively(selectedSource.dirHandle);
            const tarStream = createTarStream(files);
            yield* bufferStream(tarStream, 10 * 1024 * 1024);
          } else if (selectedSource.file) {
            let offset = 0;
            const file = selectedSource.file;
            while (offset < file.size) {
              const slice = file.slice(offset, offset + 10 * 1024 * 1024);
              yield new Uint8Array(await slice.arrayBuffer());
              offset += 10 * 1024 * 1024;
            }
          }
        }
      };

      await createPureVault(
        vaultSource,
        key,
        globalNonce,
        JSON.stringify(metadata),
        (pct, label) => {
          setProgress(pct);
          if (label) setProgressLabel(label);
        }
      );
      
      setStep(STEPS.DONE);
    } catch (err: any) {
      setError(err.message);
      setStep(STEPS.CONFIGURE);
    }
  };

  const reset = () => {
    setStep(STEPS.SELECT);
    setSelectedSource(null);
    setPassword('');
    setProgress(0);
    setError('');
    setPasswordError('');
  };

  // Determine Title based on mode
  const title = initialMode === 'file' ? 'Protect a File' : initialMode === 'folder' ? 'Protect a Folder' : 'Protect your files';
  const subtitle = initialMode === 'file' ? 'Add password protection before sharing or storing a file.' : initialMode === 'folder' ? 'Protect an entire folder with one password.' : 'Add a password to a file or folder directly in your browser.';

  return (
    <div className={`w-full max-w-2xl mx-auto ${hideHeader ? 'py-2' : 'py-12'} px-4 sm:px-6`}>
      
      {!hideHeader && (
        <div className="text-center mb-10">
          <h1 className="text-4xl font-extrabold text-gray-900 mb-4">{title}</h1>
          <p className="text-gray-500 text-lg max-w-lg mx-auto">{subtitle}</p>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        
        {step === STEPS.SELECT && (
          <div className="p-6 md:p-8 text-center">
            <div className="border-2 border-dashed border-gray-300 rounded-[2rem] p-6 max-w-3xl mx-auto bg-gray-50/50 hover:bg-gray-50 transition-colors">
              <div className="w-12 h-12 mx-auto mb-4">
                <FileIcon className="w-full h-full text-gray-400 stroke-1" />
              </div>
              
              <div className="flex flex-col items-center gap-3 max-w-sm mx-auto">
                {(initialMode === 'both' || initialMode === 'file') && (
                  <button onClick={handleSelectFile} className="w-full bg-brand-blue hover:bg-brand-blue-dark text-white font-bold py-3 px-6 rounded-lg transition-colors flex items-center justify-center gap-2 shadow-md hover:shadow-lg transform active:scale-95">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
                    Upload {initialMode === 'both' ? 'File' : 'from PC or Mobile'}
                  </button>
                )}
                {(initialMode === 'both' || initialMode === 'folder') && (
                  <button onClick={handleSelectFolder} className={`w-full font-bold py-3 px-6 rounded-lg transition-colors flex items-center justify-center gap-2 shadow-md hover:shadow-lg transform active:scale-95 ${initialMode === 'folder' ? 'bg-brand-blue hover:bg-brand-blue-dark text-white' : 'bg-white hover:bg-gray-50 border border-gray-200 text-brand-blue shadow-sm'}`}>
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6" /></svg>
                    Upload Folder
                  </button>
                )}
                <span className="text-gray-400 font-medium text-sm my-1">or Drag files here</span>
                
                <div className="w-8 h-8 bg-brand-blue/10 rounded-full flex items-center justify-center">
                    <svg className="w-4 h-4 text-brand-blue" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" /></svg>
                </div>
              </div>
            </div>

            {error && (
              <p className="mt-4 text-sm text-red-600 font-medium">{error}</p>
            )}
            
            <div className="mt-10 text-sm text-brand-blue font-medium italic opacity-80">
              Files are processed directly on your device. Nothing is uploaded to our servers.
            </div>
          </div>
        )}

        {/* STEP 2: CONFIGURE (PASSWORD) */}
        {step === STEPS.CONFIGURE && selectedSource && (
          <div className="p-8 md:p-12">
            <button onClick={reset} className="text-sm text-brand-blue hover:underline mb-6 flex items-center gap-1 font-medium">
              <RotateCcw className="w-4 h-4" /> Change selection
            </button>

            <div className="bg-gray-50 rounded-lg p-4 border border-gray-200 flex items-center gap-4 mb-8">
              {selectedSource.isFolder ? <Folder className="w-8 h-8 text-gray-400" /> : <FileIcon className="w-8 h-8 text-gray-400" />}
              <div className="flex-1 min-w-0">
                <h3 className="font-bold text-gray-900 truncate">{selectedSource.name}</h3>
                <p className="text-sm text-gray-500">{formatBytes(selectedSource.size)}</p>
              </div>
            </div>

            <hr className="border-gray-200 mb-8" />

            <div className="mb-8">
              <label className="block text-sm font-bold text-gray-900 mb-2">Create a password</label>
              <div className="relative">
                <input 
                  type={showPassword ? 'text' : 'password'} 
                  value={password} 
                  onChange={(e) => setPassword(e.target.value)} 
                  placeholder="Enter a strong password" 
                  className="w-full px-4 py-3 bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-blue/20 focus:border-brand-blue transition-all text-gray-900"
                />
                <button onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-3 text-gray-400 hover:text-gray-700">
                  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
              
              <div className="mt-3 flex items-start gap-2 text-sm text-gray-500 bg-blue-50 p-3 rounded-lg border border-blue-100">
                <AlertCircle className="w-5 h-5 text-brand-blue shrink-0" />
                <p>Keep this password somewhere safe. It cannot be recovered by FileLocker if lost.</p>
              </div>

              {passwordError && (
                <p className="mt-2 text-sm text-red-600 font-medium">{passwordError}</p>
              )}
            </div>

            <hr className="border-gray-200 mb-8" />

            <div className="mb-8">
              <h4 className="text-sm font-bold text-gray-900 mb-1">Output format</h4>
              <p className="text-sm text-gray-500">Your protected file will be saved as: <br/><strong className="text-gray-900 bg-gray-100 px-2 py-1 rounded inline-block mt-2 font-mono text-xs">{selectedSource.name}.vault</strong></p>
            </div>

            {error && (
              <div className="mb-6 p-4 bg-red-50 text-red-700 rounded-lg flex items-start gap-3 border border-red-100">
                <AlertCircle className="w-5 h-5 shrink-0" />
                <p className="text-sm font-medium">{error}</p>
              </div>
            )}

            <button onClick={handleProvision} disabled={!password} className="w-full bg-brand-blue hover:bg-brand-blue-dark text-white font-bold py-4 px-6 rounded-lg transition-colors flex items-center justify-center gap-2 text-lg disabled:opacity-50 disabled:cursor-not-allowed">
              <Lock className="w-5 h-5" /> Lock & Save File
            </button>
            <p className="text-center text-xs text-gray-400 mt-4">Your browser will ask you where to save the file.</p>
          </div>
        )}

        {/* STEP 3: PROCESSING */}
        {step === STEPS.PROCESSING && selectedSource && (
          <div className="p-8 md:p-12 text-center">
            <div className="w-16 h-16 mx-auto mb-6 relative">
              <Loader2 className="w-16 h-16 text-brand-blue animate-spin" />
              <div className="absolute inset-0 flex items-center justify-center">
                <Lock className="w-6 h-6 text-brand-blue" />
              </div>
            </div>
            
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Protecting your {selectedSource.isFolder ? 'folder' : 'file'}</h2>
            <p className="text-gray-500 font-medium truncate max-w-sm mx-auto mb-8">{selectedSource.name}</p>

            <div className="max-w-sm mx-auto mb-8">
              <div className="flex justify-between text-sm font-bold text-gray-700 mb-2">
                <span>{progressLabel}</span>
                <span className="text-brand-blue">{progress}%</span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
                <div className="bg-brand-blue h-full rounded-full transition-all duration-300" style={{ width: `${progress}%` }}></div>
              </div>
            </div>

            <p className="text-sm text-gray-500 max-w-sm mx-auto">
              Processing securely on your device. You can keep this tab open while the file is being prepared.
            </p>
          </div>
        )}

        {/* STEP 4: DONE */}
        {step === STEPS.DONE && selectedSource && (
          <div className="p-8 md:p-12 text-center">
            <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
              <CheckCircle2 className="w-10 h-10 text-green-600" />
            </div>
            
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Your protected file is ready</h2>
            <p className="text-gray-500 mb-8 max-w-sm mx-auto">Original size: {formatBytes(selectedSource.size)}</p>

            <div className="bg-gray-50 rounded-lg p-4 border border-gray-200 inline-block mb-10 text-left w-full max-w-sm">
              <span className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1 block">Saved As</span>
              <p className="font-mono text-sm text-gray-900 break-all">{selectedSource.name}.vault</p>
            </div>

            <div className="flex flex-col sm:flex-row justify-center gap-4">
              <button onClick={reset} className="bg-white border border-gray-300 hover:bg-gray-50 text-gray-900 font-bold py-3 px-6 rounded-lg transition-colors">
                Protect Another {initialMode === 'folder' ? 'Folder' : 'File'}
              </button>
            </div>

            <div className="mt-12 pt-8 border-t border-gray-100">
              <p className="text-sm text-gray-500 mb-2">Need to open this file later?</p>
              <a href="/unlock-file" className="text-brand-blue font-bold hover:underline">Unlock it here →</a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
