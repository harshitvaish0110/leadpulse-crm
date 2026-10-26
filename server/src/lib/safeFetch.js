/**
 * LeadPulse — Fetches untrusted public URLs without SSRF.
 *
 *  - HTTPS on port 443 only; no credentials in the URL.
 *  - The hostname is resolved here and every address is checked against
 *    private and reserved ranges (loopback, RFC 1918, link-local and cloud
 *    metadata, CGNAT, multicast, IPv6 ULA/link-local; IPv4-mapped IPv6 addresses
 *    are checked against the IPv4 ranges).
 *  - The connection goes to the address that was checked, so a second DNS
 *    answer (DNS rebinding) can't point it elsewhere. TLS still verifies the
 *    certificate against the hostname.
 *  - Redirects are followed by hand, at most 3, each one checked again.
 *  - 5 s for the whole fetch, 512 KB body cap, text/html only.
 *
 * safePost() sends webhooks with the same address checks and pinning, never
 * follows redirects and only reads the status. With `allowPrivate` (set by
 * WEBHOOK_ALLOW_PRIVATE outside production) it also accepts http and private
 * addresses, for a test receiver on the developer's machine.
 */

'use strict';

const dns = require('node:dns').promises;
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');

class SafeFetchError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SafeFetchError';
  }
}

const BLOCKED = new net.BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
]) BLOCKED.addSubnet(address, prefix, 'ipv4');
for (const [address, prefix] of [
  // No ::ffff:0:0/96 entry: BlockList already checks IPv4-mapped addresses against the IPv4 rules,
  // and that entry would match every IPv4 address.
  ['::', 128], ['::1', 128], ['64:ff9b::', 96], ['100::', 64], ['2001:db8::', 32],
  ['fc00::', 7], ['fe80::', 10], ['ff00::', 8],
]) BLOCKED.addSubnet(address, prefix, 'ipv6');

/** True only for a syntactically valid, publicly routable IP address. */
function isPublicAddress(ip) {
  const family = net.isIP(ip);
  if (!family) return false;
  return !BLOCKED.check(ip, family === 4 ? 'ipv4' : 'ipv6');
}

function checkUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new SafeFetchError('Invalid URL');
  }
  if (url.protocol !== 'https:') throw new SafeFetchError('Only https URLs are allowed');
  if (url.port && url.port !== '443') throw new SafeFetchError('Only port 443 is allowed');
  if (url.username || url.password) throw new SafeFetchError('Credentials in URLs are not allowed');
  return url;
}

/** Connects to the address that was checked, whatever DNS says now. */
const pinned = (address) => (_host, options, cb) => (options?.all
  ? cb(null, [{ address: address.address, family: address.family }])
  : cb(null, address.address, address.family));

/** Every address of `hostname`. */
const resolveHost = (hostname) => dns.lookup(hostname, { all: true, verbatim: true });

/** An IP literal (`[::1]`, `10.0.0.1`) is its own address; anything else goes to DNS. */
async function addressesOf(hostname, resolve) {
  const host = hostname.replace(/^\[|\]$/g, '');
  return net.isIP(host) ? [{ address: host, family: net.isIP(host) }] : resolve(host);
}

/** GET over TLS to the pinned `address`; reads at most `maxBytes` of an HTML body. */
function httpsGet(url, address, { timeoutMs, maxBytes }) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      host: url.hostname,
      port: 443,
      path: `${url.pathname}${url.search}`,
      method: 'GET',
      headers: { 'User-Agent': 'LeadPulse-Enrichment/1.0', Accept: 'text/html' },
      timeout: timeoutMs,
      lookup: pinned(address),
    }, (res) => {
      const status = res.statusCode;
      const contentType = String(res.headers['content-type'] || '');
      if ((status >= 300 && status < 400) || !/^text\/html\b/i.test(contentType)) {
        res.resume();
        resolve({ status, location: res.headers.location, contentType, body: '' });
        return;
      }
      const chunks = [];
      let size = 0;
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > maxBytes) {
          chunks.push(chunk.subarray(0, chunk.length - (size - maxBytes)));
          res.destroy();
          resolve({ status, contentType, body: Buffer.concat(chunks).toString('utf8'), truncated: true });
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => resolve({ status, contentType, body: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new SafeFetchError('Timed out')));
    req.on('error', reject);
    req.end();
  });
}

/**
 * @param {string} rawUrl
 * @param {object} [opts]  `resolve` and `transport` are replaceable for tests
 * @returns {Promise<{ url: string, status: number, body: string, truncated?: boolean }>}
 */
async function safeFetch(rawUrl, {
  resolve = resolveHost, transport = httpsGet, timeoutMs = 5000, maxBytes = 512 * 1024, maxRedirects = 3,
} = {}) {
  const deadline = Date.now() + timeoutMs;
  let url = checkUrl(rawUrl);

  for (let redirects = 0; ; redirects += 1) {
    const addresses = await addressesOf(url.hostname, resolve);
    if (!addresses.length) throw new SafeFetchError('Host did not resolve');
    if (addresses.some((a) => !isPublicAddress(a.address))) throw new SafeFetchError('Host resolves to a private or reserved address');

    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new SafeFetchError('Timed out');
    const res = await transport(url, addresses[0], { timeoutMs: remaining, maxBytes });

    if (res.status >= 300 && res.status < 400 && res.location) {
      if (redirects >= maxRedirects) throw new SafeFetchError('Too many redirects');
      url = checkUrl(new URL(res.location, url).toString());
      continue;
    }
    if (res.status >= 400) throw new SafeFetchError(`HTTP ${res.status}`);
    if (!/^text\/html\b/i.test(res.contentType || '')) throw new SafeFetchError('Not an HTML page');
    return { url: url.toString(), status: res.status, body: res.body, truncated: res.truncated };
  }
}

/**
 * Checks a webhook URL and resolves it to the address to connect to.
 * @returns {Promise<{ url: URL, address: { address: string, family: number } }>}
 */
async function postTarget(rawUrl, { allowPrivate = false, resolve = resolveHost } = {}) {
  let url;
  if (allowPrivate) {
    try {
      url = new URL(rawUrl);
    } catch {
      throw new SafeFetchError('Invalid URL');
    }
    if (!['https:', 'http:'].includes(url.protocol)) throw new SafeFetchError('Only http and https URLs are allowed');
    if (url.username || url.password) throw new SafeFetchError('Credentials in URLs are not allowed');
  } else {
    url = checkUrl(rawUrl);
  }
  const addresses = await addressesOf(url.hostname, resolve);
  if (!addresses.length) throw new SafeFetchError('Host did not resolve');
  if (!allowPrivate && addresses.some((a) => !isPublicAddress(a.address))) throw new SafeFetchError('Host resolves to a private or reserved address');
  return { url, address: addresses[0] };
}

/**
 * POSTs `body` and resolves with the response status as soon as it arrives.
 * @param {string} rawUrl
 * @param {string} body
 * @param {Record<string, string>} headers
 * @param {{ allowPrivate?: boolean, timeoutMs?: number, resolve?: Function }} [opts]
 * @returns {Promise<{ status: number }>}
 */
async function safePost(rawUrl, body, headers, { allowPrivate = false, timeoutMs = 10_000, resolve = resolveHost } = {}) {
  const { url, address } = await postTarget(rawUrl, { allowPrivate, resolve });
  const secure = url.protocol === 'https:';
  return new Promise((done, fail) => {
    const req = (secure ? https : http).request({
      host: url.hostname,
      port: url.port || (secure ? 443 : 80),
      path: `${url.pathname}${url.search}`,
      method: 'POST',
      headers: { ...headers, 'Content-Length': Buffer.byteLength(body) },
      lookup: pinned(address),
    }, (res) => {
      clearTimeout(timer);
      done({ status: res.statusCode });
      res.destroy(); // only the status matters; don't wait for (or buffer) the body
    });
    const timer = setTimeout(() => req.destroy(new SafeFetchError('Timed out')), timeoutMs);
    req.on('error', (err) => {
      clearTimeout(timer);
      fail(err);
    });
    req.end(body);
  });
}

module.exports = { safeFetch, safePost, postTarget, isPublicAddress, SafeFetchError };
