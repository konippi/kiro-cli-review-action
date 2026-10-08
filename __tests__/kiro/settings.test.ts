import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ writeJsonFile: vi.fn() }));

vi.mock('../../src/fs.js', () => ({ writeJsonFile: mocks.writeJsonFile }));

import { writeKiroSettings } from '../../src/kiro/settings.js';

describe('writeKiroSettings', () => {
  it('writes disabled inherited-resource settings under KIRO_HOME', () => {
    writeKiroSettings('/kiro-home');

    expect(mocks.writeJsonFile).toHaveBeenCalledWith(join('/kiro-home', 'settings', 'cli.json'), {
      'chat.disableInheritingDefaultResources': true,
    });
  });
});
