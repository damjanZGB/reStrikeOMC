import { test, expect } from '@playwright/test';

test.describe('first-run + auth + dashboard smoke', () => {
  test('completes setup, logs in, navigates dashboard, adds a connection', async ({
    page,
  }) => {
    // First-run setup screen
    await page.goto('/');
    await expect(page.getByText(/first-run setup/i)).toBeVisible();

    await page.getByLabel(/username/i).fill('alice');
    await page.getByLabel(/password/i).fill('longenoughpw');
    await page.getByRole('button', { name: /create account/i }).click();

    // After setup, the app auto-logs in and lands on dashboard
    await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible({
      timeout: 15_000,
    });

    // Selection counter starts at 0 of 0 (no connections yet)
    await expect(page.getByText(/selection \(0 of 0\)/i)).toBeVisible();

    // Navigate to Connections
    await page.getByRole('link', { name: /connections/i }).click();
    await expect(page.getByRole('heading', { name: /connections/i })).toBeVisible();
    await expect(page.getByText(/no connections yet/i)).toBeVisible();

    // Add a connection
    await page.getByRole('button', { name: /add connection/i }).click();
    await page.getByLabel(/^name$/i).fill('Studio Smoke');
    await page.getByLabel(/^host$/i).fill('127.0.0.1');
    // Port input already has 4455 by default
    await page.getByRole('button', { name: /^add$/i }).click();

    // The new card appears in the list
    await expect(page.getByText('Studio Smoke')).toBeVisible();
    await expect(page.getByText(/127\.0\.0\.1:4455/)).toBeVisible();
  });

  test('rejects login with wrong credentials', async ({ page, context }) => {
    // Logout (clear cookies) so we're back on /login
    await context.clearCookies();
    await page.goto('/');
    // Wait for the loading state to resolve and the login form to mount
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible({
      timeout: 15_000,
    });

    await page.getByLabel(/username/i).fill('alice');
    await page.getByLabel(/password/i).fill('wrong');
    await page.getByRole('button', { name: /sign in/i }).click();

    await expect(page.getByText(/invalid username or password/i)).toBeVisible();
  });
});
