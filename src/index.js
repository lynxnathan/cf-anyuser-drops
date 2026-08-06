const MAX_BYTES = 25 * 1024 * 1024;
const encoder = new TextEncoder();

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "PUT" && url.pathname === "/api/drop") {
      return upload(request, env, url);
    }

    if (request.method === "DELETE" && url.pathname.startsWith("/api/drop/")) {
      return remove(request, env, url);
    }

    if ((request.method === "GET" || request.method === "HEAD") && url.pathname.startsWith("/d/")) {
      return download(request, env, url);
    }

    if (request.method === "GET" && url.pathname === "/") {
      const title = escapeHtml(env.SITE_TITLE || "anyuser drops");
      return new Response(
        `<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width'><title>${title}</title><style>body{font:18px system-ui;max-width:42rem;margin:15vh auto;padding:1.5rem;background:#0d1117;color:#d8dee9}code{color:#88c0d0}</style><h1>${title}</h1><p>A tiny private-upload, public-link file drop.</p><p><code>anyuser-drops &lt;file&gt;</code></p>`,
        { headers: secureHeaders("text/html; charset=utf-8") },
      );
    }

    return new Response("Not found\n", { status: 404, headers: secureHeaders("text/plain; charset=utf-8") });
  },
};

async function upload(request, env, url) {
  if (!env.UPLOAD_TOKEN) {
    return json({ error: "Upload service is not configured" }, 503);
  }

  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!(await tokensMatch(supplied, env.UPLOAD_TOKEN))) {
    return json({ error: "Unauthorized" }, 401);
  }

  const length = Number(request.headers.get("content-length"));
  if (!Number.isFinite(length) || length < 1) {
    return json({ error: "A non-empty Content-Length is required" }, 411);
  }
  if (length > MAX_BYTES) {
    return json({ error: "Files are limited to 25 MiB" }, 413);
  }

  let requestedName = request.headers.get("x-file-name") ?? "file";
  try {
    requestedName = decodeURIComponent(requestedName);
  } catch {
    return json({ error: "Invalid file name" }, 400);
  }

  const filename = safeFilename(requestedName);
  const id = crypto.randomUUID().replaceAll("-", "");
  const key = `drop:${id}`;
  const contentType = request.headers.get("content-type") || "application/octet-stream";

  await env.DROPS.put(key, request.body, {
    httpMetadata: { contentType },
    customMetadata: {
      filename,
      createdAt: new Date().toISOString(),
    },
  });

  const publicUrl = `${url.protocol}//${url.host}/d/${id}/${encodeURIComponent(filename)}`;
  return json({ url: publicUrl, bytes: length, filename }, 201);
}

async function remove(request, env, url) {
  if (!env.UPLOAD_TOKEN) {
    return json({ error: "Drop service is not configured" }, 503);
  }

  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!(await tokensMatch(supplied, env.UPLOAD_TOKEN))) {
    return json({ error: "Unauthorized" }, 401);
  }

  const match = url.pathname.match(/^\/api\/drop\/([a-f0-9]{32})$/);
  if (!match) return json({ error: "Invalid drop ID" }, 400);

  const key = `drop:${match[1]}`;
  if (!(await env.DROPS.head(key))) {
    return json({ error: "Drop not found" }, 404);
  }

  await env.DROPS.delete(key);
  return new Response(null, { status: 204, headers: secureHeaders(null) });
}

async function download(request, env, url) {
  // Keep the first 64-bit links readable while issuing 128-bit IDs going forward.
  const match = url.pathname.match(/^\/d\/([a-f0-9]{16}|[a-f0-9]{32})(?:\/.*)?$/);
  if (!match) {
    return new Response("Not found\n", { status: 404, headers: secureHeaders("text/plain; charset=utf-8") });
  }

  const stored = await env.DROPS.get(`drop:${match[1]}`);
  if (!stored) {
    return new Response("Not found\n", { status: 404, headers: secureHeaders("text/plain; charset=utf-8") });
  }

  const filename = safeFilename(stored.customMetadata?.filename ?? "file");
  const headers = secureHeaders(stored.httpMetadata?.contentType ?? "application/octet-stream");
  headers.set("cache-control", "public, max-age=31536000, immutable");
  headers.set("content-disposition", `inline; filename*=UTF-8''${encodeURIComponent(filename)}`);
  headers.set("content-length", String(stored.size));
  if (stored.httpEtag) headers.set("etag", stored.httpEtag);

  return new Response(request.method === "HEAD" ? null : stored.body, { headers });
}

async function tokensMatch(left, right) {
  if (!left || !right) return false;
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right)),
  ]);
  const aa = new Uint8Array(a);
  const bb = new Uint8Array(b);
  let difference = 0;
  for (let i = 0; i < aa.length; i += 1) difference |= aa[i] ^ bb[i];
  return difference === 0;
}

function safeFilename(value) {
  const name = String(value).split(/[\\/]/).pop() || "file";
  const cleaned = name
    .replace(/[\p{Cc}\p{Cf}\p{Cs}<>:"|?*]/gu, "-")
    .replace(/\s+/g, " ")
    .trim()
    .normalize("NFC");
  const safe = [...(cleaned || "file")].slice(0, 160).join("");
  return safe === "." || safe === ".." ? "file" : safe;
}

function secureHeaders(contentType) {
  const headers = new Headers({
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "x-frame-options": "DENY",
  });
  if (contentType) headers.set("content-type", contentType);
  return headers;
}

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: secureHeaders("application/json; charset=utf-8"),
  });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}
