'use strict';

/** Session lifecycle: login, refresh rotation with grace and reuse detection, logout, invites. */

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { app, request, prisma, bearer, login, refreshCookie, teardown } = require('./helpers');

const INVITEE = `invitee+${Date.now()}@example.com`;

after(async () => {
  await prisma.user.deleteMany({ where: { email: INVITEE } });
  await prisma.invitation.deleteMany({ where: { email: INVITEE } });
  await teardown();
});

const refresh = (cookie, csrf = true) => {
  const req = request(app).post('/api/auth/refresh').set('Cookie', cookie);
  return csrf ? req.set('X-Requested-With', 'XMLHttpRequest') : req;
};

test('login sets an httpOnly refresh cookie scoped to /api/auth', async () => {
  const res = await request(app).post('/api/auth/login')
    .send({ email: 'SARAH@leadpulse.dev', password: 'password123' }).expect(200);
  assert.ok(res.body.accessToken);
  assert.equal(res.body.user.email, 'sarah@leadpulse.dev');
  assert.equal(res.body.user.passwordHash, undefined);
  const cookie = res.headers['set-cookie'].find((c) => c.startsWith('lp_rt='));
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /Path=\/api\/auth/);
  assert.match(cookie, /SameSite=Lax/i);
});

test('bad credentials are 401 and malformed input is 422', async () => {
  const bad = await request(app).post('/api/auth/login').send({ email: 'sarah@leadpulse.dev', password: 'nope' }).expect(401);
  assert.equal(bad.body.code, 'INVALID_CREDENTIALS');
  const unknown = await request(app).post('/api/auth/login').send({ email: 'ghost@leadpulse.dev', password: 'nope' }).expect(401);
  assert.equal(unknown.body.error, bad.body.error);
  const invalid = await request(app).post('/api/auth/login').send({ email: 'not-an-email' }).expect(422);
  assert.equal(invalid.body.code, 'VALIDATION_ERROR');
  assert.ok(Array.isArray(invalid.body.details));
});

test('refresh requires the X-Requested-With header', async () => {
  const { cookie } = await login('sarah@leadpulse.dev');
  const res = await refresh(cookie, false).expect(403);
  assert.equal(res.body.code, 'CSRF_HEADER_REQUIRED');
});

test('refresh rotates, tolerates a parallel reuse within the grace window, and revokes the family after it', async () => {
  const { cookie: first } = await login('sarah@leadpulse.dev');

  const rotated = await refresh(first).expect(200);
  const second = refreshCookie(rotated);
  assert.ok(rotated.body.accessToken);
  assert.ok(second && second !== first, 'a new refresh cookie is issued');

  // Another tab still holding the old cookie, inside 30 s: allowed, no second rotation.
  const grace = await refresh(first).expect(200);
  assert.equal(refreshCookie(grace), null);

  // Same old cookie long after rotation = token theft signal.
  const hash = require('../../src/services/session.service').sha256(decodeURIComponent(first.slice('lp_rt='.length)));
  await prisma.refreshToken.update({ where: { tokenHash: hash }, data: { rotatedAt: new Date(Date.now() - 60_000) } });
  const reused = await refresh(first).expect(401);
  assert.equal(reused.body.code, 'SESSION_REUSED');

  // The whole family is revoked, including the newest token.
  await refresh(second).expect(401);
});

test('two tabs refreshing at the same moment both stay signed in', async () => {
  const { cookie } = await login('sarah@leadpulse.dev');
  const [a, b] = await Promise.all([refresh(cookie), refresh(cookie)]);
  assert.deepEqual([a.status, b.status], [200, 200]);
  const issued = [refreshCookie(a), refreshCookie(b)].filter(Boolean);
  assert.equal(issued.length, 1, 'exactly one request rotates the token');
  await refresh(issued[0]).expect(200);
});

test('access tokens keep working until expiry and the API rejects garbage tokens', async () => {
  const { token } = await login('sarah@leadpulse.dev');
  await request(app).get('/api/auth/me').set(bearer(token)).expect(200);
  const res = await request(app).get('/api/auth/me').set(bearer('nope')).expect(401);
  assert.equal(res.body.code, 'INVALID_TOKEN');
});

test('logout revokes the refresh token', async () => {
  const { cookie } = await login('sarah@leadpulse.dev');
  await request(app).post('/api/auth/logout').set('Cookie', cookie).expect(204);
  await refresh(cookie).expect(401);
});

test('self-registration is invite-only by default', async () => {
  const saved = process.env.ALLOW_SIGNUP;
  delete process.env.ALLOW_SIGNUP;
  try {
    const res = await request(app).post('/api/auth/register')
      .send({ email: INVITEE, password: 'Password123', firstName: 'In', lastName: 'Vitee' }).expect(403);
    assert.equal(res.body.code, 'REGISTRATION_CLOSED');
  } finally {
    if (saved !== undefined) process.env.ALLOW_SIGNUP = saved;
  }
});

test('invite → accept → deactivate', async () => {
  const admin = await login('admin@leadpulse.dev');

  const created = await request(app).post('/api/users/invite').set(bearer(admin.token))
    .send({ email: INVITEE, role: 'SALES_REP' }).expect(201);
  const token = new URL(created.body.inviteUrl).searchParams.get('token');
  assert.ok(token);

  const lookup = await request(app).get(`/api/auth/invite/${token}`).expect(200);
  assert.equal(lookup.body.invitation.email, INVITEE);

  const accepted = await request(app).post('/api/auth/accept-invite')
    .send({ token, firstName: 'In', lastName: 'Vitee', password: 'Password123' }).expect(201);
  assert.equal(accepted.body.user.role, 'SALES_REP');
  const inviteeCookie = refreshCookie(accepted);

  // Single use.
  await request(app).get(`/api/auth/invite/${token}`).expect(404);
  await request(app).post('/api/auth/accept-invite')
    .send({ token, firstName: 'In', lastName: 'Vitee', password: 'Password123' }).expect(404);

  // Deactivation locks the account out immediately and ends its sessions.
  await request(app).patch(`/api/users/${accepted.body.user.id}`).set(bearer(admin.token))
    .send({ isActive: false }).expect(200);
  const blocked = await request(app).get('/api/auth/me').set(bearer(accepted.body.accessToken)).expect(403);
  assert.equal(blocked.body.code, 'ACCOUNT_DISABLED');
  await refresh(inviteeCookie).expect(401);
});

test('admins cannot lock themselves out', async () => {
  const admin = await login('admin@leadpulse.dev');
  await request(app).patch(`/api/users/${admin.user.id}`).set(bearer(admin.token)).send({ isActive: false }).expect(400);
  await request(app).patch(`/api/users/${admin.user.id}`).set(bearer(admin.token)).send({ role: 'SALES_REP' }).expect(400);
  await request(app).patch(`/api/users/${admin.user.id}`).set(bearer(admin.token)).send({ role: 'SUPERUSER' }).expect(422);
});
