import { WORK_DIR } from 'zapdev-agent/constants';
import { listFiles, readFile } from '~/lib/e2b';

export const filesToArtifacts = (files: { [path: string]: { content: string } }, id: string): string => {
  return `
<boltArtifact id="${id}" title="User Updated Files">
${Object.keys(files)
  .map(
    (filePath) => `
<boltAction type="file" filePath="${filePath}">
${files[filePath].content}
</boltAction>
`,
  )
  .join('\n')}
</boltArtifact>
  `;
};

export function workDirRelative(absPath: string) {
  if (absPath === WORK_DIR) {
    return '';
  }
  const withSlash = `${WORK_DIR}/`;
  // The agent often sends relative paths instead of absolute paths, so we should just return that.
  if (!absPath.startsWith(withSlash)) {
    return absPath;
  }
  return absPath.slice(withSlash.length);
}

export async function readPath(
  relPath: string,
): Promise<{ type: 'directory'; children: Array<{ name: string; type: 'file' | 'directory' }> } | { type: 'file'; content: string; isBinary: boolean }> {
  try {
    const children = await listFiles(relPath);
    return { type: 'directory', children };
  } catch (e: any) {
    // If we made it here, the path isn't a directory, so let's
    // try it as a file below.
    try {
      const content = await readFile(relPath);
      return { type: 'file', content, isBinary: false };
    } catch (fileError) {
      throw e; // Throw the original directory error
    }
  }
}
