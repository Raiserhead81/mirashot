'use strict';
/**
 * MIRASHOT — SSRF-Schutz.
 * Erlaubt nur http/https zu oeffentlich routbaren Zielen.
 * Prueft: Scheme, Host-String, und NACH DNS-Resolve jede Ziel-IP erneut.
 */

const dns = require('dns').promises;
const net = require('net');

// [Netzadresse, Praefixlaenge]
const BLOCKED_V4 = [
  ['0.0.0.0', 8], // "this network", inkl. 0.0.0.0
  ['10.0.0.0', 8], // privat
  ['100.64.0.0', 10], // CGNAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local (Cloud-Metadaten!)
  ['172.16.0.0', 12], // privat
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // TEST-NET-1
  ['192.168.0.0', 16], // privat
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // TEST-NET-2
  ['203.0.113.0', 24], // TEST-NET-3
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved
];

const BLOCKED_V6 = [
  ['::1', 128], // loopback
  ['::', 128], // unspecified
  ['::ffff:0:0', 96], // IPv4-mapped -> wird eh in v4 konvertiert
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link-local
  ['ff00::', 8], // multicast
  ['2001:db8::', 32], // documentation
];

function v4ToLong(ip) {
  const p = ip.split('.');
  if (p.length !== 4) return null;
  let n = 0;
  for (const part of p) {
    const v = Number(part);
    if (!Number.isInteger(v) || v < 0 || v > 255) return null;
    n = n * 256 + v;
  }
  return n;
}

function bigAnd(hexStr, prefix) {
  // Vergleiche die ersten `prefix` Bits zweier IPv6 als BigInt
  const a = BigInt('0x' + hexStr);
  const mask = prefix === 0 ? 0n : ((1n << BigInt(prefix)) - 1n) << BigInt(128 - prefix);
  return a & mask;
}

function v4GroupToHex(group) {
  // "127.0.0.1" -> "7f00:0001"
  const n = v4ToLong(group);
  if (n === null) return null;
  return [(n >>> 16).toString(16).padStart(4, '0'), (n & 0xffff).toString(16).padStart(4, '0')];
}

function expandV6(ip) {
  // Ohne Zone-Index, IPv4-Anteile in Hex-Gruppen umgewandelt
  const addr = ip.split('%')[0];
  if (!addr.includes(':')) return null;
  const [head, tail] = addr.split('::');
  const expandGroups = (list) => {
    const out = [];
    for (const g of list) {
      if (g.includes('.')) {
        const hex = v4GroupToHex(g);
        if (!hex) return null;
        out.push(...hex);
      } else {
        out.push(g);
      }
    }
    return out;
  };
  const h = expandGroups(head ? head.split(':') : []);
  const t = expandGroups(tail ? tail.split(':') : []);
  if (!h || !t) return null;
  const fill = 8 - h.length - t.length;
  if (fill < 0) return null;
  const groups = [...h, ...Array(fill).fill('0'), ...t];
  return groups.map((g) => g.padStart(4, '0')).join('');
}

function isBlockedIp(ip) {
  if (net.isIPv4(ip)) {
    const n = v4ToLong(ip);
    if (n === null) return true;
    for (const [base, bits] of BLOCKED_V4) {
      const b = v4ToLong(base);
      const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
      if (((n & mask) >>> 0) === ((b & mask) >>> 0)) return true;
    }
    return false;
  }
  if (net.isIPv6(ip)) {
    let hex = expandV6(ip);
    if (!hex) return true;
    // IPv4-mapped (::ffff:a.b.c.d) als IPv4 behandeln
    if (hex.startsWith('0'.repeat(20) + 'ffff')) {
      const v4 = [
        parseInt(hex.slice(24, 26), 16),
        parseInt(hex.slice(26, 28), 16),
        parseInt(hex.slice(28, 30), 16),
        parseInt(hex.slice(30, 32), 16),
      ].join('.');
      return isBlockedIp(v4);
    }
    for (const [base, bits] of BLOCKED_V6) {
      if (bigAnd(hex, bits) === bigAnd(expandV6(base), bits)) return true;
    }
    return false;
  }
  return true; // unbekanntes Format -> blocken
}

const HOSTNAME_RE = /^[a-zA-Z0-9._-]{1,253}$/;

/**
 * Validiert eine Ziel-URL strukturell (ohne DNS).
 * @returns {{ok:true, url:URL} | {ok:false, reason:string}}
 */
function checkUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'Ungültige URL' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: 'Nur http und https erlaubt' };
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return { ok: false, reason: 'Kein Host angegeben' };
  // Kennungen, die man nicht per DNS faengt
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    return { ok: false, reason: 'Ziel nicht erlaubt' };
  }
  // Direkt angegebene IPs sofort pruefen
  if (net.isIP(host) && isBlockedIp(host)) {
    return { ok: false, reason: 'Ziel-IP nicht erlaubt' };
  }
  if (!net.isIP(host) && !HOSTNAME_RE.test(host)) {
    return { ok: false, reason: 'Ungültiger Hostname' };
  }
  if (url.port) {
    const port = Number(url.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return { ok: false, reason: 'Ungültiger Port' };
    }
  }
  return { ok: true, url };
}

/**
 * Löst den Hostnamen auf und prüft ALLE resultierenden IPs.
 * @returns {{ok:true, addresses:string[]} | {ok:false, reason:string}}
 */
async function resolveAndCheck(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (net.isIP(host)) {
    return isBlockedIp(host) ? { ok: false, reason: 'Ziel-IP nicht erlaubt' } : { ok: true, addresses: [host] };
  }
  let records = [];
  try {
    const [a, aaaa] = await Promise.all([dns.resolve4(host).catch(() => []), dns.resolve6(host).catch(() => [])]);
    records = [...a, ...aaaa];
  } catch {
    return { ok: false, reason: 'Name konnte nicht aufgelöst werden' };
  }
  if (!records.length) {
    return { ok: false, reason: 'Name konnte nicht aufgelöst werden' };
  }
  for (const ip of records) {
    if (isBlockedIp(ip)) {
      return { ok: false, reason: 'Ziel-IP nicht erlaubt' };
    }
  }
  return { ok: true, addresses: records };
}

module.exports = { checkUrl, resolveAndCheck, isBlockedIp };
