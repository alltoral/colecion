// Coleção Neon: nuvem de sincronização (Cloudflare Durable Object com SQLite).
//
// Cada coleção tem um código (ex. K7QM-4XPA). O Worker transforma o código num
// identificador (SHA-256) e cada coleção vive num Durable Object próprio.
// Rotas (todas com o cabeçalho x-colecao: <código>):
//   GET    /api/sync?since=N   alterações desde N (em blocos), ids existentes e listas
//   PUT    /api/carro/:id      grava um carrinho
//   DELETE /api/carro/:id      apaga um carrinho
//   PUT    /api/listas         grava as listas de marcas e séries
import { DurableObject } from "cloudflare:workers";

const BLOCO = 30; // carrinhos por resposta (fotos deixam cada um com ~100-200 KB)
const MAX_DOC = 1_800_000;

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

export function normalizarCodigo(c) {
  return String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

async function sha256(txt) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("colecao-neon:" + txt));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function handleSync(request, env, url) {
  if (!env.COLECAO) return json({ erro: "Nuvem não configurada" }, 503);
  const codigo = normalizarCodigo(request.headers.get("x-colecao"));
  if (codigo.length < 8) return json({ erro: "Código da coleção inválido" }, 401);
  const stub = env.COLECAO.get(env.COLECAO.idFromName(await sha256(codigo)));
  const inner = new URL(url.pathname.replace(/^\/api/, "") + url.search, "https://do");
  return stub.fetch(new Request(inner, request));
}

export class Colecao extends DurableObject {
  async proximoU() {
    const ultimo = (await this.ctx.storage.get("meta:u")) || 0;
    const u = Math.max(Date.now(), ultimo + 1);
    await this.ctx.storage.put("meta:u", u);
    return u;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const p = url.pathname;
    const st = this.ctx.storage;

    if (p === "/sync" && request.method === "GET") {
      const since = Number(url.searchParams.get("since") || 0);
      const metas = await st.list({ prefix: "m:" }); // id -> u
      const ids = [];
      const mudados = [];
      for (const [k, u] of metas) {
        const id = k.slice(2);
        ids.push(id);
        if (u > since) mudados.push([id, u]);
      }
      mudados.sort((a, b) => a[1] - b[1]);
      const bloco = mudados.slice(0, BLOCO);
      const docs = [];
      if (bloco.length) {
        const got = await st.get(bloco.map(([id]) => "c:" + id));
        for (const [id, u] of bloco) {
          const d = got.get("c:" + id);
          if (d) docs.push({ ...d, id, _u: u });
        }
      }
      const mais = mudados.length > BLOCO;
      const listas = await st.get("listas");
      return json({
        ids,
        docs,
        mais,
        ate: mais ? bloco[bloco.length - 1][1] : (await st.get("meta:u")) || since,
        listas: listas || null,
      });
    }

    const m = p.match(/^\/carro\/([A-Za-z0-9_\-.:]{1,120})$/);
    if (m && request.method === "PUT") {
      const txt = await request.text();
      if (txt.length > MAX_DOC) return json({ erro: "Carrinho grande demais (foto muito pesada)" }, 413);
      let doc;
      try {
        doc = JSON.parse(txt);
      } catch {
        return json({ erro: "Envio inválido" }, 400);
      }
      delete doc.id;
      delete doc._u;
      const u = await this.proximoU();
      await st.put({ ["c:" + m[1]]: doc, ["m:" + m[1]]: u });
      return json({ ok: true, u });
    }
    if (m && request.method === "DELETE") {
      await st.delete(["c:" + m[1], "m:" + m[1]]);
      await this.proximoU();
      return json({ ok: true });
    }

    if (p === "/listas" && request.method === "PUT") {
      let l;
      try {
        l = await request.json();
      } catch {
        return json({ erro: "Envio inválido" }, 400);
      }
      if (!l || !Array.isArray(l.marcas) || !Array.isArray(l.series)) return json({ erro: "Listas inválidas" }, 400);
      await st.put("listas", { marcas: l.marcas.slice(0, 500), series: l.series.slice(0, 3000) });
      return json({ ok: true });
    }

    return json({ erro: "Rota não encontrada" }, 404);
  }
}
