import { chromium } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const browser = await chromium.launch(
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
    : {},
);
try {
  const output = path.resolve('docs/images');
  await mkdir(output, { recursive: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1050 },
    deviceScaleFactor: 1,
  });
  const base = process.env.APP_URL || 'http://localhost:3000';
  await page.goto(base);
  await page.screenshot({
    path: path.join(output, 'landing.png'),
    fullPage: true,
    animations: 'disabled',
  });
  const access = await readFile('data/demo-access.txt', 'utf8');
  const email = access.match(/Email: (.+)/)[1];
  const password = access.match(/Password: (.+)/)[1];
  await page.goto(`${base}/login`);
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL('**/app');
  await page.screenshot({
    path: path.join(output, 'workspace.png'),
    fullPage: true,
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: path.join(output, 'mobile.png'),
    fullPage: true,
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page
    .getByRole('link', { name: /Sunday in the hills.png/ })
    .first()
    .click();
  await page.locator('.preview-panel img').waitFor();
  await page.screenshot({
    path: path.join(output, 'file-details.png'),
    fullPage: true,
    animations: 'disabled',
  });
  console.log(`Screenshots saved to ${output}`);
} finally {
  await browser.close();
}
