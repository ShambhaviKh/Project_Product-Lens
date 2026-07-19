require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cheerio = require('cheerio');

const app = express();
const PORT = process.env.PORT || 3000;
const MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

if (!process.env.GROQ_API_KEY) {
  console.warn(
    '\n⚠️  No GROQ_API_KEY found. Copy .env.example to .env and add your free key from https://console.groq.com/keys\n'
  );
}

async function callGroq(prompt) {
  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.4,
      max_tokens: 4000,
      response_format: { type: 'json_object' },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Groq API error (${res.status}): ${errText.slice(0, 300)}`);
  }

  const data = await res.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error('No text response from Groq.');
  return text;
}

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ---------- helpers ----------

function normalizeUrl(input) {
  let url = input.trim();
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  return new URL(url).toString();
}

async function fetchHtml(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 PMAuditorBot/1.0',
        Accept: 'text/html,application/xhtml+xml',
      },
    });
    clearTimeout(timeout);
    if (!res.ok) {
      throw new Error(`Site responded with ${res.status} ${res.statusText}`);
    }
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) {
      throw new Error(`URL did not return an HTML page (got "${contentType}")`);
    }
    return { html: await res.text(), finalUrl: res.url };
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') {
      throw new Error('Timed out fetching the site (15s). It may be slow or blocking bots.');
    }
    throw err;
  }
}

// Pull out the structural + content signals a PM would actually look at.
function extractSignals(html, finalUrl) {
  const $ = cheerio.load(html);
  $('script, style, noscript, svg').remove();

  const title = $('title').first().text().trim();
  const metaDescription = $('meta[name="description"]').attr('content') || '';
  const viewport = $('meta[name="viewport"]').attr('content') || '';
  const h1s = $('h1').map((_, el) => $(el).text().trim()).get().filter(Boolean);
  const h2s = $('h2').map((_, el) => $(el).text().trim()).get().filter(Boolean).slice(0, 15);

  const buttons = $('button, a.button, a.btn, [role="button"]')
    .map((_, el) => $(el).text().trim())
    .get()
    .filter(Boolean)
    .slice(0, 25);

  const forms = $('form').length;
  const formFields = $('form input, form select, form textarea').length;

  const images = $('img');
  const imagesTotal = images.length;
  const imagesMissingAlt = images.filter((_, el) => !$(el).attr('alt')?.trim()).length;

  const navLinks = $('nav a, header a')
    .map((_, el) => $(el).text().trim())
    .get()
    .filter(Boolean)
    .slice(0, 20);

  const footerLinks = $('footer a').length;

  const allLinks = $('a[href]');
  let internalLinks = 0;
  let externalLinks = 0;
  const host = (() => {
    try {
      return new URL(finalUrl).host;
    } catch {
      return '';
    }
  })();
  allLinks.each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    try {
      const linkHost = new URL(href, finalUrl).host;
      if (linkHost === host) internalLinks++;
      else externalLinks++;
    } catch {
      /* relative/anchor/mailto - ignore */
    }
  });

  const bodyText = $('body').text().replace(/\s+/g, ' ').trim();
  const wordCount = bodyText.split(' ').filter(Boolean).length;

  // Truncate the visible text so the LLM sees real copy without blowing up the prompt.
  const visibleTextSample = bodyText.slice(0, 6000);

  return {
    finalUrl,
    title,
    metaDescription,
    hasViewportMeta: Boolean(viewport),
    h1s,
    h2s,
    buttons,
    forms,
    formFields,
    imagesTotal,
    imagesMissingAlt,
    navLinks,
    footerLinks,
    internalLinks,
    externalLinks,
    wordCount,
    visibleTextSample,
  };
}

function buildPrompt(signals) {
  return `You are a senior product manager and UX strategist. You've been handed a live website to audit, based on its rendered HTML structure and visible copy (no screenshot). Give a sharp, specific, non-generic product audit — as if you were preparing notes for a founder before a roadmap review.

SITE DATA
URL: ${signals.finalUrl}
Title: ${signals.title || '(none found)'}
Meta description: ${signals.metaDescription || '(none found)'}
Has mobile viewport meta tag: ${signals.hasViewportMeta}
H1 headings: ${JSON.stringify(signals.h1s)}
H2 headings (sample): ${JSON.stringify(signals.h2s)}
Buttons / CTAs found: ${JSON.stringify(signals.buttons)}
Number of <form> elements: ${signals.forms}
Total form fields across those forms: ${signals.formFields}
Nav/header links (sample): ${JSON.stringify(signals.navLinks)}
Footer link count: ${signals.footerLinks}
Internal links: ${signals.internalLinks}, External links: ${signals.externalLinks}
Total images: ${signals.imagesTotal}, images missing alt text: ${signals.imagesMissingAlt}
Approx. visible word count: ${signals.wordCount}

VISIBLE PAGE TEXT (truncated sample):
"""
${signals.visibleTextSample}
"""

TASK
Analyze this as a product manager would: infer who the page is for, what job it's trying to get done, and where it helps or hurts that job. Base every claim on the data above — don't invent features you can't see evidence of. If something is ambiguous, say so rather than guessing confidently.

Respond with ONLY a single valid JSON object (no markdown fences, no commentary before or after) matching exactly this shape:

{
  "inferredPurpose": "one or two sentences on what this page/product is and who it's for",
  "overallScore": <integer 0-100, overall product/UX health>,
  "summary": "3-4 sentence executive summary of the audit, in plain language",
  "scores": {
    "clarity": <0-10, how clear the value prop and messaging are>,
    "trust": <0-10, credibility signals, social proof, transparency>,
    "conversionPath": <0-10, how easy it is to get from landing to the key action>,
    "mobileReadiness": <0-10, based on viewport meta and structural signals>,
    "contentQuality": <0-10, copy quality and information scent>
  },
  "workingWell": [
    { "title": "short label", "detail": "1-2 sentences on why this works, referencing specific evidence" }
  ],
  "improvements": [
    { "title": "short label", "priority": "high" | "medium" | "low", "detail": "1-2 sentences: what's wrong and the specific fix" }
  ],
  "userJourney": [
    { "stage": "e.g. Landing", "action": "what the user does/sees at this step", "friction": "the specific friction point here, or null if none evident", "opportunity": "what would improve this step" }
  ]
}

Include 3-5 items in "workingWell", 4-7 items in "improvements" (mix of priorities, most important first), and 4-6 steps in "userJourney" that trace a realistic path a new visitor would take through this page toward its main goal.`;
}

function safeParseJson(text) {
  let cleaned = text.trim();
  // strip markdown fences if the model adds them despite instructions
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  }
  return JSON.parse(cleaned);
}

// ---------- routes ----------

app.post('/api/analyze', async (req, res) => {
  const { url } = req.body || {};
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Please provide a URL.' });
  }

  let normalized;
  try {
    normalized = normalizeUrl(url);
  } catch {
    return res.status(400).json({ error: "That doesn't look like a valid URL." });
  }

  try {
    const { html, finalUrl } = await fetchHtml(normalized);
    const signals = extractSignals(html, finalUrl);

    if (!process.env.GROQ_API_KEY) {
      return res.status(500).json({
        error: 'Server is missing GROQ_API_KEY. Get a free one at https://console.groq.com/keys, add it to .env, and restart the server.',
      });
    }

    const prompt = buildPrompt(signals);
    const rawText = await callGroq(prompt);

    let audit;
    try {
      audit = safeParseJson(rawText);
    } catch (parseErr) {
      console.error('Failed to parse model output:', rawText);
      throw new Error('Got a response back but could not parse it as JSON. Try again.');
    }

    res.json({
      url: finalUrl,
      meta: {
        title: signals.title,
        metaDescription: signals.metaDescription,
        wordCount: signals.wordCount,
        imagesTotal: signals.imagesTotal,
        imagesMissingAlt: signals.imagesMissingAlt,
        forms: signals.forms,
        hasViewportMeta: signals.hasViewportMeta,
      },
      audit,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Something went wrong analyzing that site.' });
  }
});

app.listen(PORT, () => {
  console.log(`\n🔎 PM Website Auditor running at http://localhost:${PORT}\n`);
});
