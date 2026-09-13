import { test, expect } from "@playwright/test";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { createService } from "../../packages/vibe64-source-editor/src/server/service.js";
import { mockDirectChatSession } from "./support/base-shell-mocks";
import { DASHBOARD_PATH, directChatSessionId } from "./support/base-shell-data";
import { fulfillJson, routeApiEndpoint } from "./support/base-shell/http";

const viewport={name:'expanded',width:1440,height:2400};
test('payment configuration persists and catalogue publication requires review',async ({page})=>{test.setTimeout(210000);
    page.setDefaultTimeout(10000);
    await page.setViewportSize(viewport);
    const root = await mkdtemp(path.join(tmpdir(), "vibe64-integration-browser-"));
    const source = path.join(root, "sessions", "active", directChatSessionId, "source");
    await mkdir(source, { recursive: true });
    const service = createService({
      temporaryRoot: path.join(root, "temporary"),
      projectService: { createRuntime: async () => ({
        stateRoot: path.join(root, "state"),
        getSession: async (sessionId) => ({ sessionId, metadata: {
          source_kind: "session_clone", source_path: source, source_path_authority: "managed_session_source"
        } })
      }) }
    });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await page.route("**/api/**", async (route) => {
        errors.push(`Unexpected API request: ${route.request().method()} ${new URL(route.request().url()).pathname}`);
        await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ ok: false, error: "Unmocked integration test request." }) });
      });
      await mockDirectChatSession(page);
      for (const [endpoint, payload] of [
        ["/vibe64/settings", { ok: true, promptHints: { enabled: false } }],
        ["/vibe64/sessions/current", { ok: true, sessionId: directChatSessionId }],
        [`/vibe64/sessions/${directChatSessionId}/agent-session`, { ok: true }],
        [`/vibe64/sessions/${directChatSessionId}/presence`, { ok: true }],
        [`/vibe64/sessions/${directChatSessionId}/assistant-access`, { ok: true, available: true, canUse: true, ownerOnly: false }],
        [`/vibe64/sessions/${directChatSessionId}/message-suggestions`, { ok: true, suggestions: [], canManage: true }],
        [`/vibe64/sessions/${directChatSessionId}/work`, { ok: true, unsaved: false, operation: null, updateOperation: null }],
        [`/vibe64/sessions/${directChatSessionId}/updates/check`, { ok: true, updateAvailable: false, status: "up-to-date" }],
        [`/vibe64/sessions/${directChatSessionId}/renewal`, { ok: true, renewal: null, viewerScope: "integration-test-owner" }],
        [`/vibe64/sessions/${directChatSessionId}/source-editor/stars`, { ok: true, files: [] }]
      ] as const) {
        await routeApiEndpoint(page, endpoint, (route) => fulfillJson(route, payload));
      }
      await routeApiEndpoint(page, `/vibe64/sessions/${directChatSessionId}/integrations`, async (route) => {
        const input = { sessionId: directChatSessionId, ...route.request().postDataJSON() };
        const response = route.request().method() === "PUT"
          ? await service.saveIntegrations(input)
          : await service.readIntegrations(input);
        await route.fulfill({ status: response.statusCode || 200, contentType: "application/json", body: JSON.stringify(response) });
      });
      const historyRequests: unknown[] = [];
      let historyFails = false;
      let publications = 0;
      let readinessFails = false;
      let pendingRecovery = false;
      let recoveries = 0;
      let paymentsImplemented = false;
      await page.route(/\/integrations\/[^/]+\/setup$/, async (route) => {
        const body = route.request().postDataJSON();
        if (body.operation.startsWith('payments-')) {
          expect(body.paymentEnvironment).toBe('sandbox');
          if (!paymentsImplemented) { await fulfillJson(route, { ok: true, status: 'unconfigured' }); return; }
          if (body.operation === 'payments-history') {
            historyRequests.push(body);
            if (historyFails) { await route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'History unavailable.' }) }); return; }
            expect(body.subjectId).toBe('tenant-a');
            expect(body.collection).toBe('transactions');
            await fulfillJson(route, { ok: true, status: 'payments-history', paymentEnvironment: 'sandbox', providerAccountId: 'paddle_fixture',
              subjectId: body.subjectId, collection: body.collection,
              items: body.after ? [] : [{ id: 'txn_1', kind: 'transaction', status: 'completed', createdAt: '2026-09-12T00:00:00.000Z', currency: 'USD', totalMinor: '1200', paidMinor: null }],
              nextCursor: body.after ? null : 'txn_1' });
            return;
          }
          if (body.operation === 'payments-readiness') {
            if (readinessFails) {
              await route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'Readiness unavailable.' }) });
            } else await fulfillJson(route, { ok: true, status: 'payments-readiness', paymentEnvironment: 'sandbox', providerAccountId: 'acct_fixture',
              checks: ['credentials', 'account', 'charges', 'payouts', 'catalogue', 'webhook', 'checkout', 'site', 'deployment'].map((id) => ({ id,
                status: id === 'credentials' ? 'passed' : id === 'site' ? 'manual' : 'unknown', detail: id === 'credentials' ? 'Credentials verified by fixture.' : 'More evidence is needed.' })) });
            return;
          }
          if (body.operation === 'payments-recover') {
            expect(body.reviewId).toBe('a'.repeat(64));
            expect(body.providerId).toBe('price_recovered');
            recoveries++;
            pendingRecovery = false;
          }
          if (body.operation === 'payments-publish') {
            expect(body.reviewId).toBe('a'.repeat(64));
            publications++;
          }
          await fulfillJson(route, { ok: true, status: 'payments', paymentEnvironment: 'sandbox', providerAccountId: 'acct_fixture',
            review: { reviewId: 'a'.repeat(64), changes: publications ? [] : [{ action: 'create-product', planId: 'pro', name: 'Professional' }], drift: [], removed: [], pending: pendingRecovery, ...(pendingRecovery ? { pendingOperation: { action: 'create-price', planId: 'pro', amount: 1200, currency: 'USD', interval: 'month' } } : {}) } });
        } else await fulfillJson(route, { ok: true, status: 'disconnected' });
      });
      await page.goto(`${DASHBOARD_PATH}/integrations`);
      const showProject = page.getByRole("button", { name: "Show project", exact: true });
      if (viewport.name !== "expanded") await showProject.click();
      const panel = page.locator(".integrations-panel");
      await expect(panel.getByRole("heading", { name: "Integrations", exact: true })).toBeVisible({ timeout: 30000 });

      await panel.getByRole('textbox',{name:'Search integrations',exact:true}).fill('Stripe');
      await panel.getByRole('button',{name:'Add Stripe',exact:true}).click();
      await panel.getByRole('textbox',{name:'API key reference',exact:true}).fill('env:STRIPE_API_KEY');
      await panel.getByRole('button',{name:'Configure sandbox payments',exact:true}).click();
      const payment = panel.getByRole('region',{name:'Application payments',exact:true});
      await payment.getByRole('textbox',{name:'Provider account identity',exact:true}).fill('acct_fixture');
      await payment.getByRole('textbox',{name:'New stable plan ID',exact:true}).fill('pro');
      await payment.getByRole('button',{name:'Add plan',exact:true}).click();
      await payment.getByRole('textbox',{name:'Plan name',exact:true}).fill('Professional');
      await payment.getByRole('spinbutton',{name:'Amount in smallest currency unit',exact:true}).fill('1200');
      await payment.getByRole('spinbutton',{name:'Credits per paid period',exact:true}).fill('100');
      await panel.getByRole('button',{name:'Save configuration',exact:true}).click();
      await expect(panel.getByRole('button',{name:'Save configuration',exact:true})).toBeDisabled();
      const saved=JSON.parse(await readFile(path.join(source,'integrations.json'),'utf8'));
      expect(saved.extensions.payments.plans.pro.amount).toBe(1200);
      expect(saved.extensions.payments.environments.sandbox.integrationId).toBe('stripe');
      await page.reload();
      await expect(payment.getByRole('textbox',{name:'Plan name',exact:true})).toHaveValue('Professional');
      await payment.getByRole('button',{name:'Set up payment events and checkout',exact:true}).click();
      await expect(payment).toContainText('Workbench');
      await payment.getByRole('button', { name: 'Preview sandbox catalogue', exact: true }).click();
      await expect(payment).toContainText('Your application needs payment management implemented');
      await expect(payment.getByRole('button', { name: 'Review publication', exact: true })).toHaveCount(0);
      expect(publications).toBe(0);
      paymentsImplemented = true;
      await payment.getByRole('button', { name: 'Preview sandbox catalogue', exact: true }).click();
      await expect(payment).toContainText('Create product');
      await payment.getByRole('button', { name: 'Check sandbox readiness', exact: true }).click();
      const readiness = payment.getByRole('region', { name: 'Payment readiness', exact: true });
      await expect(readiness).toContainText('Credentials · Passed');
      await expect(readiness).toContainText('Merchant identity · Not verified');
      await expect(readiness).toContainText('Website and provider approval · Manual check required');
      await expect(payment.getByRole('button', { name: 'Review publication', exact: true })).toHaveCount(0);
      readinessFails = true;
      await payment.getByRole('button', { name: 'Check sandbox readiness', exact: true }).click();
      await expect(payment).toContainText('The application could not inspect payments.');
      await expect(readiness).toHaveCount(0);
      readinessFails = false;
      await payment.getByRole('button', { name: 'Check sandbox readiness', exact: true }).click();
      await expect(readiness).toBeVisible();
      expect(publications).toBe(0);
      await payment.getByRole('button', { name: 'Preview sandbox catalogue', exact: true }).click();
      await payment.getByRole('button', { name: 'Review publication', exact: true }).click();
      const confirmation = page.getByRole('dialog');
      await expect(confirmation).toContainText('acct_fixture');
      await expect(confirmation).toContainText('sandbox');
      await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
      expect(publications).toBe(0);
      await payment.getByRole('button', { name: 'Review publication', exact: true }).click();
      await confirmation.getByRole('button', { name: 'Publish catalogue', exact: true }).click();
      await expect(payment).toContainText('No product or price changes are needed.');
      expect(publications).toBe(1);
      pendingRecovery = true;
      await payment.getByRole('button', { name: 'Preview sandbox catalogue', exact: true }).click();
      const recovery = payment.getByRole('region', { name: 'Recover catalogue operation', exact: true });
      await expect(recovery).toBeVisible();
      await recovery.getByRole('textbox', { name: 'Existing provider object ID', exact: true }).fill('price_recovered');
      await recovery.getByRole('button', { name: 'Review recovery', exact: true }).click();
      await expect(confirmation).toContainText('acct_fixture');
      await expect(confirmation).toContainText('sandbox');
      await expect(confirmation).toContainText('price_recovered');
      await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
      expect(recoveries).toBe(0);
      await recovery.getByRole('button', { name: 'Review recovery', exact: true }).click();
      await confirmation.getByRole('button', { name: 'Recover mapping', exact: true }).click();
      await expect(recovery).toHaveCount(0);
      expect(recoveries).toBe(1);
      expect(publications).toBe(1);
      await payment.getByRole('button', { name: 'Prepare payment implementation request', exact: true }).click();
      const composer = page.getByLabel('Message AI assistant');
      await expect(composer).toBeVisible();
      const draft = await composer.inputValue();
      const { connectorDefinitions } = await import('@jskit-ai/connectors-catalog/shared');
      const stripeSetup = connectorDefinitions.find((provider) => provider.id === 'stripe')!.setup;
      expect(draft).toContain(stripeSetup.steps.join('\n\n'));
      expect(draft).toContain(stripeSetup.url);
      const stripePayments = connectorDefinitions.find((provider) => provider.id === 'stripe')!.paymentSetup;
      expect(draft).toContain(stripePayments.steps.join('\n\n'));
      expect(draft).toContain(stripePayments.url);
      expect(draft).toContain('extensions.payments');
      expect(draft).toContain('payments-publish');
      expect(draft).toContain(await readFile(path.join(process.cwd(), 'packages/vibe64-source-editor/docs/application-integration-setup.md'), 'utf8'));
      expect(draft).toContain(await readFile(path.join(process.cwd(), 'packages/vibe64-source-editor/docs/application-payments-laravel.md'), 'utf8'));
      const require = createRequire(import.meta.url);
      for (const document of ['configuration.schema.json', 'conformance.json']) {
        const contents = JSON.parse(await readFile(require.resolve(`@jskit-ai/payments-core/${document}`), 'utf8'));
        expect(draft).toContain(JSON.stringify(contents, null, 2));
      }
      for (const document of ['contract.md', 'conformance.md']) {
        expect(draft).toContain(await readFile(require.resolve(`@jskit-ai/payments-core/docs/${document}`), 'utf8'));
      }
      expect(publications).toBe(1);
      await composer.fill('');
      await panel.getByRole('textbox', { name: 'Search integrations', exact: true }).fill('Paddle');
      await panel.getByRole('button', { name: 'Add Paddle', exact: true }).click();
      await panel.getByRole('button', { name: 'Set up Paddle', exact: true }).click();
      await expect(panel).toContainText('customer_portal_session.write');
      await expect(panel).toContainText('A successful product check does not verify these additional permissions');
      await panel.getByRole('textbox', { name: 'API key reference', exact: true }).fill('env:PADDLE_API_KEY');
      await payment.getByRole('combobox', { name: 'Payment connection', exact: true }).press('Enter');
      await page.getByRole('option', { name: 'Paddle (paddle)', exact: true }).click();
      await payment.getByRole('textbox', { name: 'Provider account identity', exact: true }).fill('paddle_fixture');
      await expect(payment).toContainText('Choose the Paddle tax category for the products this app sells');
      await expect(payment).toContainText("Set the Env reference for this environment's Paddle public client token");
      await payment.getByRole('combobox', { name: 'Paddle product tax category', exact: true }).press('Enter');
      await page.getByRole('option', { name: 'saas', exact: true }).click();
      await payment.getByRole('textbox', { name: 'Paddle public client token Env reference', exact: true }).fill('env:PADDLE_CLIENT_TOKEN');
      await panel.getByRole('button', { name: 'Save configuration', exact: true }).click();
      await expect(panel.getByRole('button', { name: 'Save configuration', exact: true })).toBeDisabled();
      await page.reload();
      await expect(payment.getByRole('textbox', { name: 'Paddle public client token Env reference', exact: true })).toHaveValue('env:PADDLE_CLIENT_TOKEN');
      await payment.getByRole('button', { name: 'Set up payment events and checkout', exact: true }).click();
      await expect(payment).toContainText('Client-side tokens');
      await expect(payment).toContainText('transaction.completed');
      await expect(payment).toContainText('live domain approval');
      const writes: unknown[] = [];
      await routeApiEndpoint(page, '/vibe64/env', (route) => fulfillJson(route, { ok: true, env: { environment: 'dev', records: [], unavailable: null } }));
      await routeApiEndpoint(page, '/vibe64/env/user-values', async (route) => {
        writes.push(route.request().postDataJSON());
        await fulfillJson(route, { ok: true, env: { environment: 'dev', records: [], unavailable: null } });
      });
      for (const [button, key, secret, value] of [
        ['Set public client token in Env', 'PADDLE_CLIENT_TOKEN', false, 'test_fixture_public_token'],
        ['Set signing secret in Env', 'PAYMENT_SANDBOX_WEBHOOK_SECRET', true, 'fixture_private_signing_secret']
      ] as const) {
        await payment.getByRole('button', { name: button, exact: true }).click();
        const env = page.locator('.env-panel');
        await expect(env.getByRole('textbox', { name: 'Key', exact: true })).toHaveValue(key);
        await expect(env.getByRole('checkbox', { name: 'Secret', exact: true })).toBeChecked({ checked: secret });
        await expect(env.getByLabel('Value', { exact: true })).toHaveAttribute('type', secret ? 'password' : 'text');
        await env.getByLabel('Value', { exact: true }).fill(value);
        await env.getByRole('button', { name: 'Add', exact: true }).click();
        await expect.poll(() => writes.length).toBe(secret ? 2 : 1);
        expect(writes.at(-1)).toMatchObject({ environment: 'dev', sessionId: directChatSessionId, values: { [key]: { value, secret } } });
        expect(page.url()).not.toContain(value);
        expect(await readFile(path.join(source, 'integrations.json'), 'utf8')).not.toContain(value);
        await page.goBack();
        await expect(payment.getByRole('textbox', { name: 'Provider account identity', exact: true })).toHaveValue('paddle_fixture');
        await expect(panel.getByRole('heading', { name: 'Integrations', exact: true })).toHaveCount(1);
      }
      const paddleSaved = JSON.parse(await readFile(path.join(source, 'integrations.json'), 'utf8'));
      expect(paddleSaved.extensions.payments.environments.sandbox).toMatchObject({ integrationId: 'paddle', taxCategory: 'saas', publicClientTokenRef: 'env:PADDLE_CLIENT_TOKEN' });
      expect(paddleSaved.integrations.paddle.settings.environment).toBe('sandbox');
      await payment.getByRole('button', { name: 'Prepare payment implementation request', exact: true }).click();
      const paddleDraft = await composer.inputValue();
      const paddleSetup = connectorDefinitions.find((provider) => provider.id === 'paddle')!.setup;
      expect(paddleDraft).toContain(paddleSetup.steps.join('\n\n'));
      expect(paddleDraft).toContain(paddleSetup.url);
      const paddlePayments = connectorDefinitions.find((provider) => provider.id === 'paddle')!.paymentSetup;
      expect(paddleDraft).toContain(paddlePayments.steps.join('\n\n'));
      expect(paddleDraft).toContain(paddlePayments.url);
      expect(paddleDraft).not.toContain('fixture_private_signing_secret');
      expect(paddleDraft).not.toContain('test_fixture_public_token');
      await composer.fill('');
      expect(publications).toBe(1);
      const billingHistory = payment.getByRole('region', { name: 'Billing history', exact: true });
      await billingHistory.getByRole('textbox', { name: 'Application billing account ID', exact: true }).fill('tenant-a');
      await billingHistory.getByRole('button', { name: 'View sandbox billing history', exact: true }).click();
      await expect(billingHistory).toContainText('txn_1');
      await expect(billingHistory).toContainText('Paid: Unknown');
      await billingHistory.getByRole('textbox', { name: 'Application billing account ID', exact: true }).fill('tenant-b');
      await expect(billingHistory).not.toContainText('txn_1');
      await billingHistory.getByRole('textbox', { name: 'Application billing account ID', exact: true }).fill('tenant-a');
      await billingHistory.getByRole('button', { name: 'Next billing page', exact: true }).click();
      await expect(billingHistory).toContainText('No billing records found');
      expect(historyRequests).toHaveLength(2);
      expect(historyRequests[1]).toMatchObject({ after: 'txn_1' });
      historyFails = true;
      await billingHistory.getByRole('button', { name: 'View sandbox billing history', exact: true }).click();
      await expect(billingHistory).toContainText('Billing history could not load');
      await expect(billingHistory).not.toContainText('txn_1');
      historyFails = false;
      await billingHistory.getByRole('button', { name: 'View sandbox billing history', exact: true }).click();
      await expect(billingHistory).toContainText('txn_1');

      expect(publications).toBe(1);
      for (const [width, height] of [[1440, 1000], [1024, 1000], [768, 1000], [390, 1000], [1440, 500]]) {
        await billingHistory.getByRole('textbox', { name: 'Application billing account ID', exact: true }).focus();
        await page.setViewportSize({width,height});
        const projectHidden = await showProject.isVisible();
        if (projectHidden) await showProject.click();
        await expect(billingHistory.getByRole('textbox', { name: 'Application billing account ID', exact: true })).toHaveValue('tenant-a');
        await expect(billingHistory).toContainText('txn_1');
        if (!projectHidden) await expect(billingHistory.getByRole('textbox', { name: 'Application billing account ID', exact: true })).toBeFocused();
        await payment.getByRole('textbox',{name:'Provider account identity',exact:true}).scrollIntoViewIfNeeded();
        await expect(payment.getByRole('textbox',{name:'Provider account identity',exact:true})).toBeVisible();
        await page.screenshot({path:`/tmp/payments-${width}.png`});
        await billingHistory.screenshot({path:`/tmp/payment-history-${width}.png`});
        expect(await billingHistory.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
        expect(await payment.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
      }
      const setupSection = payment.getByRole('button', { name: 'Set up payment events and checkout', exact: true });
      if (await setupSection.getAttribute('aria-expanded') !== 'true') await setupSection.click();
      const draftName = payment.getByRole('textbox', { name: 'Plan name', exact: true });
      const amount = payment.getByRole('spinbutton', { name: 'Amount in smallest currency unit', exact: true });
      await draftName.fill('Unsaved responsive plan');
      await amount.fill('0');
      for (const [width, height] of [[390, 1000], [768, 1000], [1024, 1000], [1440, 1000], [1440, 500]]) {
        await draftName.focus();
        await page.setViewportSize({ width, height });
        const projectHidden = await showProject.isVisible();
        if (projectHidden) await showProject.click();
        await expect(draftName).toHaveValue('Unsaved responsive plan');
        await expect(amount).toHaveValue('0');
        await expect(amount).toHaveAccessibleDescription(/must be >= 1/);
        await expect(payment).toContainText('must be >= 1');
        await expect(setupSection).toHaveAttribute('aria-expanded', 'true');
        await expect(panel.getByRole('heading', { name: 'Integrations', exact: true })).toHaveCount(1);
        if (!projectHidden) await expect(draftName).toBeFocused();
      }
      expect(JSON.parse(await readFile(path.join(source, 'integrations.json'), 'utf8')).extensions.payments.plans.pro.name).not.toBe('Unsaved responsive plan');
      expect(errors).toEqual([]);
    } finally { service.close(); await rm(root,{recursive:true,force:true}); }
});
