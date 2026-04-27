# Backend ENEM Gemini — Render

Backend Node/Express para gerar explicações com Gemini sem expor a chave no GitHub Pages.

## Render

Crie um Web Service apontando para este repositório.

Build Command:

```txt
npm install
```

Start Command:

```txt
npm start
```

## Variáveis de ambiente

```txt
GEMINI_API_KEY=sua_chave_do_google_ai_studio
GEMINI_MODEL=gemini-2.5-flash
ALLOWED_ORIGINS=https://seuusuario.github.io
DAILY_EXPLAIN_LIMIT=60
```

Durante testes, você pode usar:

```txt
ALLOWED_ORIGINS=*
```

Depois troque pelo domínio do GitHub Pages.

## Teste

Abra:

```txt
https://seu-backend.onrender.com/api/health
```

Deve aparecer `ok: true` e `hasGeminiKey: true`.
