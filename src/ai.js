'use strict';
/**
 * MIRASHOT — KI-Features (Opt-in, nur auf Klick im Editor).
 * OpenAI-kompatible chat/completions mit image_url (z.B. OpenRouter, Z.ai).
 * Konfiguration ausschliesslich ueber Env: AI_BASE_URL, AI_API_KEY, AI_MODEL.
 * Der Key verlaesst den Server nie und wird nie geloggt.
 */

const PROMPT_ANALYZE = `Du bist MIRA, eine präzise KI-Assistentin. Analysiere den Screenshot.
Antworte AUSSCHLIESSLICH als JSON (kein Markdown, keine Codeblöcke) mit genau diesem Format:
{"description": "<2-4 Sätze Beschreibung des Screenshots auf Deutsch>", "observations": ["<Beobachtung 1>", "<Beobachtung 2>", "<Beobachtung 3>", "..."]}
Gib genau 3 bis 5 Beobachtungen. Beobachtungen sind kurze, sachliche Feststellungen zu Layout, Inhalt, auffälligen Elementen oder potenziellen Problemen. Alles auf Deutsch.`;

const PROMPT_REDACT = `Du bist ein Datenschutz-Assistent. Finde im Screenshot ALLE sensiblen Daten.
Finde: E-Mail-Adressen, Telefonnummern, IBAN/Kontodaten, Namen von Personen, Gesichter.
Antworte AUSSCHLIESSLICH als JSON (kein Markdown, keine Codeblöcke):
{"boxes": [{"x": <0-1>, "y": <0-1>, "w": <0-1>, "h": <0-1>, "label": "<email|phone|iban|name|face>"}]}
Koordinaten sind normalisiert auf Bildbreite/Höhe (x,y = obere linke Ecke). Nur Boxen, die wirklich sensible Daten enthalten. Wenn nichts gefunden: {"boxes": []}`;

const PROMPT_ALT = `Schreibe einen kurzen deutschen Alt-Text für diesen Screenshot.
Antworte AUSSCHLIESSLICH als JSON: {"alt": "<ein Satz, max. 200 Zeichen, sachlich, Deutsch>"}`;

function aiConfigured() {
  return Boolean(process.env.AI_BASE_URL && process.env.AI_API_KEY && process.env.AI_MODEL);
}

function endpoint() {
  const base = (process.env.AI_BASE_URL || '').replace(/\/+$/, '');
  return `${base}/chat/completions`;
}

function stripDataUrl(image) {
  // akzeptiert dataURL oder rohes base64
  const m = /^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/s.exec(image || '');
  return m ? m[2] : String(image || '');
}

async function chat(imageBase64, prompt, maxTokens) {
  const body = {
    model: process.env.AI_MODEL,
    max_tokens: maxTokens,
    temperature: 0.2,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          {
            type: 'image_url',
            image_url: { url: `data:image/png;base64,${imageBase64}` },
          },
        ],
      },
    ],
  };
  const res = await fetch(endpoint(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.AI_API_KEY}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    // Keine Details/Keys in Fehlermeldungen
    throw Object.assign(new Error(`KI-Dienst antwortete mit HTTP ${res.status}`), { status: 502, detail: text.slice(0, 200) });
  }
  const data = await res.json();
  const content = data && data.choices && data.choices[0] && data.choices[0].message
    ? String(data.choices[0].message.content || '')
    : '';
  return content;
}

function parseJsonLoose(content) {
  // Modelle schicken manchmal Markdown-Fences mit -> tolerantes Parsen
  let s = String(content || '').trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/m.exec(s);
  if (fence) s = fence[1].trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start > 0 || end < s.length - 1) s = s.slice(Math.max(start, 0), end + 1);
  return JSON.parse(s);
}

function clamp01(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/** @returns {Promise<{description:string, observations:string[]}>} */
async function analyze(image) {
  const content = await chat(stripDataUrl(image), PROMPT_ANALYZE, 900);
  const parsed = parseJsonLoose(content);
  const observations = Array.isArray(parsed.observations)
    ? parsed.observations.map(String).filter(Boolean).slice(0, 6)
    : [];
  return { description: String(parsed.description || '').trim(), observations };
}

/** @returns {Promise<{boxes:Array<{x:number,y:number,w:number,h:number,label:string}>}>} */
async function redactBoxes(image) {
  const content = await chat(stripDataUrl(image), PROMPT_REDACT, 1200);
  const parsed = parseJsonLoose(content);
  const boxes = (Array.isArray(parsed.boxes) ? parsed.boxes : [])
    .map((b) => ({
      x: clamp01(b.x),
      y: clamp01(b.y),
      w: Math.max(0.004, clamp01(b.w)),
      h: Math.max(0.004, clamp01(b.h)),
      label: String(b.label || 'sensibel').slice(0, 24),
    }))
    .filter((b) => b.w > 0 && b.h > 0)
    .slice(0, 40);
  return { boxes };
}

/** @returns {Promise<{alt:string}>} */
async function altText(image) {
  const content = await chat(stripDataUrl(image), PROMPT_ALT, 300);
  const parsed = parseJsonLoose(content);
  return { alt: String(parsed.alt || '').trim().slice(0, 300) };
}

module.exports = { aiConfigured, analyze, redactBoxes, altText };
