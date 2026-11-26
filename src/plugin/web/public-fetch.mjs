// Public-address validation and DNS pinning adapted from DeepSeek Harness
// @deepseek-ai/dsh-web-fetch-http 0.2.1-rc.2 (MIT, Copyright (c) 2026 DeepSeek).
// See THIRD-PARTY-NOTICES.txt for license text.
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { createRequire } from 'node:module';
import ipaddr from 'ipaddr.js';

/** RFC 6052 prefix lengths that may carry an IPv4 destination through NAT64. */
const RFC6052_PREFIX_LENGTHS = [
  32,
  40,
  48,
  56,
  64,
  96
];
const IPV4ONLY_DISCOVERY_HOST = "ipv4only.arpa";
const IPV4ONLY_SENTINELS = new Set(["192.0.0.170", "192.0.0.171"]);
/**
* Return whether an address is globally reachable unicast. IPv4-mapped IPv6 is
* classified by its embedded IPv4 address; transition and translation prefixes
* remain blocked because their eventual IPv4 destination cannot be pinned here.
*
* @param input - textual IPv4 or IPv6 address.
* @returns true only for a public unicast destination.
*/
function isPublicIpAddress(input) {
  let parsed;
  try {
    parsed = ipaddr.parse(stripIpv6Brackets(input));
  } catch {
    return false;
  }
  if (parsed instanceof ipaddr.IPv4) return parsed.range() === "unicast";
  if (parsed.isIPv4MappedAddress()) return parsed.toIPv4Address().range() === "unicast";
  return parsed.range() === "unicast";
}
/**
* Resolve a hostname once and reject the complete answer set if any destination
* is not public. The returned addresses are the only ones the transport may use.
*
* @param hostname - URL hostname, including brackets when it is an IPv6 literal.
* @param signal - aborts the wait for system resolution; an in-flight OS lookup may finish unused.
* @param resolver - lookup implementation, overridden only by focused tests.
* @returns the validated, non-empty address set.
*/
async function resolvePublicAddresses(hostname, signal, resolver, WebError) {
  const unbracketed = stripIpv6Brackets(hostname);
  const literalFamily = isIP(unbracketed);
  const resolved = literalFamily === 0 ? await raceWithSignal(resolver(unbracketed, {
    all: true,
    order: "verbatim"
  }), signal) : [{
    address: unbracketed,
    family: literalFamily
  }];
  if (resolved.length === 0) throw new WebError(`hostname "${hostname}" resolved to no addresses`, "WEB_PROVIDER_ERROR");
  const nat64Prefixes = resolved.some((entry) => entry.family === 6 && isIP(entry.address) === 6) ? await discoverNat64Prefixes(signal, resolver) : [];
  const addresses = [];
  for (const entry of resolved) {
    if (entry.family !== 4 && entry.family !== 6 || isIP(entry.address) !== entry.family) throw new WebError(`hostname "${hostname}" resolved to an invalid IP address`, "WEB_PROVIDER_ERROR");
    if (!isPublicIpAddress(entry.address)) throw new WebError(`URL hostname "${hostname}" resolves to a non-public IP address`, "WEB_BLOCKED_URL");
    const translatedIpv4 = translatedIpv4Address(entry.address, nat64Prefixes);
    if (translatedIpv4 !== undefined && !isPublicIpAddress(translatedIpv4)) throw new WebError(`URL hostname "${hostname}" resolves through NAT64 to a non-public IPv4 address`, "WEB_BLOCKED_URL");
    addresses.push({
      address: entry.address,
      family: entry.family
    });
  }
  return addresses;
}
/** Discover the active DNS64 prefix set using RFC 7050's reserved hostname. */
async function discoverNat64Prefixes(signal, resolver) {
  const discovered = await raceWithSignal(resolver(IPV4ONLY_DISCOVERY_HOST, {
    all: true,
    order: "verbatim"
  }), signal);
  const prefixes = [];
  const seen = new Set();
  for (const entry of discovered) {
    if (entry.family !== 6 || isIP(entry.address) !== 6) continue;
    const bytes = ipaddr.parse(entry.address).toByteArray();
    for (const length of RFC6052_PREFIX_LENGTHS) {
      const embedded = embeddedIpv4Address(bytes, length);
      if (embedded === undefined || !IPV4ONLY_SENTINELS.has(embedded)) continue;
      const prefixBytes = bytes.slice(0, length / 8);
      const key = `${length}:${prefixBytes.join(".")}`;
      if (seen.has(key)) continue;
      seen.add(key);
      prefixes.push({
        bytes: prefixBytes,
        length
      });
    }
  }
  return prefixes;
}
/** Return the RFC 6052-embedded IPv4 address when an IPv6 address matches a discovered prefix. */
function translatedIpv4Address(input, prefixes) {
  if (isIP(input) !== 6) return undefined;
  const bytes = ipaddr.parse(input).toByteArray();
  for (const prefix of prefixes) {
    if (!prefix.bytes.every((byte, index) => bytes[index] === byte)) continue;
    const embedded = embeddedIpv4Address(bytes, prefix.length);
    if (embedded !== undefined) return embedded;
  }
}
/** Extract one IPv4 address from an RFC 6052 IPv6 layout. */
function embeddedIpv4Address(bytes, prefixLength) {
  if (prefixLength === 96) return bytes.slice(12, 16).join(".");
  if (bytes[8] !== 0) return undefined;
  const prefixBytes = prefixLength / 8;
  const beforeReservedOctet = 8 - prefixBytes;
  return [...bytes.slice(prefixBytes, prefixBytes + beforeReservedOctet), ...bytes.slice(9, 13 - beforeReservedOctet)].join(".");
}
/**
* Build the connector lookup that serves a fixed validated answer set.
*
* @param addresses - public addresses retained from the preceding resolution.
* @returns a Node-compatible lookup callback that performs no network resolution.
*/
function createPinnedLookup(addresses) {
  return (hostname, options, callback) => {
    const family = typeof options.family === "number" ? options.family : options.family === "IPv4" ? 4 : options.family === "IPv6" ? 6 : 0;
    const eligible = family === 0 ? addresses : addresses.filter((address) => address.family === family);
    const selected = eligible[0];
    if (selected === undefined) {
      callback(Object.assign(new Error(`no validated address for ${hostname} in family ${family}`), {
        code: "ENOTFOUND",
        hostname
      }), options.all === true ? [] : "", family);
      return;
    }
    if (options.all === true) {
      callback(null, eligible.map((address) => ({ ...address })));
      return;
    }
    callback(null, selected.address, selected.family);
  };
}
/** Race a non-cancellable OS lookup without letting it delay tool cancellation. */
function raceWithSignal(promise, signal) {
  const abortError = () => new Error("web fetch aborted during hostname resolution", { cause: signal.reason });
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const abort = () => {
      reject(abortError());
    };
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", abort);
    });
  });
}
/** WHATWG URL retains brackets around IPv6 hostnames; IP parsers do not. */
function stripIpv6Brackets(hostname) {
  return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
}

const MAX_URL_LENGTH = 2048;
const MAX_BYTES = 5_000_000;
const MAX_CHARS = 100_000;
const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export function createPublicFetchProvider(requireDsh, resolve = lookup) {
  const { WebError } = requireDsh('@deepseek-ai/dsh-web');
  const { deadline, timeoutOf } = requireDsh('@deepseek-ai/dsh-timeout');
  const { proxyRouteFor } = requireDsh('@deepseek-ai/dsh-http-proxy');
  const requireFetch = createRequire(requireDsh.resolve('@deepseek-ai/dsh-web-fetch-http'));
  const { Agent, fetch } = requireFetch('undici');

  function parseUrl(input, base) {
    const url = URL.parse(input, base);
    if (!url || url.href.length > MAX_URL_LENGTH || !['http:', 'https:'].includes(url.protocol)) {
      throw new WebError('网页读取仅支持有效的 HTTP(S) 地址，长度上限为 2048 字符。', 'WEB_INVALID_URL');
    }
    if (url.username || url.password) throw new WebError('网页读取地址不能包含凭据。', 'WEB_BLOCKED_URL');
    return url;
  }

  async function readBody(response, url) {
    const contentType = response.headers.get('content-type') ?? '';
    const mime = contentType.split(';', 1)[0].trim().toLowerCase();
    const isHtml = mime === 'text/html' || mime === 'application/xhtml+xml';
    const isText = mime.startsWith('text/') || ['application/json', 'application/xml'].includes(mime)
      || mime.endsWith('+json') || mime.endsWith('+xml');
    if (!isHtml && !isText) throw new WebError(`不支持的网页内容类型 ${mime}`, 'WEB_UNSUPPORTED_CONTENT_TYPE');
    if (Number(response.headers.get('content-length')) > MAX_BYTES) {
      throw new WebError('网页响应超过 5 MB。', 'WEB_FETCH_TOO_LARGE');
    }
    const charset = /;\s*charset\s*=\s*"?([^";]+)"?/i.exec(contentType)?.[1].trim();
    let decoder;
    try { decoder = new TextDecoder(charset); }
    catch { throw new WebError(`不支持的网页字符编码 ${charset}`, 'WEB_UNSUPPORTED_CONTENT_TYPE'); }
    const reader = response.body?.getReader();
    let content = '';
    let bytes = 0;
    let truncated = false;
    if (reader) {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) { content += decoder.decode(); break; }
          const remaining = MAX_BYTES - bytes;
          bytes += value.byteLength;
          content += decoder.decode(value.subarray(0, remaining), { stream: true });
          if (bytes > MAX_BYTES || content.length > MAX_CHARS) { truncated = true; break; }
        }
      } finally { reader.releaseLock(); }
    }
    return {
      url: url.href, statusCode: response.status,
      body: { kind: isHtml ? 'html' : 'text', content: content.slice(0, MAX_CHARS) },
      truncated: truncated || content.length > MAX_CHARS,
    };
  }

  return {
    id: 'http',
    available: () => true,
    async fetch(request, signal) {
      const timeout = deadline(signal, 30_000, 'WEB_FETCH_TIMEOUT');
      try {
        let url = parseUrl(request.url);
        for (let redirects = 0; ; redirects++) {
          timeout.signal.throwIfAborted();
          // The proxy resolves destinations itself, so no pinned address can be
          // guaranteed there. Do not bypass the user's configured proxy route.
          if (proxyRouteFor(url).proxied) {
            throw new WebError('此网页需要代理，无法验证实际目标为公网地址。', 'WEB_BLOCKED_URL');
          }
          const addresses = await resolvePublicAddresses(url.hostname, timeout.signal, resolve, WebError);
          const dispatcher = new Agent({ autoSelectFamily: true, connect: { lookup: createPinnedLookup(addresses) } });
          let response;
          try {
            response = await fetch(url, {
              redirect: 'manual', dispatcher, signal: timeout.signal,
              headers: { 'user-agent': 'Deepseedian (+https://github.com/DrTonks/deepseedian)',
                accept: 'text/html,application/xhtml+xml,text/*;q=0.9,application/json;q=0.8' },
            });
            if (!REDIRECT_STATUSES.has(response.status)) return await readBody(response, url);
            const location = response.headers.get('location');
            if (!location || redirects >= MAX_REDIRECTS) {
              throw new WebError('网页跳转缺少地址或超过次数上限。', 'WEB_REDIRECT_BLOCKED');
            }
            const target = parseUrl(location, url);
            if (target.origin !== url.origin) throw new WebError('网页读取不跟随跨源跳转。', 'WEB_REDIRECT_BLOCKED');
            url = target;
          } finally {
            await response?.body?.cancel().catch(() => {});
            await dispatcher.destroy();
          }
        }
      } catch (error) {
        if (error instanceof WebError) throw error;
        if (timeoutOf(timeout.signal, 'WEB_FETCH_TIMEOUT')) throw new WebError('网页读取超时。', 'WEB_FETCH_TIMEOUT');
        if (timeout.signal.aborted) throw new WebError('网页读取已取消。', 'WEB_ABORTED');
        throw new WebError('无法读取网页。', 'WEB_PROVIDER_ERROR', { cause: error });
      } finally { timeout[Symbol.dispose](); }
    },
  };
}
