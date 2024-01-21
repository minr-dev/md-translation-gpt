import { readFileSync, writeFileSync, chmodSync } from 'fs';
import { join } from 'path';

const filePath = join(process.cwd(), 'lib', 'main.js');
const data = readFileSync(filePath, 'utf8');

// Add shebang
if (!data.startsWith('#!/usr/bin/env node')) {
  const newData = `#!/usr/bin/env node\n${data}`;
  writeFileSync(filePath, newData, 'utf8');
}

// Add execute permissions
chmodSync(filePath, '755');
