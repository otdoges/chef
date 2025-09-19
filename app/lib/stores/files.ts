import type { CodeInterpreter } from '@e2b/code-interpreter';
import { getEncoding } from 'istextorbinary';
import { map, type MapStore } from 'nanostores';
import { Buffer } from 'node:buffer';
import { path } from 'zapdev-agent/utils/path';
import { WORK_DIR } from 'zapdev-agent/constants.js';
import { computeFileModifications } from '~/utils/diff';
import { createScopedLogger } from 'zapdev-agent/utils/logger';
import { unreachable } from 'zapdev-agent/utils/unreachable';
import { incrementFileUpdateCounter } from './fileUpdateCounter';
import { getAbsolutePath, type AbsolutePath } from 'zapdev-agent/utils/workDir';
import type { File, FileMap } from 'zapdev-agent/types';
import { writeFile, readFile, listFiles } from '~/lib/e2b';

const logger = createScopedLogger('FilesStore');

const utf8TextDecoder = new TextDecoder('utf8', { fatal: true });

export class FilesStore {
  #codeInterpreter: Promise<CodeInterpreter>;

  /**
   * Tracks the number of files without folders.
   */
  #size = 0;

  /**
   * @note Keeps track all modified files with their original content since the last user message.
   * Needs to be reset when the user sends another message and all changes have to be submitted
   * for the model to be aware of the changes.
   */
  #modifiedFiles: Map<AbsolutePath, string> = import.meta.hot?.data.modifiedFiles ?? new Map();

  /**
   * Map of files that matches the state of E2B Code Interpreter.
   */
  files: MapStore<FileMap> = import.meta.hot?.data.files ?? map({});
  userWrites: Map<AbsolutePath, number> = import.meta.hot?.data.userWrites ?? new Map();

  // File watching interval
  #watchInterval: number | null = null;
  #watchedFiles: Set<string> = new Set();

  get filesCount() {
    return this.#size;
  }

  constructor(codeInterpreterPromise: Promise<CodeInterpreter>) {
    this.#codeInterpreter = codeInterpreterPromise;

    if (import.meta.hot) {
      import.meta.hot.data.files = this.files;
      import.meta.hot.data.modifiedFiles = this.#modifiedFiles;
      import.meta.hot.data.userWrites = this.userWrites;
    }

    this.#init();
  }

  getFile(filePath: AbsolutePath) {
    const dirent = this.files.get()[filePath];

    if (dirent?.type !== 'file') {
      return undefined;
    }

    return dirent;
  }

  getFileModifications() {
    return computeFileModifications(this.files.get(), this.#modifiedFiles);
  }
  
  getModifiedFiles() {
    let modifiedFiles: { [path: string]: File } | undefined = undefined;

    for (const [filePath, originalContent] of this.#modifiedFiles) {
      const file = this.files.get()[filePath];

      if (file?.type !== 'file') {
        continue;
      }

      if (file.content === originalContent) {
        continue;
      }

      if (!modifiedFiles) {
        modifiedFiles = {};
      }

      modifiedFiles[filePath] = file;
    }

    return modifiedFiles;
  }

  resetFileModifications() {
    this.#modifiedFiles.clear();
  }

  async saveFile(filePath: AbsolutePath, content: string) {
    try {
      const relativePath = path.relative(WORK_DIR, filePath);

      if (!relativePath) {
        throw new Error(`EINVAL: invalid file path, write '${relativePath}'`);
      }

      const oldContent = this.getFile(filePath)?.content;

      if (!oldContent) {
        unreachable('Expected content to be defined');
      }

      await writeFile(relativePath, content);

      if (!this.#modifiedFiles.has(filePath)) {
        this.#modifiedFiles.set(filePath, oldContent);
      }

      // we immediately update the file and don't rely on the file watching
      this.files.setKey(filePath, { type: 'file', content, isBinary: false });
      this.userWrites.set(filePath, Date.now());

      logger.info('File updated');
    } catch (error) {
      logger.error('Failed to update file content\n\n', error);

      throw error;
    }
  }

  async #init() {
    const codeInterpreter = await this.#codeInterpreter;
    (globalThis as any).codeInterpreter = codeInterpreter;
    
    // Start file watching using polling since E2B doesn't have native file watching
    this.#startFileWatching();
  }

  async prewarmWorkdir(container: CodeInterpreter) {
    try {
      const files = await listFiles(WORK_DIR);
      
      // Process directories first
      const dirs = new Set<string>();
      for (const file of files) {
        if (file.type === 'directory') {
          const fullPath = path.join(WORK_DIR, file.name);
          dirs.add(fullPath);
          this.files.setKey(getAbsolutePath(fullPath), { type: 'folder' });
        }
      }

      // Then process files
      for (const file of files) {
        if (file.type === 'file') {
          const fullPath = path.join(WORK_DIR, file.name);
          try {
            const content = await readFile(fullPath);
            const buffer = new TextEncoder().encode(content);
            const isBinary = isBinaryFile(buffer);
            
            this.files.setKey(getAbsolutePath(fullPath), { 
              type: 'file', 
              content: isBinary ? '' : content, 
              isBinary 
            });
            
            this.#watchedFiles.add(fullPath);
            this.#size++;
          } catch (error) {
            logger.error(`Failed to read file ${fullPath}:`, error);
          }
        }
      }
    } catch (error) {
      logger.error('Failed to prewarm workdir:', error);
    }
  }

  #startFileWatching() {
    // Poll for file changes every 2 seconds
    this.#watchInterval = window.setInterval(async () => {
      try {
        await this.#checkForFileChanges();
      } catch (error) {
        logger.error('Error checking for file changes:', error);
      }
    }, 2000);
  }

  async #checkForFileChanges() {
    try {
      const files = await listFiles(WORK_DIR);
      const currentFiles = new Set<string>();
      
      // Check for new/modified files
      for (const file of files) {
        const fullPath = path.join(WORK_DIR, file.name);
        currentFiles.add(fullPath);
        
        if (file.type === 'file') {
          const existingFile = this.files.get()[getAbsolutePath(fullPath)];
          
          if (!existingFile) {
            // New file
            try {
              const content = await readFile(fullPath);
              const buffer = new TextEncoder().encode(content);
              const isBinary = isBinaryFile(buffer);
              
              this.files.setKey(getAbsolutePath(fullPath), { 
                type: 'file', 
                content: isBinary ? '' : content, 
                isBinary 
              });
              
              this.#size++;
              incrementFileUpdateCounter(fullPath);
            } catch (error) {
              logger.error(`Failed to read new file ${fullPath}:`, error);
            }
          } else if (existingFile.type === 'file' && !existingFile.isBinary) {
            // Check if file content changed
            try {
              const content = await readFile(fullPath);
              if (content !== existingFile.content) {
                this.files.setKey(getAbsolutePath(fullPath), { 
                  ...existingFile,
                  content 
                });
                incrementFileUpdateCounter(fullPath);
              }
            } catch (error) {
              // File might have been deleted or become inaccessible
              logger.debug(`Could not read file ${fullPath}, might be deleted`);
            }
          }
        } else if (file.type === 'directory') {
          const existingDir = this.files.get()[getAbsolutePath(fullPath)];
          if (!existingDir) {
            this.files.setKey(getAbsolutePath(fullPath), { type: 'folder' });
            incrementFileUpdateCounter(fullPath);
          }
        }
        
        this.#watchedFiles.add(fullPath);
      }
      
      // Check for deleted files
      for (const watchedFile of this.#watchedFiles) {
        if (!currentFiles.has(watchedFile)) {
          const existingFile = this.files.get()[getAbsolutePath(watchedFile)];
          if (existingFile) {
            this.files.setKey(getAbsolutePath(watchedFile), undefined);
            if (existingFile.type === 'file') {
              this.#size--;
            }
            incrementFileUpdateCounter(watchedFile);
          }
          this.#watchedFiles.delete(watchedFile);
        }
      }
    } catch (error) {
      logger.error('Error in file watching:', error);
    }
  }

  #decodeFileContent(buffer?: Uint8Array) {
    if (!buffer || buffer.byteLength === 0) {
      return '';
    }

    try {
      return utf8TextDecoder.decode(buffer);
    } catch (error) {
      console.log(error);
      return '';
    }
  }

  destroy() {
    if (this.#watchInterval) {
      clearInterval(this.#watchInterval);
      this.#watchInterval = null;
    }
  }
}

function isBinaryFile(buffer: Uint8Array | undefined) {
  if (buffer === undefined) {
    return false;
  }

  return getEncoding(convertToBuffer(buffer), { chunkLength: 100 }) === 'binary';
}

/**
 * Converts a `Uint8Array` into a Node.js `Buffer` by copying the prototype.
 * The goal is to  avoid expensive copies. It does create a new typed array
 * but that's generally cheap as long as it uses the same underlying
 * array buffer.
 */
function convertToBuffer(view: Uint8Array): Buffer {
  return Buffer.from(view.buffer, view.byteOffset, view.byteLength);
}

export const FILE_EVENTS_DEBOUNCE_MS = 100;