/**
 * Accounts, ownership, plan limits and the Stripe webhook, exercised through
 * the real route handlers. Runs against file storage, and additionally against
 * PostgreSQL when TEST_DATABASE_URL is set.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Pool } from 'pg';

const BASE = 'http://studio.test';

class Client {
  cookie = '';
  async call(handler: (req: Request, ctx?: never) => Promise<Response>, url: string, init: { method?: string; body?: unknown; ctx?: unknown; headers?: Record<string, string> } = {}) {
    const req = new Request(BASE + url, {
      method: init.method ?? 'GET',
      headers: { 'content-type': 'application/json', host: 'studio.test', ...(this.cookie ? { cookie: this.cookie } : {}), ...(init.headers ?? {}) },
      body: init.body === undefined ? undefined : typeof init.body === 'string' ? init.body : JSON.stringify(init.body),
    });
    const res = await (handler as (r: Request, c: unknown) => Promise<Response>)(req, init.ctx);
    const set = res.headers.get('set-cookie');
    if (set) {
      const m = /a3d_session=([^;]*)/.exec(set);
      if (m) this.cookie = m[1] ? `a3d_session=${m[1]}` : '';
    }
    const text = await res.text();
    let data: any = text;
    try {
      data = JSON.parse(text);
    } catch {
      /* not JSON */
    }
    return { status: res.status, data, headers: res.headers };
  }
}

const params = <T,>(p: T) => ({ params: Promise.resolve(p) });

const backends: { name: string; url?: string }[] = [{ name: 'file' }];
if (process.env.TEST_DATABASE_URL) backends.push({ name: 'postgres', url: process.env.TEST_DATABASE_URL });

for (const backend of backends) {
  describe(`accounts & billing (${backend.name})`, () => {
    let routes: Record<string, any>;

    beforeAll(async () => {
      vi.resetModules();
      delete (globalThis as { __ai3dRepo?: unknown }).__ai3dRepo;
      vi.stubEnv('DATA_DIR', mkdtempSync(path.join(tmpdir(), 'ai3d-acc-')));
      vi.stubEnv('AI_PROVIDER', 'none');
      vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_x');
      vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_test');
      vi.stubEnv('STRIPE_PRICE_PRO_MONTHLY', 'price_pro_m');
      vi.stubEnv('STRIPE_PRICE_STUDIO_YEARLY', 'price_studio_y');
      vi.stubEnv('ADMIN_EMAILS', 'boss@studio.test');
      if (backend.url) {
        const pool = new Pool({ connectionString: backend.url });
        await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
        await pool.end();
        vi.stubEnv('DATABASE_URL', backend.url);
      } else vi.stubEnv('DATABASE_URL', '');
      routes = {
        signup: await import('@/app/api/auth/signup/route'),
        login: await import('@/app/api/auth/login/route'),
        logout: await import('@/app/api/auth/logout/route'),
        me: await import('@/app/api/auth/me/route'),
        projects: await import('@/app/api/projects/route'),
        project: await import('@/app/api/projects/[id]/route'),
        exportRoute: await import('@/app/api/projects/[id]/export/route'),
        share: await import('@/app/api/projects/[id]/share/route'),
        shared: await import('@/app/api/share/[token]/route'),
        command: await import('@/app/api/ai/command/route'),
        webhook: await import('@/app/api/billing/webhook/route'),
        storage: await import('@/server/storage'),
        auth: await import('@/server/auth'),
      };
    });

    afterAll(() => {
      vi.unstubAllEnvs();
      delete (globalThis as { __ai3dRepo?: unknown }).__ai3dRepo;
    });

    it('requires a session for app APIs', async () => {
      const anon = new Client();
      expect((await anon.call(routes.projects.GET, '/api/projects')).status).toBe(401);
      expect((await anon.call(routes.projects.POST, '/api/projects', { method: 'POST', body: { name: 'x' } })).status).toBe(401);
      expect((await anon.call(routes.me.GET, '/api/auth/me')).data.user).toBeNull();
    });

    it('signs up, keeps projects private, and enforces Free limits', async () => {
      // A project from before accounts existed is claimed by the first account.
      const legacy = await routes.storage.getRepository().createProject({ name: 'Legacy', scene: (await import('@/core/schema/scene')).emptyScene() });

      const alice = new Client();
      const s = await alice.call(routes.signup.POST, '/api/auth/signup', { method: 'POST', body: { name: 'Alice', email: 'Alice@Example.com ', password: 'correct horse' } });
      expect(s.status).toBe(201);
      expect(s.data.user.email).toBe('alice@example.com');
      expect(s.data.user.plan).toBe('free');
      expect(alice.cookie).toMatch(/^a3d_session=/);
      expect(s.headers.get('set-cookie')).toMatch(/HttpOnly/i);

      const dup = await new Client().call(routes.signup.POST, '/api/auth/signup', { method: 'POST', body: { name: 'A', email: 'alice@example.com', password: 'whatever123' } });
      expect(dup.status).toBe(409);

      const list = await alice.call(routes.projects.GET, '/api/projects');
      expect(list.data.projects.map((p: { id: string }) => p.id)).toEqual([legacy.id]);

      // Free: 3 projects (the legacy one counts).
      for (let i = 0; i < 2; i++) expect((await alice.call(routes.projects.POST, '/api/projects', { method: 'POST', body: { name: `P${i}` } })).status).toBe(201);
      const over = await alice.call(routes.projects.POST, '/api/projects', { method: 'POST', body: { name: 'P3' } });
      expect(over.status).toBe(402);
      expect(over.data.error).toMatch(/3 projects/);

      // Bob cannot see or touch Alice's project.
      const bob = new Client();
      await bob.call(routes.signup.POST, '/api/auth/signup', { method: 'POST', body: { name: 'Bob', email: 'bob@example.com', password: 'hunter2hunter2' } });
      expect((await bob.call(routes.projects.GET, '/api/projects')).data.projects).toEqual([]);
      expect((await bob.call(routes.project.GET, `/api/projects/${legacy.id}`, { ctx: params({ id: legacy.id }) })).status).toBe(404);
      expect((await bob.call(routes.project.DELETE, `/api/projects/${legacy.id}`, { method: 'DELETE', ctx: params({ id: legacy.id }) })).status).toBe(404);
      expect((await alice.call(routes.project.GET, `/api/projects/${legacy.id}`, { ctx: params({ id: legacy.id }) })).status).toBe(200);

      // Export formats by plan.
      const ifc = await alice.call(routes.exportRoute.GET, `/api/projects/${legacy.id}/export?format=ifc`, { ctx: params({ id: legacy.id }) });
      expect(ifc.status).toBe(402);
      const stl = await alice.call(routes.exportRoute.GET, `/api/projects/${legacy.id}/export?format=stl`, { ctx: params({ id: legacy.id }) });
      expect(stl.status).toBe(200);

      // Share links stay public.
      const sh = await alice.call(routes.share.POST, `/api/projects/${legacy.id}/share`, { method: 'POST', ctx: params({ id: legacy.id }) });
      expect((await new Client().call(routes.shared.GET, `/api/share/${sh.data.token}`, { ctx: params({ token: sh.data.token }) })).data.project.name).toBe('Legacy');
    });

    it('logs in and out, rejects wrong passwords and cross-site requests', async () => {
      const c = new Client();
      expect((await c.call(routes.login.POST, '/api/auth/login', { method: 'POST', body: { email: 'alice@example.com', password: 'nope' } })).status).toBe(401);
      expect((await c.call(routes.login.POST, '/api/auth/login', { method: 'POST', body: { email: 'alice@example.com', password: 'correct horse' }, headers: { origin: 'https://evil.example' } })).status).toBe(403);
      const ok = await c.call(routes.login.POST, '/api/auth/login', { method: 'POST', body: { email: 'ALICE@example.com', password: 'correct horse' } });
      expect(ok.status).toBe(200);
      const me = await c.call(routes.me.GET, '/api/auth/me');
      expect(me.data.user.name).toBe('Alice');
      expect(me.data.usage).toMatchObject({ projects: 3, projectLimit: 3, aiLimit: 40 });
      const session = c.cookie;
      await c.call(routes.logout.POST, '/api/auth/logout', { method: 'POST' });
      const replay = new Client();
      replay.cookie = session;
      expect((await replay.call(routes.me.GET, '/api/auth/me')).data.user).toBeNull();
    });

    it('enforces the monthly AI quota', async () => {
      const repo = routes.storage.getRepository();
      const user = await repo.getUserByEmail('bob@example.com');
      const { usagePeriod } = await import('@/core/billing/plans');
      await repo.incrementUsage(user.id, usagePeriod(), 'ai', 39);
      await routes.auth.consumeAiRequest(user);
      await expect(routes.auth.consumeAiRequest(user)).rejects.toMatchObject({ status: 402 });
      expect((await repo.getUsage(user.id, usagePeriod())).ai).toBe(40);
    });

    it('upgrades and downgrades via signed Stripe webhooks', async () => {
      const repo = routes.storage.getRepository();
      const alice = await repo.getUserByEmail('alice@example.com');
      await repo.updateUser(alice.id, { stripeCustomerId: 'cus_123' });
      const send = (event: unknown, secret = 'whsec_test') => {
        const payload = JSON.stringify(event);
        const t = Math.floor(Date.now() / 1000);
        const sig = createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex');
        return new Client().call(routes.webhook.POST, '/api/billing/webhook', { method: 'POST', body: payload, headers: { 'stripe-signature': `t=${t},v1=${sig}` } });
      };
      const sub = (status: string, price: string) => ({
        type: 'customer.subscription.updated',
        data: { object: { id: 'sub_1', customer: 'cus_123', status, items: { data: [{ price: { id: price }, current_period_end: 1893456000 }] } } },
      });

      expect((await send(sub('active', 'price_pro_m'), 'whsec_wrong')).status).toBe(400);
      expect((await repo.getUserById(alice.id)).plan).toBe('free');

      expect((await send(sub('active', 'price_pro_m'))).status).toBe(200);
      let u = await repo.getUserById(alice.id);
      expect(u).toMatchObject({ plan: 'pro', planStatus: 'active', stripeSubscriptionId: 'sub_1' });
      expect(u.currentPeriodEnd).toBe(new Date(1893456000 * 1000).toISOString());

      // Pro lifts the project limit and allows IFC.
      const c = new Client();
      await c.call(routes.login.POST, '/api/auth/login', { method: 'POST', body: { email: 'alice@example.com', password: 'correct horse' } });
      expect((await c.call(routes.projects.POST, '/api/projects', { method: 'POST', body: { name: 'P4' } })).status).toBe(201);

      await send(sub('active', 'price_studio_y'));
      expect((await repo.getUserById(alice.id)).plan).toBe('studio');

      await send({ ...sub('canceled', 'price_studio_y'), type: 'customer.subscription.deleted' });
      u = await repo.getUserById(alice.id);
      expect(u).toMatchObject({ plan: 'free', planStatus: 'canceled', stripeSubscriptionId: null });
    });

    it('deletes an account with everything in it', async () => {
      const c = new Client();
      await c.call(routes.signup.POST, '/api/auth/signup', { method: 'POST', body: { name: 'Temp', email: 'temp@example.com', password: 'temporary1' } });
      const created = await c.call(routes.projects.POST, '/api/projects', { method: 'POST', body: { name: 'Doomed' } });
      expect(created.status).toBe(201);
      expect((await c.call(routes.me.DELETE, '/api/auth/me', { method: 'DELETE', body: { password: 'wrong-one' } })).status).toBe(401);
      expect((await c.call(routes.me.DELETE, '/api/auth/me', { method: 'DELETE', body: { password: 'temporary1' } })).status).toBe(200);
      const repo = routes.storage.getRepository();
      expect(await repo.getUserByEmail('temp@example.com')).toBeNull();
      expect(await repo.getProject(created.data.project.id)).toBeNull();
      expect((await c.call(routes.me.GET, '/api/auth/me')).data.user).toBeNull();
    });

    it('gives admins the Studio plan', async () => {
      const c = new Client();
      const s = await c.call(routes.signup.POST, '/api/auth/signup', { method: 'POST', body: { name: 'Boss', email: 'boss@studio.test', password: 'adminadmin' } });
      expect(s.data.user.plan).toBe('studio');
    });
  });
}
