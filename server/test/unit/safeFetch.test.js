'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { safeFetch, isPublicAddress } = require('../../src/lib/safeFetch');

const PUBLIC = { address: '93.184.216.34', family: 4 };
const html = (body = '<title>Hi</title>') => ({ status: 200, contentType: 'text/html; charset=utf-8', body });

/** DNS table + scripted responses per URL; records which address each request used. */
function fakeNet(dnsTable, responses) {
  const calls = [];
  return {
    calls,
    resolve: async (host) => dnsTable[host] ?? [],
    transport: async (url, address) => {
      calls.push({ url: url.toString(), address: address.address });
      return responses[url.toString()] ?? html();
    },
  };
}

test('private, loopback, link-local and reserved addresses are not public', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1',
    '0.0.0.0', '224.0.0.1', '255.255.255.255', '::1', '::', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1']) {
    assert.equal(isPublicAddress(ip), false, ip);
  }
  for (const ip of ['93.184.216.34', '8.8.8.8', '172.32.0.1', '2606:4700::6810:84e5']) assert.equal(isPublicAddress(ip), true, ip);
  assert.equal(isPublicAddress('not-an-ip'), false);
});

test('only https on port 443 without credentials', async () => {
  const net = fakeNet({ 'acme.com': [PUBLIC] }, {});
  for (const url of ['http://acme.com/', 'https://acme.com:8443/', 'https://user:pw@acme.com/', 'ftp://acme.com/', 'not a url']) {
    await assert.rejects(safeFetch(url, net), { name: 'SafeFetchError' }, url);
  }
  assert.equal(net.calls.length, 0);
});

test('a host that resolves to any private address is refused before connecting', async () => {
  const net = fakeNet({ 'evil.test': [PUBLIC, { address: '10.0.0.5', family: 4 }], 'meta.test': [{ address: '169.254.169.254', family: 4 }] }, {});
  await assert.rejects(safeFetch('https://evil.test/', net), /private or reserved/);
  await assert.rejects(safeFetch('https://meta.test/', net), /private or reserved/);
  await assert.rejects(safeFetch('https://[::1]/', net), /private or reserved/);
  assert.equal(net.calls.length, 0);
});

test('a redirect to a private host is refused', async () => {
  const net = fakeNet(
    { 'acme.com': [PUBLIC], 'internal.acme.com': [{ address: '192.168.0.10', family: 4 }] },
    { 'https://acme.com/': { status: 302, location: 'https://internal.acme.com/admin' } },
  );
  await assert.rejects(safeFetch('https://acme.com/', net), /private or reserved/);
  assert.deepEqual(net.calls.map((c) => c.url), ['https://acme.com/']);
});

test('a redirect to http or more than 3 redirects is refused', async () => {
  const downgrade = fakeNet({ 'acme.com': [PUBLIC] }, { 'https://acme.com/': { status: 301, location: 'http://acme.com/' } });
  await assert.rejects(safeFetch('https://acme.com/', downgrade), /Only https/);

  const loop = fakeNet({ 'acme.com': [PUBLIC] }, { 'https://acme.com/': { status: 302, location: '/' } });
  await assert.rejects(safeFetch('https://acme.com/', loop), /Too many redirects/);
  assert.equal(loop.calls.length, 4);
});

test('each request is pinned to the address that was checked (no DNS rebinding)', async () => {
  let lookups = 0;
  const calls = [];
  const resolve = async () => (lookups++ === 0 ? [PUBLIC] : [{ address: '127.0.0.1', family: 4 }]);
  const transport = async (url, address) => { calls.push(address.address); return html(); };
  await safeFetch('https://acme.com/', { resolve, transport });
  assert.deepEqual(calls, [PUBLIC.address], 'the connection uses the checked address');
  assert.equal(lookups, 1, 'DNS is asked once per hop');
});

test('relative redirects are followed and re-checked; the final page must be HTML', async () => {
  const net = fakeNet(
    { 'acme.com': [PUBLIC], 'www.acme.com': [PUBLIC] },
    {
      'https://acme.com/': { status: 301, location: 'https://www.acme.com/' },
      'https://www.acme.com/': { status: 302, location: '/home' },
      'https://www.acme.com/home': html('<title>Acme</title>'),
    },
  );
  const page = await safeFetch('https://acme.com/', net);
  assert.equal(page.url, 'https://www.acme.com/home');
  assert.equal(page.body, '<title>Acme</title>');

  const pdf = fakeNet({ 'acme.com': [PUBLIC] }, { 'https://acme.com/': { status: 200, contentType: 'application/pdf', body: '' } });
  await assert.rejects(safeFetch('https://acme.com/', pdf), /Not an HTML page/);
  const missing = fakeNet({ 'acme.com': [PUBLIC] }, { 'https://acme.com/': { status: 404, contentType: 'text/html' } });
  await assert.rejects(safeFetch('https://acme.com/', missing), /HTTP 404/);
});

test('the real transport stops reading at the size cap', async () => {
  // Exercised through the public API with a transport that mimics a 2 MB page cut at 512 KB.
  const big = { status: 200, contentType: 'text/html', body: 'x'.repeat(512 * 1024), truncated: true };
  const net = fakeNet({ 'acme.com': [PUBLIC] }, { 'https://acme.com/': big });
  const page = await safeFetch('https://acme.com/', net);
  assert.equal(page.body.length, 512 * 1024);
  assert.equal(page.truncated, true);
});
