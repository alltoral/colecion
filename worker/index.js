// Coleção Neon: Worker do Cloudflare.
// Serve o app (arquivos estáticos) e a rota de IA /api/ficha, que usa o Workers AI
// para ler a foto ou a descrição do carrinho e devolver os campos da ficha em JSON.

const MODEL_VISION = "@cf/meta/llama-4-scout-17b-16e-instruct";
const MODEL_TEXT = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const MAX_IMAGE_CHARS = 1_500_000; // ~1 MB de imagem em base64

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

// Pega o primeiro objeto JSON que aparecer na resposta do modelo.
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

async function runModel(env, prompt, image) {
  const system =
    "Você é um especialista em miniaturas colecionáveis de carros 1:64. Responda apenas com um objeto JSON válido, sem texto antes ou depois.";
  if (image) {
    const out = await env.AI.run(MODEL_VISION, {
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: image } },
          ],
        },
      ],
      max_tokens: 600,
      temperature: 0.2,
    });
    return out?.response ?? out;
  }
  const out = await env.AI.run(MODEL_TEXT, {
    messages: [
      { role: "system", content: system },
      { role: "user", content: prompt },
    ],
    max_tokens: 600,
    temperature: 0.2,
  });
  return out?.response ?? out;
}

async function handleFicha(request, env) {
  if (!env.AI) return json({ erro: "IA não configurada neste Worker" }, 503);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ erro: "Envio inválido" }, 400);
  }
  const prompt = typeof body.prompt === "string" ? body.prompt.slice(0, 6000) : "";
  const image = typeof body.image === "string" && body.image.startsWith("data:image/") ? body.image : null;
  if (!prompt) return json({ erro: "Faltou a descrição" }, 400);
  if (image && image.length > MAX_IMAGE_CHARS) return json({ erro: "Foto grande demais" }, 413);

  try {
    const raw = await runModel(env, prompt, image);
    const data = extractJSON(raw);
    if (!data) return json({ erro: "A IA não devolveu uma ficha legível" }, 502);
    return json(data);
  } catch (err) {
    const msg = String(err && err.message || err);
    if (/rate|limit|429/i.test(msg)) return json({ erro: "Muitas consultas seguidas" }, 429);
    return json({ erro: "A IA não respondeu agora" }, 502);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/ping") return json({ ok: true, ia: Boolean(env.AI) });
    if (url.pathname === "/api/ficha") {
      if (request.method !== "POST") return json({ erro: "Use POST" }, 405);
      return handleFicha(request, env);
    }
    return env.ASSETS.fetch(request);
  },
};
