import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";

const app = express();

const PORT = process.env.PORT || 10000;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const DAILY_EXPLAIN_LIMIT = Number(process.env.DAILY_EXPLAIN_LIMIT || 60);
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "*")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const usageByIp = new Map();

if (!GEMINI_API_KEY) {
  console.warn("Aviso: GEMINI_API_KEY não está configurada.");
}

app.use(helmet({
  crossOriginResourcePolicy: false
}));

app.use(express.json({ limit: "1mb" }));

app.use(cors({
  origin(origin, callback) {
    if (!origin || ALLOWED_ORIGINS.includes("*") || ALLOWED_ORIGINS.includes(origin)) {
      callback(null, true);
      return;
    }

    callback(new Error(`Origem não permitida pelo CORS: ${origin}`));
  }
}));

app.get("/", (_req, res) => {
  res.json({
    ok: true,
    name: "ENEM Gemini Render Backend",
    routes: ["/api/health", "/api/explain"]
  });
});

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    provider: "gemini",
    model: GEMINI_MODEL,
    hasGeminiKey: Boolean(GEMINI_API_KEY),
    dailyExplainLimit: DAILY_EXPLAIN_LIMIT
  });
});

app.post("/api/explain", async (req, res) => {
  try {
    const limitResult = checkDailyLimit(req);
    if (!limitResult.ok) {
      return res.status(429).json({
        error: `Limite diário de explicações atingido para este acesso. Tente novamente amanhã.`
      });
    }

    const { question, selectedLetter, correctLetter } = req.body || {};

    if (!question || !correctLetter) {
      return res.status(400).json({
        error: "Envie question e correctLetter no corpo da requisição."
      });
    }

    if (!GEMINI_API_KEY) {
      return res.status(500).json({
        error: "GEMINI_API_KEY não foi configurada no Render."
      });
    }

    const prompt = buildPrompt({ question, selectedLetter, correctLetter });
    const explanation = await askGemini(prompt);

    if (!explanation) {
      return res.status(502).json({
        error: "O Gemini respondeu sem texto útil."
      });
    }

    res.json({ explanation });
  } catch (error) {
    console.error(error);

    const status = error.status || 500;
    const message = error.message || "Erro interno no backend.";

    res.status(status >= 400 && status < 600 ? status : 500).json({
      error: message
    });
  }
});

async function askGemini(prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [
          {
            text: "Você é um professor brasileiro especialista no ENEM. Explique questões com clareza, sem inventar dados e sem alongar demais. Responda sempre em português do Brasil."
          }
        ]
      },
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }]
        }
      ],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 900
      }
    })
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = data?.error?.message || `Erro do Gemini: HTTP ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }

  return data?.candidates?.[0]?.content?.parts
    ?.map((part) => part.text || "")
    .join("\n")
    .trim();
}

function buildPrompt({ question, selectedLetter, correctLetter }) {
  const alternatives = Array.isArray(question.alternatives)
    ? question.alternatives.map((alt) => `${alt.letter}) ${alt.text || ""}`).join("\n")
    : "";

  return `
Explique esta questão do ENEM para um estudante.

Dados:
- Título: ${question.title || "Questão do ENEM"}
- Ano: ${question.year || "não informado"}
- Área: ${question.discipline || "não informada"}
- Assunto estimado: ${question.topic || "não informado"}
- Dificuldade estimada: ${question.difficulty || "não informada"}
- Alternativa marcada pelo estudante: ${selectedLetter || "não marcada"}
- Alternativa correta: ${correctLetter}

Enunciado:
${question.context || "Enunciado não informado em texto. Pode haver imagem na questão original."}

Comando/introdução das alternativas:
${question.alternativesIntroduction || ""}

Alternativas:
${alternatives}

Quero a resposta no seguinte formato:

1. Resultado:
Diga se a pessoa acertou ou errou.

2. Assunto:
Diga o assunto principal cobrado na questão.

3. Como resolver:
Explique passo a passo como chegar na alternativa correta.

4. Por que as outras estão erradas:
Comente rapidamente, quando for possível.

5. Dica ENEM:
Dê uma dica curta para reconhecer esse tipo de questão em outras provas.

Não invente texto de imagem que você não recebeu. Se faltar informação visual, avise que a explicação considera apenas o texto enviado.
`.trim();
}

function checkDailyLimit(req) {
  if (!Number.isFinite(DAILY_EXPLAIN_LIMIT) || DAILY_EXPLAIN_LIMIT <= 0) {
    return { ok: true };
  }

  const ip = req.headers["x-forwarded-for"]?.split(",")?.[0]?.trim() || req.ip || "unknown";
  const today = new Date().toISOString().slice(0, 10);
  const key = `${today}:${ip}`;
  const current = usageByIp.get(key) || 0;

  if (current >= DAILY_EXPLAIN_LIMIT) {
    return { ok: false };
  }

  usageByIp.set(key, current + 1);
  return { ok: true };
}

app.listen(PORT, () => {
  console.log(`Backend Gemini rodando na porta ${PORT}`);
});
