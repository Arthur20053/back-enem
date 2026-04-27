# Backend Render — ENEM + Gemini API

Este projeto é o backend separado do site de questões do ENEM. Ele roda no Render e chama a Gemini API de forma segura, sem expor a chave no GitHub Pages.

## 1. O que este backend faz

- Recebe uma questão enviada pelo site.
- Envia o texto da questão para a Gemini API.
- Retorna uma explicação em português para o estudante.
- Protege a chave `GEMINI_API_KEY` no Render.
- Tem limite diário simples por IP para evitar abuso da cota grátis.

## 2. Arquivos principais

```txt
server.js
package.json
.env.example
.gitignore
README.md
```

## 3. Como subir no Render

1. Crie um repositório no GitHub só para este backend.
2. Suba somente os arquivos desta pasta `render-backend`.
3. No Render, clique em **New > Web Service**.
4. Conecte o repositório do backend.
5. Configure:

```txt
Build Command:
npm install
```

```txt
Start Command:
npm start
```

6. Em **Environment Variables**, adicione:

```txt
GEMINI_API_KEY=sua_chave_do_gemini
GEMINI_MODEL=gemini-2.5-flash
ALLOWED_ORIGINS=https://seu-usuario.github.io
DAILY_EXPLAIN_LIMIT=60
```

Troque `https://seu-usuario.github.io` pelo link real do seu GitHub Pages. Se quiser liberar temporariamente para testar, use:

```txt
ALLOWED_ORIGINS=*
```

Depois, troque para o domínio certo.

## 4. Como testar se está funcionando

Depois do deploy, abra:

```txt
https://seu-backend.onrender.com/api/health
```

Você deve ver algo parecido com:

```json
{
  "ok": true,
  "provider": "gemini",
  "model": "gemini-2.5-flash",
  "hasGeminiKey": true,
  "dailyExplainLimit": 60
}
```

Se `hasGeminiKey` aparecer `false`, a variável `GEMINI_API_KEY` não foi configurada corretamente no Render.

## 5. Ligar o backend ao site

Quando o Render gerar seu link, copie ele e coloque no arquivo do site:

```txt
github-pages-site/assets/config.js
```

Exemplo:

```js
window.APP_CONFIG = {
  BACKEND_URL: "https://seu-backend.onrender.com",
  ENEM_API_BASE: "https://api.enem.dev/v1"
};
```

Não coloque a chave Gemini no projeto do site.
