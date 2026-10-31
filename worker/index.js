// Coleção Neon: Worker do Cloudflare.
// Serve o app (arquivos estáticos) e a rota de IA /api/ficha.
//
// Como a IA preenche a ficha:
//   1. Identifica o carrinho (foto ou descrição) com o Workers AI: marca, carro real, cor, textos visíveis.
//   2. Pesquisa na wiki da marca (Hot Wheels Wiki, Matchbox Wiki) o nome oficial da miniatura, séries e anos.
//   3. Junta tudo e devolve a ficha final em JSON, usando a wiki como fonte para nome, série e ano.

import { Colecao, handleSync } from "./sync.js";
export { Colecao };

const MODEL_VISION = "@cf/meta/llama-4-scout-17b-16e-instruct";
const MODEL_TEXT = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const MAX_IMAGE_CHARS = 1_500_000; // ~1 MB de imagem em base64
const UA = "ColecaoNeon/1.0 (catalogo pessoal de miniaturas)";

const WIKIS = {
  "hot wheels": { host: "hotwheels.fandom.com", nome: "Hot Wheels Wiki" },
  matchbox: { host: "matchbox.fandom.com", nome: "Matchbox Wiki" },
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

function extractJSON(text) {
  if (!text) return null;
  if (typeof text === "object") return text;
  const clean = String(text).replace(/```(?:json)?/gi, "");
  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(clean.slice(start, end + 1));
  } catch {
    return null;
  }
}

async function chat(env, model, messages, maxTokens = 700) {
  const out = await env.AI.run(model, { messages, max_tokens: maxTokens, temperature: 0.1 });
  return out?.response ?? out;
}


/* ---------- Claude (principal, quando ANTHROPIC_API_KEY existir) ---------- */
const CLAUDE_MODEL = "claude-sonnet-5-5";

async function claudeFicha(env, prompt, image) {
  const content = [];
  if (image) {
    const m = image.match(/^data:(image\/[a-z+]+);base64,(.+)$/);
    if (m) content.push({ type: "image", source: { type: "base64", media_type: m[1], data: m[2] } });
  }
  content.push({
    type: "text",
    text: `${prompt}

Como trabalhar:
1. ${image ? "Olhe a foto com atenção: formato da carroceria, detalhes, rodas, pintura, decoração e qualquer texto na mini, na base ou na cartela." : "Use a descrição do dono."}
2. Pesquise na internet (Hot Wheels Wiki, Matchbox Wiki, sites de colecionadores) para confirmar o nome oficial da miniatura (casting), a série/linha e o ano dessa versão com essa pintura.
3. Responda no final SOMENTE com o objeto JSON pedido, acrescentando a chave "fonte" com o nome do site principal usado (ou null).`,
  });
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: env.CLAUDE_MODEL || CLAUDE_MODEL,
      max_tokens: 1500,
      system: "Você é um especialista em miniaturas colecionáveis 1:64 (Hot Wheels, Matchbox, Majorette, Maisto, Tomica, Mini GT). Identifica modelos pela foto e confirma dados pesquisando na internet.",
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 4 }],
      messages: [{ role: "user", content }],
    }),
  });
  if (r.status === 429) throw new Error("rate limit");
  if (!r.ok) throw new Error("claude " + r.status + " " + (await r.text()).slice(0, 300));
  const j = await r.json();
  const text = (j.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
  // pega o último objeto JSON válido do texto (a resposta final vem depois das pesquisas)
  let data = null;
  for (let i = text.lastIndexOf("{"); i >= 0 && !data; i = i > 0 ? text.lastIndexOf("{", i - 1) : -1) {
    const end = text.lastIndexOf("}");
    if (end > i) { try { data = JSON.parse(text.slice(i, end + 1)); } catch {} }
  }
  return data;
}

/* ---------- Reserva: Workers AI + wiki ---------- */
/* ---------- 1. identificar ---------- */
const IDENT_PROMPT = `Analise a miniatura colecionável de carro (escala 1:64) e responda SOMENTE com um JSON com estas chaves:
"marca_miniatura" (fabricante da miniatura, ex. Hot Wheels, Matchbox, Majorette, Maisto, Tomica, Mini GT; null se não der para saber),
"carro_real" (marca e modelo do carro real que a miniatura representa, com geração/ano se der, ex. "Nissan GT-R R35", "1967 Chevrolet Camaro"),
"nome_provavel" (como o fabricante da miniatura costuma chamar esse modelo, ex. "'67 Camaro", "Mega-Wrex"),
"cor" (cor predominante), "tipo" (esportivo, muscle car, monster truck, etc.),
"texto_visivel" (todo texto legível na miniatura ou na cartela: nome, série, números, logos),
"busca" (2 ou 3 termos curtos em inglês para pesquisar esse modelo numa wiki de miniaturas, separados por ";").`;

async function identify(env, prompt, image) {
  const system = "Você é especialista em miniaturas colecionáveis 1:64 (Hot Wheels, Matchbox e outras). Responda apenas com JSON válido.";
  if (image) {
    const raw = await chat(env, MODEL_VISION, [
      { role: "system", content: system },
      {
        role: "user",
        content: [
          { type: "text", text: IDENT_PROMPT + "\n\nInformações extras do dono (podem estar vazias):\n" + prompt.slice(-800) },
          { type: "image_url", image_url: { url: image } },
        ],
      },
    ]);
    return extractJSON(raw) || {};
  }
  const raw = await chat(env, MODEL_TEXT, [
    { role: "system", content: system },
    { role: "user", content: IDENT_PROMPT + "\n\nO dono descreveu o carrinho assim:\n" + prompt.slice(-1500) },
  ]);
  return extractJSON(raw) || {};
}

/* ---------- 2. pesquisar na wiki da marca ---------- */
function wikiFor(marca) {
  const m = String(marca || "").toLowerCase();
  for (const k of Object.keys(WIKIS)) if (m.includes(k)) return WIKIS[k];
  return null;
}

async function wikiSearch(host, query) {
  const u = `https://${host}/api.php?action=query&list=search&format=json&srlimit=4&srsearch=${encodeURIComponent(query)}`;
  const r = await fetch(u, { headers: { "user-agent": UA } });
  if (!r.ok) return [];
  const j = await r.json();
  return (j?.query?.search || []).map((s) => ({ title: s.title, snippet: String(s.snippet || "").replace(/<[^>]+>/g, "") }));
}

async function wikiPage(host, title) {
  const u = `https://${host}/api.php?action=query&prop=revisions&rvprop=content&rvslots=main&format=json&formatversion=2&titles=${encodeURIComponent(title)}`;
  const r = await fetch(u, { headers: { "user-agent": UA } });
  if (!r.ok) return "";
  const j = await r.json();
  const txt = j?.query?.pages?.[0]?.revisions?.[0]?.slots?.main?.content || "";
  // remove marcações pesadas, mantém infobox e tabelas de versões
  return txt.replace(/\[\[(?:File|Image|Category):[^\]]*\]\]/gi, "").replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, "").slice(0, 7000);
}

async function research(ident) {
  const wiki = wikiFor(ident.marca_miniatura) || (!ident.marca_miniatura ? WIKIS["hot wheels"] : null);
  if (!wiki) return null;
  const queries = [ident.nome_provavel, ...String(ident.busca || "").split(";"), ident.carro_real]
    .map((q) => String(q || "").trim())
    .filter(Boolean)
    .slice(0, 4);
  const seen = new Map();
  for (const q of queries) {
    try {
      for (const hit of await wikiSearch(wiki.host, q)) if (!seen.has(hit.title)) seen.set(hit.title, hit);
    } catch {}
    if (seen.size >= 6) break;
  }
  const hits = [...seen.values()].slice(0, 6);
  if (!hits.length) return { wiki, hits: [], pages: [] };
  const pages = [];
  for (const h of hits.slice(0, 2)) {
    try {
      const content = await wikiPage(wiki.host, h.title);
      if (content) pages.push({ title: h.title, content });
    } catch {}
  }
  return { wiki, hits, pages };
}

/* ---------- 3. ficha final ---------- */
async function finalize(env, rules, ident, found) {
  const wikiText = found && found.pages.length
    ? found.pages.map((p) => `### Página da ${found.wiki.nome}: ${p.title}\n${p.content}`).join("\n\n")
    : "(nenhuma página encontrada na wiki)";
  const hitsText = found && found.hits.length ? found.hits.map((h) => `- ${h.title}: ${h.snippet}`).join("\n") : "";
  const raw = await chat(
    env,
    MODEL_TEXT,
    [
      {
        role: "system",
        content: "Você preenche fichas de miniaturas colecionáveis cruzando a identificação visual com dados da wiki da marca. Responda apenas com JSON válido.",
      },
      {
        role: "user",
        content: `${rules}

IDENTIFICAÇÃO VISUAL (pode ter erros):
${JSON.stringify(ident)}

RESULTADOS DA BUSCA NA WIKI:
${hitsText}

CONTEÚDO DA WIKI:
${wikiText}

Instruções:
- "nome": use o nome oficial da miniatura como aparece no título da página da wiki que corresponde ao carro identificado.
- "serie": procure na tabela de versões da wiki a versão com a cor mais parecida com a identificada e use a série dela; se houver texto visível da cartela com a série, priorize esse texto.
- "ano": ano dessa versão na tabela; se não achar a versão, use o ano de lançamento do modelo (primeiro ano na wiki).
- Se a wiki não tiver nada compatível, use a identificação visual e deixe "serie" como null.
- Inclua também a chave "fonte" com o título da página da wiki usada, ou null.`,
      },
    ],
    800
  );
  const data = extractJSON(raw) || {};
  if (data.fonte && found && found.wiki) data.fonte = `${found.wiki.nome}: ${data.fonte}`;
  return data;
}

async function handleFicha(request, env) {
  if (!env.AI && !env.ANTHROPIC_API_KEY) return json({ erro: "IA não configurada neste Worker" }, 503);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ erro: "Envio inválido" }, 400);
  }
  const prompt = typeof body.prompt === "string" ? body.prompt.slice(0, 8000) : "";
  const image = typeof body.image === "string" && body.image.startsWith("data:image/") ? body.image : null;
  if (!prompt) return json({ erro: "Faltou a descrição" }, 400);
  if (image && image.length > MAX_IMAGE_CHARS) return json({ erro: "Foto grande demais" }, 413);

  if (env.ANTHROPIC_API_KEY) {
    try {
      const data = await claudeFicha(env, prompt, image);
      if (data && Object.keys(data).length) return json(data);
    } catch (err) {
      if (/rate limit/i.test(String(err && err.message))) return json({ erro: "Muitas consultas seguidas" }, 429);
      console.log("Claude falhou, usando reserva:", String(err && err.message));
    }
  }
  try {
    const ident = await identify(env, prompt, image);
    let found = null;
    try {
      found = await research(ident);
    } catch {}
    const data = await finalize(env, prompt, ident, found);
    if (!data || !Object.keys(data).length) return json({ erro: "A IA não devolveu uma ficha legível" }, 502);
    if (!data.marca && ident.marca_miniatura) data.marca = ident.marca_miniatura;
    return json(data);
  } catch (err) {
    const msg = String((err && err.message) || err);
    if (/rate|limit|429/i.test(msg)) return json({ erro: "Muitas consultas seguidas" }, 429);
    return json({ erro: "A IA não respondeu agora" }, 502);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/ping") return json({ ok: true, ia: Boolean(env.AI || env.ANTHROPIC_API_KEY), motor: env.ANTHROPIC_API_KEY ? "claude" : "workers-ai", nuvem: Boolean(env.COLECAO) });
    if (/^\/api\/(sync|carro\/|listas)/.test(url.pathname)) return handleSync(request, env, url);
    if (url.pathname === "/api/ficha") {
      if (request.method !== "POST") return json({ erro: "Use POST" }, 405);
      return handleFicha(request, env);
    }
    return env.ASSETS.fetch(request);
  },
};
