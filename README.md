# Coleção Neon

Catálogo pessoal de carrinhos colecionáveis (Hot Wheels, Matchbox, Majorette, Maisto e outras marcas) em formato de parede de loja. Cada carrinho é uma cartela pendurada, na cor dele, com nome, ano, marca, número da mini `MINI-0000`, status e conservação.

Funciona como site e como aplicativo instalável (PWA) no celular e no computador.

## Publicar no GitHub Pages

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

> O assistente de IA usa o Claude e por isso só funciona na versão aberta dentro do Claude. Para ter IA e sincronização entre aparelhos na versão do GitHub, o próximo passo é ligar um backend (por exemplo Supabase ou Firebase para os dados, e uma função serverless com a API da Anthropic para a IA).

## Estrutura

```
index.html              o app inteiro (HTML, CSS e JS)
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
