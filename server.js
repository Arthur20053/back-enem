const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const DAILY_EXPLAIN_LIMIT = Number(process.env.DAILY_EXPLAIN_LIMIT || 60);

function originOnly(url){
  try { return new URL(url).origin; } catch { return url; }
}

const allowedOriginsRaw = (process.env.ALLOWED_ORIGINS || '*')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);
const allowedOrigins = allowedOriginsRaw.map(originOnly);

app.use(express.json({ limit: '4mb' }));
app.use(cors({
  origin(origin, cb){
    if(!origin || allowedOrigins.includes('*') || allowedOrigins.includes(originOnly(origin))) return cb(null, true);
    return cb(new Error('Origem não permitida pelo CORS'));
  }
}));

const dailyUsage = new Map();
function todayKey(){ return new Date().toISOString().slice(0, 10); }
function getClientIp(req){ return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown'; }
function checkLimit(req, res, next){
  const key = `${todayKey()}:${getClientIp(req)}`;
  const count = dailyUsage.get(key) || 0;
  if(count >= DAILY_EXPLAIN_LIMIT){
    return res.status(429).json({ error: 'Limite diário de explicações atingido. Tente novamente amanhã.' });
  }
  dailyUsage.set(key, count + 1);
  next();
}

app.get('/', (req, res) => {
  res.json({ ok: true, name: 'ENEM Gemini Backend', health: '/api/health' });
});

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    provider: 'gemini',
    model: GEMINI_MODEL,
    hasGeminiKey: Boolean(GEMINI_API_KEY),
    allowedOrigins,
    dailyExplainLimit: DAILY_EXPLAIN_LIMIT
  });
});

function cleanText(value, max = 6000){
  return String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function buildPrompt(question, selectedLetter){
  const alternatives = (question.alternatives || [])
    .map(a => `${a.letter}) ${cleanText(a.text, 900)}`)
    .join('\n');

  return `Você é um professor especialista no ENEM. Explique a questão abaixo em português brasileiro, com linguagem clara para estudante do ensino médio.

Regras:
- Não invente dados que não estão no enunciado.
- Mostre o assunto principal cobrado.
- Diga por que a alternativa correta está certa.
- Se o aluno marcou uma alternativa errada, diga por que ela não é a melhor resposta.
- Seja didático e objetivo.
- Não cite que você é uma IA.

Dados da questão:
Ano: ${question.year || 'não informado'}
Matéria estimada: ${question.estimatedSubjectName || 'não informada'}
Assunto estimado: ${question.estimatedTopic?.name || 'não informado'}
Dificuldade estimada: ${question.estimatedDifficulty || 'não informada'}

Enunciado:
${cleanText([question.title, question.context, question.alternativesIntroduction].filter(Boolean).join('\n'), 6000)}

Alternativas:
${alternatives}

Alternativa correta: ${question.correctAlternative || 'não informada'}
Alternativa marcada pelo aluno: ${selectedLetter || 'não marcada'}

Responda neste formato:
Assunto cobrado:

Resposta correta:

Explicação passo a passo:

Por que as outras alternativas não são as melhores:

Dica para questões parecidas:`;
}

app.post('/api/explain', checkLimit, async (req, res) => {
  try{
    if(!GEMINI_API_KEY){
      return res.status(500).json({ error: 'GEMINI_API_KEY não configurada no Render.' });
    }
    const { question, selectedLetter } = req.body || {};
    if(!question || !question.correctAlternative){
      return res.status(400).json({ error: 'Envie uma questão válida.' });
    }

    const prompt = buildPrompt(question, selectedLetter);
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.35,
          topP: 0.9,
          maxOutputTokens: 1200
        }
      })
    });

    const data = await response.json().catch(() => ({}));
    if(!response.ok){
      return res.status(response.status).json({ error: data.error?.message || 'Erro ao chamar Gemini.' });
    }
    const explanation = data.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('\n').trim();
    if(!explanation){
      return res.status(502).json({ error: 'Gemini não retornou explicação.' });
    }
    res.json({ explanation, model: GEMINI_MODEL });
  } catch(err){
    console.error(err);
    res.status(500).json({ error: 'Erro interno no backend.' });
  }
});

function safeJsonFromText(text){
  const raw = String(text || '').trim();
  const withoutFence = raw.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  try { return JSON.parse(withoutFence); } catch {}
  const start = withoutFence.indexOf('[');
  const end = withoutFence.lastIndexOf(']');
  if(start >= 0 && end > start){
    return JSON.parse(withoutFence.slice(start, end + 1));
  }
  throw new Error('JSON inválido retornado pela IA');
}

function compactTaxonomy(taxonomy){
  return JSON.stringify(Object.entries(taxonomy || {}).map(([key, value]) => ({
    materia: key,
    nome: value.name,
    assuntos: (value.topics || []).map(t => ({ id: t.id, nome: t.name }))
  })), null, 2);
}

function buildClassifyPrompt(questions, taxonomy){
  return `Classifique questões reais do ENEM usando exatamente a taxonomia abaixo.

TAXONOMIA:
${compactTaxonomy(taxonomy)}

DIFICULDADES PERMITIDAS: facil, media, dificil.

REGRAS:
- Responda somente JSON válido.
- Retorne um array com um objeto por questão.
- Use somente os ids de matéria e assunto existentes na taxonomia.
- Para Matemática e Linguagens, use diretamente matematica ou linguagem quando a área original indicar isso.
- Em Ciências da Natureza, separe com cuidado física, química e biologia.
- Em Ciências Humanas, separe com cuidado filosofia, sociologia, história e geografia.
- Se a questão depender muito de imagem ausente, classifique pelo comando, alternativas e área original.
- Dificuldade deve ser estimada pedagogicamente: facil para interpretação direta, media para relação/conceito, dificil para cálculo/integração de conceitos/alta abstração.

FORMATO EXATO:
[
  {"id":"...","materia":"fisica","assunto":"ondas","dificuldade":"media","confianca":0.82,"observacao":"curta"}
]

QUESTÕES:
${JSON.stringify(questions, null, 2)}`;
}

app.post('/api/classify', async (req, res) => {
  try{
    if(!GEMINI_API_KEY){
      return res.status(500).json({ error: 'GEMINI_API_KEY não configurada no Render.' });
    }
    const { questions, taxonomy } = req.body || {};
    if(!Array.isArray(questions) || !questions.length){
      return res.status(400).json({ error: 'Envie um array de questões.' });
    }
    if(questions.length > 25){
      return res.status(400).json({ error: 'Envie no máximo 25 questões por lote.' });
    }

    const prompt = buildClassifyPrompt(questions, taxonomy || {});
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.1,
          topP: 0.8,
          maxOutputTokens: 5000,
          responseMimeType: 'application/json'
        }
      })
    });

    const data = await response.json().catch(() => ({}));
    if(!response.ok){
      return res.status(response.status).json({ error: data.error?.message || 'Erro ao chamar Gemini.' });
    }
    const text = data.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('\n').trim();
    if(!text) return res.status(502).json({ error: 'Gemini não retornou classificação.' });

    const classifications = safeJsonFromText(text);
    if(!Array.isArray(classifications)) return res.status(502).json({ error: 'Classificação não veio como array.' });
    res.json({ classifications, model: GEMINI_MODEL });
  } catch(err){
    console.error(err);
    res.status(500).json({ error: 'Erro interno ao classificar questões.' });
  }
});
app.listen(PORT, () => console.log(`ENEM Gemini backend rodando na porta ${PORT}`));
