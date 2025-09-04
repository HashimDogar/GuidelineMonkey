// server.js (CommonJS) — keeps your static server, adds structured JSON output
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const localDir = path.join(__dirname, 'local_ocr');
const frontendDir = path.join(__dirname, 'frontend');

// ---- helpers ----
function findLocalGuidelines(query) {
  const terms = (query || '').toLowerCase().split(/\s+/).filter(Boolean);
  const files = fs.existsSync(localDir) ? fs.readdirSync(localDir) : [];
  return files
    .filter(f => terms.some(t => f.toLowerCase().includes(t)))
    .map(f => ({
      title: f.replace(/_ocr\.pdf$/i, '').replace(/_/g, ' '),
      file: f,
      link: `/local/${encodeURIComponent(f)}`
    }));
}
const norm = s =>
  (s || '').toLowerCase().replace(/[\s_-]+/g, '').replace(/[^a-z0-9]/g, '');

async function callPhi3Structured(userQuery, localTitles) {
  const prompt = `
You are Guideline Monkey. Answer UK-clinically with priority: Local → NICE → Cochrane.
Return ONLY valid JSON (UTF-8), no markdown, no backticks, no commentary.

Schema:
{
  "summary": string,
  "local": {
    "guideline": {
      "title": string,
      "summary": string,
      "url": string,
      "applicability": "specific" | "most_applicable" | "none"
    },
    "decision_tree": [{"if": string, "then": string, "note"?: string}],
    "recommended_investigations": string[],
    "recommended_management": string[],
    "links": [{"title": string, "url": string}]
  },
  "national": {
    "nice_summary": string,
    "recommended_investigations": string[],
    "recommended_management": string[],
    "cks_link": string
  },
  "systematic_review": {
    "summary": string,
    "link": string,
    "citation"?: string
  }
}

Rules:
- Bind local + national guidance in the top-level "summary" (2–5 sentences). Cite key RCTs or reviews briefly.
- Local: If a specific local guideline exists, set applicability="specific"; else use the most applicable and set applicability="most_applicable"; if none, set applicability="none".
- Provide a practical decision_tree of IF/THEN steps (2–6 items).
- National: Summarise NICE for the exact query; list investigations and management succinctly; include the most relevant NICE CKS link.
- Systematic_review: Select the single most relevant Cochrane review and summarise.
- Use UK terminology (BNF/NICE). Prefer concise bullet phrases. No unsafe or speculative recommendations.
- Output MUST be strictly valid JSON.

User query:
${userQuery}

Available local guideline titles (choose one if applicable; use the exact title):
${localTitles.map(t => `- ${t}`).join('\n')}
`;

  const body = { model: 'phi3:mini', prompt, stream: false };
  const resp = await fetch('http://localhost:11434/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!resp.ok) throw new Error(`Ollama error ${resp.status}`);
  const data = await resp.json();
  let text = (data.response || '').trim();

  // parse as JSON, fallback to first {...} block
  try {
    return JSON.parse(text);
  } catch {
    const first = text.indexOf('{');
    const last = text.lastIndexOf('}');
    if (first !== -1 && last !== -1) {
      return JSON.parse(text.slice(first, last + 1));
    }
    throw new Error('Model did not return valid JSON.');
  }
}

// ---- server ----
const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);

  // API: structured response
  if (req.method === 'POST' && parsedUrl.pathname === '/api/guidelines') {
    let body = '';
    req.on('data', c => (body += c));
    req.on('end', async () => {
      try {
        const { prompt = '' } = JSON.parse(body || '{}');
        if (!prompt.trim()) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Missing prompt' }));
        }

        // 1) find local PDFs
        const localMatches = findLocalGuidelines(prompt);
        const localTitles = localMatches.map(g => g.title);

        // 2) ask Phi-3 for the STRUCTURED JSON
        let out = await callPhi3Structured(prompt, localTitles);

        // 3) enrich/merge with real local links (+ sensible fallbacks)
        out = out && typeof out === 'object' ? out : {};
        out.local = out.local && typeof out.local === 'object' ? out.local : {};

        // attach up to 3 local links from real files
        const links = localMatches.slice(0, 3).map(({ title, link }) => ({ title, url: link }));
        out.local.links = links;

        // if model picked a local guideline by title, attach its real /local URL
        if (out.local.guideline && out.local.guideline.title && !out.local.guideline.url) {
          const m = localMatches.find(f => norm(f.title) === norm(out.local.guideline.title));
          if (m) out.local.guideline.url = m.link;
        }

        // if model said no applicable guideline, ensure a minimal shape
        if (!out.local.guideline) {
          out.local.guideline = {
            title: localMatches[0]?.title || 'No applicable local guideline',
            summary: localMatches.length ? 'Most applicable local document selected by filename match.' : '',
            url: localMatches[0]?.link || '',
            applicability: localMatches.length ? 'most_applicable' : 'none'
          };
        }

        // national fallbacks
        out.national = out.national && typeof out.national === 'object' ? out.national : {};
        if (!out.national.cks_link) {
          out.national.cks_link = `https://cks.nice.org.uk/search?query=${encodeURIComponent(prompt)}`;
        }

        // systematic review fallback
        out.systematic_review =
          out.systematic_review && typeof out.systematic_review === 'object'
            ? out.systematic_review
            : {};
        if (!out.systematic_review.link) {
          out.systematic_review.link = `https://www.cochranelibrary.com/search?searchPhrase=${encodeURIComponent(
            prompt
          )}`;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(out));
      } catch (err) {
        console.error(err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ summary: 'Request failed.' }));
      }
    });
    return;
  }

  // Serve local PDFs
  if (parsedUrl.pathname.startsWith('/local/')) {
    const filePath = path.join(localDir, decodeURIComponent(parsedUrl.pathname.replace('/local/', '')));
    return fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404); res.end('Not found');
      } else {
        res.writeHead(200, { 'Content-Type': 'application/pdf' });
        res.end(data);
      }
    });
  }

  // Static frontend
  let filePath = path.join(frontendDir, parsedUrl.pathname === '/' ? 'index.html' : parsedUrl.pathname);
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404); return res.end('Not found');
    }
    const ext = path.extname(filePath).toLowerCase();
    const typeMap = {
      '.html': 'text/html',
      '.js': 'application/javascript',
      '.jsx': 'application/javascript',
      '.css': 'text/css',
      '.json': 'application/json'
    };
    const type = typeMap[ext] || 'text/plain';
    res.writeHead(200, { 'Content-Type': type });
    res.end(data);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
