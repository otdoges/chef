import { IGNORED_RELATIVE_PATHS } from '~/utils/constants';
import { codeInterpreter } from '~/lib/e2b';

export async function buildUncompressedSnapshot(): Promise<Uint8Array> {
  // TODO: Implement snapshot functionality for E2B
  // For now, return empty snapshot as this feature needs E2B-specific implementation
  console.warn('buildUncompressedSnapshot not yet implemented for E2B');
  return new Uint8Array();
}
