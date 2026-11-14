import { test, expect } from '@playwright/test';

const roots = ['https://verbacorpus.org/', ...['pro', 'contra', 're', 'para', 'non'].map(direction => `https://${direction}.verbacorpus.org/`)];

let errors: string[];
test.beforeEach(({ page }) => {
  errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => {
    const url = new URL(response.url());
    if (roots.some(root => new URL(root).origin === url.origin) && response.status() >= 400) errors.push(`${response.status()} ${url.origin}${url.pathname}`);
  });
  page.on('requestfailed', request => {
    const url = new URL(request.url()), error = request.failure()?.errorText ?? '';
    if (roots.some(root => new URL(root).origin === url.origin) && ['script', 'stylesheet', 'font'].includes(request.resourceType()) && !/abort|cancel/i.test(error)) errors.push(`${error} ${url.origin}${url.pathname}`);
  });
});

test.afterEach(async ({}, info) => {
  if (errors.length) await info.attach('browser-errors', { body: JSON.stringify(errors), contentType: 'application/json' });
  expect(errors, 'JavaScript errors and failed same-site resources').toEqual([]);
});

for (const url of roots) test(`${new URL(url).hostname} renders content and shared navigation`, async ({ page }) => {
  const response = await page.goto(url);
  expect(response?.status()).toBe(200);
  await expect(page.locator('main')).toBeVisible();
  await expect(page.locator('h1').first()).toBeVisible();
  await expect(page.locator('[data-verba-navigation]')).toBeVisible();
  await expect(page.locator('[data-verba-footer]')).toBeVisible();
  await expect(page.locator('[data-verba-author]')).toHaveAttribute('href', 'https://yemelianov.dev/');
  await expect(page.locator('link[rel=canonical]')).toHaveAttribute('href', url);
  expect(await page.locator('[data-verba-direction]').evaluateAll(links => links.map(link => (link as HTMLAnchorElement).href))).toEqual(roots);
  // Finish the initial assets before reload so navigation cancellation is not mistaken for a load failure.
  await page.waitForLoadState('networkidle');
  const previous = await page.locator('html').getAttribute('data-theme');
  await page.locator('[data-verba-theme]').click();
  const theme = previous === 'dark' ? 'light' : 'dark';
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await page.reload();
  await page.waitForLoadState('networkidle');
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await page.locator('.verba-network-brand').click();
  await expect(page).toHaveURL(roots[0]);
  await expect(page.locator('.corpus-card')).toHaveCount(5);
});

test('primary UPA and alphabet tools open from their parent sites', async ({ page }) => {
  await page.goto('https://non.verbacorpus.org/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Візерунки української вишивки');
  const hero = page.locator('.non-hero-pattern img');
  await expect(hero).toBeVisible();
  await expect.poll(() => hero.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  await page.getByRole('link', { name: 'Відкрити каталог UPA →' }).click();
  await expect(page).toHaveURL('https://non.verbacorpus.org/upa/');
  await expect(page.locator('#result-count')).toContainText('167 / 167');
  await page.getByRole('link', { name: /Рамки для сторінок/ }).first().click();
  await expect(page.locator('#page-frame-form')).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('#page-frame-image')).toBeVisible();
  for (const path of ['fonts', 'letters-lab']) {
    await page.goto('https://para.verbacorpus.org/');
    const destination = `https://para.verbacorpus.org/${path}`;
    await page.locator(`a[href="/${path}"],a[href="${destination}"]`).first().click();
    await expect.poll(() => new URL(page.url()).origin + new URL(page.url()).pathname).toBe(destination);
    await expect(page.locator('h1')).toBeVisible();
    await expect(page.locator('[data-verba-author]')).toHaveAttribute('href', 'https://yemelianov.dev/');
  }
});

test('proverb search and public APIs return corpus data', async ({ page, request }) => {
  await page.goto('https://pro.verbacorpus.org/');
  await expect(page.locator('#hero .hero-card')).toBeVisible();
  await page.locator('#q').fill('хата');
  await expect(page.locator('#count')).toContainText('Знайдено');
  await expect(page.locator('#results .entry').first()).toBeVisible();
  await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBe('хата');
  for (const [url, property] of [
    ['https://pro.verbacorpus.org/api/v1/meta', 'count'],
    ['https://non.verbacorpus.org/upa/api/v1/patterns?limit=1', 'total'],
  ]) {
    const response = await request.get(url);
    expect(response.status()).toBe(200);
    expect((await response.json())[property]).toBeGreaterThan(0);
  }
});
