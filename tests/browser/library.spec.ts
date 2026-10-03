import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('a complete workspace flow works on desktop and mobile', async ({
  page,
  browser,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'A little space for everything.' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(
    (
      await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
    ).violations.map((item) => ({
      id: item.id,
      nodes: item.nodes.map((node) => ({ target: node.target, failure: node.failureSummary })),
    })),
  ).toEqual([]);
  await page.getByRole('link', { name: 'Make yourself at home' }).click();
  await page.getByLabel('Your name').fill('Portfolio Reviewer');
  await page.getByLabel('Email address').fill(`${testInfo.project.name}-${Date.now()}@example.com`);
  await page.getByLabel('Password', { exact: true }).fill('A-browser-test-password-2026');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'My files.' })).toBeVisible();
  expect(
    (
      await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
    ).violations.map((item) => ({
      id: item.id,
      nodes: item.nodes.map((node) => ({ target: node.target, failure: node.failureSummary })),
    })),
  ).toEqual([]);
  await page.getByRole('button', { name: 'New folder', exact: true }).click();
  await page.getByLabel('Folder name', { exact: true }).fill('Portfolio documents');
  await page.getByLabel('lavender', { exact: true }).check();
  await page.getByRole('button', { name: 'Create folder' }).click();
  await page.getByRole('link', { name: /Portfolio documents/ }).click();
  await page.getByRole('button', { name: 'Upload file', exact: true }).click();
  await page.getByLabel('Choose file to upload').setInputFiles({
    name: 'project-notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('A complete browser flow.\n'),
  });
  await expect(page.locator('#selected-file')).toContainText('project-notes.txt');
  await page.locator('#upload-submit').click();
  await expect(page.getByRole('link', { name: /project-notes.txt/ }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Star project-notes.txt', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Unstar project-notes.txt', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page
    .getByRole('link', { name: /project-notes.txt/ })
    .first()
    .click();
  await expect(page.getByRole('heading', { name: 'File information' })).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('link', { name: 'Download', exact: true }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('project-notes.txt');
  await page.getByRole('button', { name: 'Rename', exact: true }).click();
  await page.getByLabel('File name', { exact: true }).fill('finished-project.txt');
  await page.getByRole('button', { name: 'Save name' }).click();
  await expect(page.getByRole('heading', { name: 'finished-project.txt', level: 1 })).toBeVisible();
  await page.locator('.breadcrumbs').getByRole('link', { name: 'Portfolio documents' }).click();
  await page.getByRole('button', { name: 'Share folder', exact: true }).click();
  await page.getByLabel('Link expires after').selectOption('10');
  await page.getByRole('button', { name: 'Create share link' }).click();
  const shareUrl = await page
    .getByRole('textbox', { name: 'Share link for Portfolio documents' })
    .inputValue();
  const sharedPath = new URL(shareUrl).pathname;
  const visitor = await browser.newContext();
  const publicPage = await visitor.newPage();
  await publicPage.goto(`http://127.0.0.1:3100${sharedPath}`);
  await expect(publicPage.getByText('finished-project.txt')).toBeVisible();
  await expect(publicPage.getByRole('button', { name: /Upload/ })).toHaveCount(0);
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Revoke access' }).click();
  await publicPage.reload();
  await expect(publicPage.getByText(/expired or is no longer available/)).toBeVisible();
  await visitor.close();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  if (testInfo.project.name === 'mobile') {
    await page.getByRole('button', { name: 'Open navigation' }).click();
    await expect(
      page.getByRole('button', { name: 'Close navigation', exact: true }).first(),
    ).toBeVisible();
  }
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible();
  expect(errors).toEqual([]);
});
