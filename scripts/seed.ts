import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import sharp from 'sharp';
import { readConfig } from '../src/config.js';
import { createDatabase } from '../src/db.js';
import { createStorage } from '../src/storage.js';
import { hashPassword } from '../src/lib/password.js';
import { createLibrary } from '../src/services/library.js';

const config = readConfig();
if (config.NODE_ENV === 'production' || config.STORAGE_PROVIDER !== 'local')
  throw new Error('Demo data can only be created with local storage outside production.');
const db = createDatabase(config.databaseUrl);
try {
  const email = 'demo@stow.local';
  if (await db.user.findUnique({ where: { email } })) {
    console.log('The demo account already exists. Its login details are in data/demo-access.txt.');
    process.exitCode = 0;
  } else {
    const password = randomBytes(15).toString('base64url');
    const user = await db.user.create({
      data: { name: 'Miguel Rua', email, passwordHash: await hashPassword(password) },
    });
    const folders = await Promise.all([
      db.folder.create({ data: { name: 'Design explorations', color: 'sage', ownerId: user.id } }),
      db.folder.create({
        data: { name: 'Personal projects', color: 'lavender', ownerId: user.id },
      }),
      db.folder.create({ data: { name: 'Reading corner', color: 'peach', ownerId: user.id } }),
      db.folder.create({ data: { name: 'Little moments', color: 'blue', ownerId: user.id } }),
    ]);
    const drafts = await db.folder.create({
      data: { name: 'Early drafts', color: 'yellow', parentId: folders[1].id, ownerId: user.id },
    });
    const library = createLibrary(db, createStorage(config), config);
    async function add(
      name: string,
      buffer: Buffer,
      folderId: string | null,
      starred = false,
      daysAgo = 0,
    ) {
      const file = await library.upload(user.id, folderId, {
        originalname: name,
        buffer,
        size: buffer.length,
      } as Express.Multer.File);
      await db.file.update({
        where: { id: file.id },
        data: { starred, createdAt: new Date(Date.now() - daysAgo * 86400000) },
      });
    }
    const landscape = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1100" viewBox="0 0 1600 1100"><rect width="1600" height="1100" fill="#f1ead7"/><circle cx="1080" cy="310" r="155" fill="#d99b73"/><path d="M0 610Q330 250 770 560T1600 470V1100H0Z" fill="#bac6a0"/><path d="M0 850Q400 440 830 780T1600 690V1100H0Z" fill="#849878"/><path d="M0 960Q450 800 900 960T1600 870V1100H0Z" fill="#385b4b"/><text x="100" y="140" font-family="Georgia, serif" font-size="45" fill="#687757">A slower kind of Sunday.</text><text x="100" y="1020" font-family="sans-serif" font-size="18" fill="#dae2cf" letter-spacing="7">FIELD NOTES / NO. 03</text></svg>`;
    const poster = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1600"><rect width="1200" height="1600" fill="#e8e6db"/><rect x="75" y="75" width="1050" height="1450" fill="none" stroke="#a6ad97"/><text x="140" y="225" font-family="sans-serif" font-size="22" letter-spacing="8" fill="#617655">STUDIES IN BALANCE</text><circle cx="600" cy="690" r="300" fill="#b7c49c"/><rect x="370" y="460" width="300" height="700" rx="150" transform="rotate(22 520 810)" fill="#7f9178"/><circle cx="790" cy="950" r="190" fill="#d7ab86"/><text x="140" y="1345" font-family="Georgia,serif" font-size="92" fill="#365243">Room to grow.</text><text x="140" y="1420" font-family="sans-serif" font-size="19" letter-spacing="5" fill="#7a8971">FORM / COLOR / QUIET</text></svg>`;
    const picture = await sharp(Buffer.from(landscape)).png().toBuffer();
    const art = await sharp(Buffer.from(poster)).png().toBuffer();
    const content =
      'BT /F1 24 Tf 72 680 Td (Project notebook) Tj 0 -40 Td /F1 12 Tf (Keep good ideas close.) Tj ET\n';
    const objects = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
      `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}endstream`,
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ];
    let pdfSource = '%PDF-1.4\n';
    const offsets = [0];
    objects.forEach((object, index) => {
      offsets.push(Buffer.byteLength(pdfSource));
      pdfSource += `${index + 1} 0 obj\n${object}\nendobj\n`;
    });
    const xrefOffset = Buffer.byteLength(pdfSource);
    pdfSource += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    offsets.slice(1).forEach((offset) => {
      pdfSource += `${String(offset).padStart(10, '0')} 00000 n \n`;
    });
    pdfSource += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
    const pdf = Buffer.from(pdfSource);
    await add('Project notebook.pdf', pdf, null, true, 0);
    await add('Sunday in the hills.png', picture, null, false, 1);
    await add(
      'Reading list.md',
      Buffer.from(
        '# Reading list\n\n- A Pattern Language\n- The Design of Everyday Things\n- The Creative Act\n',
      ),
      null,
      true,
      2,
    );
    await add(
      'October budget.csv',
      Buffer.from('Category,Planned,Actual\nBooks,75,42\nWorkspace,120,95\nCoffee,45,32\n'),
      null,
      false,
      3,
    );
    await add('Room to grow.png', art, null, false, 4);
    await add(
      'Notes for a new chapter.txt',
      Buffer.from(
        'Make room for the ideas that keep coming back.\n\nBuild a small thing well. Let it grow from there.\n',
      ),
      null,
      false,
      5,
    );
    await add('Color studies.png', art, folders[0].id, true);
    await add(
      'Project brief.md',
      Buffer.from(
        '# A calmer workspace\n\nAn exploration of personal storage, thoughtful defaults, and gentle organization.\n',
      ),
      folders[1].id,
    );
    await add(
      'First thoughts.txt',
      Buffer.from('Folders should feel like a place, not a chore.\n'),
      drafts.id,
    );
    await add(
      'On paying attention.md',
      Buffer.from('# On paying attention\n\nA collection of things worth returning to.\n'),
      folders[2].id,
    );
    await add('A quiet Sunday.png', picture, folders[3].id);
    const accessPath = path.resolve('data/demo-access.txt');
    await mkdir(path.dirname(accessPath), { recursive: true });
    await writeFile(accessPath, `Stow local demo\nEmail: ${email}\nPassword: ${password}\n`, {
      mode: 0o600,
    });
    console.log(`Demo workspace created. Login details: ${accessPath}`);
  }
} finally {
  await db.$disconnect();
}
