import { readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import prettier from 'prettier';

const check = process.argv.includes('--check');
async function formatDirectory(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await formatDirectory(filename);
      continue;
    }
    if (!entry.name.endsWith('.ejs') || entry.name === 'foot.ejs') continue;
    const source = await readFile(filename, 'utf8');
    const tokens = [];
    // Mask complete expressions so the HTML formatter cannot split JavaScript strings.
    const masked = source.replace(/<%[\s\S]*?%>/g, (token) => {
      const id = tokens.push(token) - 1;
      return `stow-ejs-token-${String(id).padStart(5, '0')}`;
    });
    const formatted = await prettier.format(masked, {
      parser: 'html',
      printWidth: 100,
      plugins: [],
    });
    const restored = formatted.replace(
      /stow-ejs-token-(\d{5})/g,
      (_match, id) => tokens[Number(id)],
    );
    if (restored === source) continue;
    if (check) {
      console.error(`Formatting required: ${filename}`);
      process.exitCode = 1;
    } else await writeFile(filename, restored);
  }
}
await formatDirectory('views');
