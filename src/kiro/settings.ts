import { join } from 'node:path';
import { writeJsonFile } from '../fs.js';

/** Writes Kiro settings that disable inherited default resources. */
export function writeKiroSettings(kiroHome: string): void {
  writeJsonFile(join(kiroHome, 'settings', 'cli.json'), {
    'chat.disableInheritingDefaultResources': true,
  });
}
