import { describe, expect, it } from 'vitest';
import { getRelativePath } from 'zapdev-agent/utils/workDir';
import { WORK_DIR } from 'zapdev-agent/constants';

describe('Diff', () => {
  it('should strip out Work_dir', () => {
    const filePath = `${WORK_DIR}/index.js`;
    const result = getRelativePath(filePath);
    expect(result).toBe('index.js');
  });
});
