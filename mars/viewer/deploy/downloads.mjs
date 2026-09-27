// Large files stay streamed: a campus GLB can exceed the Worker's memory limit.
export async function serveDownload(request, bucket, asset) {
  if (!['GET', 'HEAD'].includes(request.method)) {
    return new Response('Method not allowed', {
      status: 405,
      headers: { Allow: 'GET, HEAD' },
    });
  }
  const negotiated = !!asset.br;
  // Range offsets refer to the identity GLB. Never return slices of a Brotli stream.
  // Cloudflare can strip quality parameters from clientAcceptEncoding. Standard
  // identity/gzip-only clients are preserved; honor q=0 whenever it reaches us.
  const acceptsBr = (
    request.cf?.clientAcceptEncoding ??
    request.headers.get('Accept-Encoding') ??
    ''
  )
    .toLowerCase()
    .split(',')
    .some((part) => {
      const [name, ...parameters] = part.trim().split(';');
      const q = parameters.find((p) => p.trim().startsWith('q='));
      return name.trim() === 'br' && (!q || Number(q.trim().slice(2)) > 0);
    });
  let encoded = negotiated && acceptsBr && !request.headers.has('Range');
  let selected = encoded ? asset.br : asset;
  let metadata = await bucket.head(selected.key);
  if (!metadata && encoded) {
    encoded = false;
    selected = asset;
    metadata = await bucket.head(asset.key);
  }

  if (!metadata) return new Response('Model unavailable', { status: 404 });
  const headers = new Headers({
    'Content-Type': asset.type,
    'Content-Length': String(metadata.size),
    'Cache-Control': 'public, max-age=3600, no-transform',
    ETag: metadata.httpEtag,
    'Accept-Ranges': 'bytes',
    'X-Content-Type-Options': 'nosniff',
    'X-Robots-Tag': 'noindex',
  });
  if (negotiated) headers.set('Vary', 'Accept-Encoding, Range');
  if (encoded) {
    headers.set('Content-Encoding', 'br');
    headers.set('Accept-Ranges', 'none');
  }
  if (
    request.headers
      .get('If-None-Match')
      ?.split(',')
      .some(
        (s) =>
          s.trim().replace(/^W\//, '') === metadata.httpEtag ||
          s.trim() === '*',
      )
  ) {
    headers.delete('Content-Length');
    return new Response(null, { status: 304, headers });
  }
  if (request.method === 'HEAD')
    return new Response(null, { headers, encodeBody: 'manual' });
  let range;
  const requested = request.headers.get('Range');
  const ifRange = request.headers.get('If-Range');
  if (requested && (!ifRange || ifRange === metadata.httpEtag)) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(requested);
    if (match && (match[1] || match[2])) {
      const start = match[1]
        ? Number(match[1])
        : Math.max(0, metadata.size - Number(match[2]));
      const end =
        match[1] && match[2]
          ? Math.min(Number(match[2]), metadata.size - 1)
          : metadata.size - 1;
      if (
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(end) ||
        start > end ||
        start >= metadata.size
      ) {
        return new Response(null, {
          status: 416,
          headers: { 'Content-Range': `bytes */${metadata.size}` },
        });
      }
      range = { offset: start, length: end - start + 1 };
    }
  }
  const object = await bucket.get(selected.key, range ? { range } : undefined);
  if (!object) return new Response('Model unavailable', { status: 404 });
  if (range) {
    headers.set('Content-Length', String(range.length));
    headers.set(
      'Content-Range',
      `bytes ${range.offset}-${range.offset + range.length - 1}/${metadata.size}`,
    );
  }
  return new Response(object.body, {
    status: range ? 206 : 200,
    headers,
    encodeBody: 'manual',
  });
}
