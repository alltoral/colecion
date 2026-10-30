# Coleção Neon

Catálogo pessoal de carrinhos colecionáveis (Hot Wheels, Matchbox, Majorette, Maisto e outras marcas) em formato de parede de loja. Cada carrinho é uma cartela pendurada, na cor dele, com nome, ano, marca, número da mini `MINI-0000`, status e conservação.

Funciona como site e como aplicativo instalável (PWA) no celular e no computador.

## Publicar no Cloudflare Workers (com IA)

É o jeito recomendado: o mesmo Worker serve o app e a rota de IA `/api/ficha`, que usa o **Workers AI** do próprio Cloudflare (sem chave de API separada).

1. No painel do Cloudflare, vá em **Workers & Pages → Create → Import a repository** e escolha `alltoral/colecion`.
2. Deixe o comando de deploy como `npx wrangler deploy` (a configuração está em `wrangler.jsonc`).
3. Ao terminar, o app fica em `https://colecion.SEU-SUBDOMINIO.workers.dev`. Cada push na branch `main` publica de novo.

O que a IA faz: lê a foto (ou o que você falou/digitou) e devolve nome, marca, série, ano, cor, tipo, status e conservação. Modelos usados: `llama-4-scout` para foto e `llama-3.3-70b` para texto, definidos no topo de `worker/index.js`.

## Publicar no GitHub Pages (sem IA)

1. O código já está neste repositório (`alltoral/colecion`).
2. No GitHub, vá em **Settings → Pages**, escolha **Deploy from a branch**, branch `main`, pasta `/ (root)`.
3. Em alguns minutos o app fica em `https://alltoral.github.io/colecion/`.

## Instalar como aplicativo

- **Android (Chrome):** abra o link e toque em **Instalar app** (ou menu ⋮ → Adicionar à tela inicial).
- **iPhone (Safari):** abra o link, toque em **Compartilhar → Adicionar à Tela de Início**.
- **Computador (Chrome ou Edge):** clique no ícone de instalar na barra de endereço.

Depois de instalado, o app abre em tela cheia e funciona sem internet.

## Onde ficam os dados

- **App instalado / GitHub Pages:** a coleção fica salva no próprio aparelho (IndexedDB). Use **Menu → Salvar cópia de segurança** de vez em quando, e **Restaurar cópia** para levar a coleção para outro aparelho.
- **Dentro do Claude:** a coleção fica sincronizada na nuvem do Claude e o assistente de IA (identificar pela foto, preencher por voz ou texto) fica ativo.

> O assistente de IA funciona dentro do Claude e na versão publicada no Cloudflare. No GitHub Pages ele fica oculto, porque o Pages não executa a rota de IA.

## Estrutura

```
index.html              o app inteiro (HTML, CSS e JS)
worker/index.js         Worker do Cloudflare: serve o app e a IA (/api/ficha)
wrangler.jsonc          configuração do Cloudflare
manifest.webmanifest    dados para instalar como app
sw.js                   cache offline
icons/                  ícones do app
banners/                banners opcionais de cada página (ver banners/README.md)
```

## Fotos

Use fotos com fundo branco (imagens de loja funcionam bem). Ao subir a foto, o app:

1. encontra o carrinho na imagem e corta as sobras;
2. centraliza e apoia o carrinho na mesma linha, no mesmo tamanho de todas as cartelas;
3. lê a cor predominante e aplica na cartela (dá para ajustar no seletor de cor).

## Navegação

- `#parede` parede completa
- `#marca-hot-wheels`, `#marca-matchbox`, ... página de cada marca
- `#wishlist` lista de sonhos
