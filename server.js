// server.js (CommonJS) — keeps your static server, adds structured JSON output
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const JSON5 = require('json5');

const localDir = path.join(__dirname, 'local_ocr');
const frontendDir = path.join(__dirname, 'frontend');

// ---- helpers ----
function detectAudience(text = '') {
  const s = text.toLowerCase();
  if (/(pregnan|antenatal|obstetric|maternal)/.test(s)) return 'pregnancy';
  if (/(paedi|pedi|child|infant|neonat)/.test(s)) return 'paediatric';
  return 'adult';
}

function findLocalGuidelines(query, audience = 'adult') {
  const terms = (query || '').toLowerCase().split(/\s+/).filter(Boolean);
  const files = fs.existsSync(localDir) ? fs.readdirSync(localDir) : [];
  const matches = files
    .filter(f => terms.some(t => f.toLowerCase().includes(t)))
    .map(f => ({
      title: f.replace(/_ocr\.pdf$/i, '').replace(/_/g, ' '),
      file: f,
      link: `/local/${encodeURIComponent(f)}`,
      audience: detectAudience(f)
    }));
  const primary = matches.filter(m => m.audience === audience);
  return { all: matches, primary };
}
const norm = s =>
  (s || '').toLowerCase().replace(/[\s_-]+/g, '').replace(/[^a-z0-9]/g, '');

async function callPhi3Structured(userQuery, localTitles, include = {}) {
  const sections = [];
  if (include.local) {
    sections.push(`"local": {\n      "guideline": {"title": string, "summary": string, "url": string, "applicability": "specific" | "most_applicable" | "none"},\n      "decision_tree": [{"if": string, "then": string, "note"?: string}],\n      "admission_criteria": string[],\n      "recommended_investigations": string[],\n      "recommended_management": string[],\n      "links": [{"title": string, "url": string}]\n    }`);
  }
  if (include.national) {
    sections.push(`"national": {\n      "decision_tree": [{"if": string, "then": string, "note"?: string}],\n      "nice_summary": string,\n      "admission_criteria": string[],\n      "recommended_investigations": string[],\n      "recommended_management": string[],\n      "cks_link": string\n    }`);
  }
  const schema = `{
    "summary": string${sections.length ? ',\n    ' + sections.join(',\n    ') : ''}
  }`;

  let rules = `- Use UK terminology (BNF/NICE). Prefer concise bullet phrases. No unsafe or speculative recommendations.\n- Output MUST be strictly valid JSON.`;
  if (include.local || include.national) {
    const bind = [];
    if (include.local) bind.push('local');
    if (include.national) bind.push('national');
    rules = `- Bind ${bind.join(' + ')} guidance in the top-level "summary" (2–5 sentences).` +
      (include.local ? `\n- Local: If a specific local guideline exists, set applicability="specific"; else use the most applicable and set applicability="most_applicable"; if none, set applicability="none".\n- Provide a practical decision_tree of IF/THEN steps (2–6 items).\n- List admission_criteria for when hospital admission is required.` : '') +
      (include.national ? `\n- National: Summarise NICE for the exact query; list admission_criteria for hospital admission; list investigations and management succinctly; include the most relevant NICE CKS link.` : '') +
      `\n- Audience: doctors in an acute hospital caring for acutely unwell patients (not primary care).\n- Use UK terminology (BNF/NICE). Prefer concise bullet phrases. No unsafe or speculative recommendations.\n- Output MUST be strictly valid JSON.`;
  }

  const priority = [include.local && 'Local', include.national && 'NICE'].filter(Boolean).join(' → ');

  const prompt = `
  You are Guideline Monkey. Answer UK-clinically with priority: ${priority}.
  Return ONLY a single minified JSON object. No markdown. No code fences. No comments. No trailing commas.

  Schema:
  ${schema}

  Rules:
  ${rules}

  User query:
  ${userQuery}

  Available local guideline titles (choose one if applicable; use the exact title):
  ${localTitles.map(t => `- ${t}`).join('\n')}
  `;
  
    // Ask Ollama; format:'json' helps some models be strict; ok to remove if your build errors
    const body = { model: 'llama3.1:8b-instruct-q8_0', prompt, stream: false, format: 'json', options: { temperature: 0 } };
  
    const resp = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!resp.ok) throw new Error(`Ollama error ${resp.status}`);
    const data = await resp.json();
    const raw = (data.response || '').trim();
  
    // Robust parse: try JSON → fenced blocks → first {...} → JSON5 → trailing comma fix
    const tryParseStrict = (s) => { try { return JSON.parse(s); } catch { return null; } };
    const tryParseJSON5  = (s) => { try { return JSON5.parse(s); } catch { return null; } };
  
    // 1) direct
    let obj = tryParseStrict(raw);
    if (obj) return obj;
  
    // 2) ```json ... ```
    const fence = raw.match(/```json\s*([\s\S]*?)```/i) || raw.match(/```\s*([\s\S]*?)```/);
    if (fence && fence[1]) {
      obj = tryParseStrict(fence[1].trim()) || tryParseJSON5(fence[1].trim());
      if (obj) return obj;
    }
  
    // 3) between <json>...</json>
    const tag = raw.match(/<json>([\s\S]*?)<\/json>/i);
    if (tag && tag[1]) {
      obj = tryParseStrict(tag[1].trim()) || tryParseJSON5(tag[1].trim());
      if (obj) return obj;
    }
  
    // 4) first {...last}
    const first = raw.indexOf('{');
    const last  = raw.lastIndexOf('}');
    if (first !== -1 && last !== -1 && last > first) {
      const slice = raw.slice(first, last + 1);
      obj = tryParseStrict(slice) || tryParseJSON5(slice);
      if (obj) return obj;
  
      // 5) quick trailing-comma fixer then retry
      const noTrailingCommas = slice.replace(/,\s*([}\]])/g, '$1');
      obj = tryParseStrict(noTrailingCommas) || tryParseJSON5(noTrailingCommas);
      if (obj) return obj;
    }
  
    // Log a snippet for debugging and throw
    console.error('Model output (first 800 chars):\n', raw.slice(0, 800));
    throw new Error('Model did not return valid JSON.');
  }

async function fetchPubMed(query, audience = 'adult') {
  try {
    let base = `${query} [Title/Abstract]`;
    if (audience === 'adult') {
      base += ' AND adult[MeSH Terms]';
    } else if (audience === 'paediatric') {
      base += ' AND (child[MeSH Terms] OR infant[MeSH Terms])';
    } else if (audience === 'pregnancy') {
      base += ' AND pregnancy[MeSH Terms]';
    }
    const ids = [];

    async function search(term) {
      const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${encodeURIComponent(term)}&retmode=json&retmax=5&sort=cited`;
      const resp = await fetch(url);
      if (!resp.ok) return [];
      const data = await resp.json();
      return data.esearchresult?.idlist || [];
    }

    // Prefer systematic reviews
    for (const id of await search(`${base} AND systematic[sb]`)) {
      if (!ids.includes(id)) ids.push(id);
    }

    // Then fill with randomized controlled trials if needed
    if (ids.length < 3) {
      for (const id of await search(`${base} AND randomized controlled trial[pt]`)) {
        if (!ids.includes(id)) ids.push(id);
        if (ids.length >= 3) break;
      }
    }

    if (!ids.length) return [];

    const summaryUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${ids.join(',')}&retmode=json`;
    const sumResp = await fetch(summaryUrl);
    if (!sumResp.ok) return [];
    const sumData = await sumResp.json();

    const out = [];
    for (const id of ids.slice(0, 3)) {
      const title = sumData.result?.[id]?.title || `PubMed ${id}`;
      let summary = '';
      try {
        const efetchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=${id}&retmode=xml&rettype=abstract`;
        const fResp = await fetch(efetchUrl);
        if (fResp.ok) {
          const text = await fResp.text();
          const matches = [...text.matchAll(/<AbstractText[^>]*>([\s\S]*?)<\/AbstractText>/g)];
          summary = matches.map(m => m[1]).join(' ').replace(/<[^>]+>/g, '');
        }
      } catch (err) {
        console.error(err);
      }
      summary = summary.replace(/\s+/g, ' ').trim();
      if (summary) {
        const sentences = summary.split(/(?<=[.!?])\s+/).slice(0, 2);
        summary = sentences.join(' ');
      }
      const url = `https://pubmed.ncbi.nlm.nih.gov/${id}/`;
      out.push({ title, summary, url });
    }
    return out;
  } catch (e) {
    console.error(e);
    return [];
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
        const { prompt = '', include = {} } = JSON.parse(body || '{}');
        const incLocal = include.local !== false;
        const incNational = include.national !== false;
        const incLiterature = include.literature !== false;
        if (!prompt.trim()) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Missing prompt' }));
        }

        const audience = detectAudience(prompt);
        const { all: allLocalMatches, primary: localMatches } = incLocal
          ? findLocalGuidelines(prompt, audience)
          : { all: [], primary: [] };
        const localTitles = localMatches.map(g => g.title);

        const modelPrompt = audience === 'adult' ? `${prompt} in adults` : prompt;

        // 2) ask model for structured JSON if local or national requested
        let out = {};
        if (incLocal || incNational) {
          out = await callPhi3Structured(modelPrompt, localTitles, { local: incLocal, national: incNational });
        }

        out = out && typeof out === 'object' ? out : {};

        // 3) enrich local results
        if (incLocal) {
          out.local = out.local && typeof out.local === 'object' ? out.local : {};
          const links = allLocalMatches.slice(0, 3).map(({ title, link }) => ({ title, url: link }));
          out.local.links = links;

          if (out.local.guideline && out.local.guideline.title && !out.local.guideline.url) {
            const m = localMatches.find(f => norm(f.title) === norm(out.local.guideline.title));
            if (m) out.local.guideline.url = m.link;
          }

          if (!out.local.guideline) {
            out.local.guideline = {
              title: localMatches[0]?.title || 'No applicable local guideline',
              summary: localMatches.length ? 'Most applicable local document selected by filename match.' : '',
              url: localMatches[0]?.link || '',
              applicability: localMatches.length ? 'most_applicable' : 'none'
            };
          }
        } else {
          delete out.local;
        }

        // 4) national fallbacks
        if (incNational) {
          out.national = out.national && typeof out.national === 'object' ? out.national : {};
          if (!out.national.cks_link) {
            out.national.cks_link = `https://cks.nice.org.uk/search?query=${encodeURIComponent(modelPrompt)}`;
          }
        } else {
          delete out.national;
        }

        // 5) published literature
        if (incLiterature) {
          const papers = await fetchPubMed(prompt, audience);
          out.published_literature = { papers };
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
