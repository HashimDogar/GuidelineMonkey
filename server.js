const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const localDir = path.join(__dirname, 'local_ocr');
const frontendDir = path.join(__dirname, 'frontend');

function findLocalGuidelines(query) {
  const terms = query.toLowerCase().split(/\s+/);
  const files = fs.existsSync(localDir) ? fs.readdirSync(localDir) : [];
  return files.filter(f => {
    const lower = f.toLowerCase();
    return terms.some(t => lower.includes(t));
  }).map(f => ({
    title: f.replace(/_ocr\.pdf$/i, '').replace(/_/g, ' '),
    link: `/local/${encodeURIComponent(f)}`
  }));
}

async function queryPhi3(prompt) {
    try {
      const response = await fetch('http://localhost:11434/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'phi3:mini', prompt, stream: false })
      });
      const data = await response.json();
      return data.response;       // model’s text output
    } catch (e) {
      return 'Failed to fetch summary from local model.';
    }
  }
  

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  if (req.method === 'POST' && parsedUrl.pathname === '/api/guidelines') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { prompt = '' } = JSON.parse(body || '{}');
        const local = findLocalGuidelines(prompt);
        const summaryPrompt = `Clinical query: ${prompt}\nLocal guidelines: ${local.map(g=>g.title).join(', ')}.\nProvide a concise summary prioritising local guidelines and noting national (NICE), international, and systematic reviews.`;
        const summary = await queryPhi3(summaryPrompt);
        const result = {
          local,
          national: [{ title: 'NICE guidelines search', link: `https://www.nice.org.uk/search?q=${encodeURIComponent(prompt)}` }],
          international: [{ title: 'International guideline search', link: `https://www.who.int/search?q=${encodeURIComponent(prompt)}` }],
          systematic_reviews: [{ title: 'Systematic reviews (PubMed)', link: `https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(prompt)}&filter=pubt.systematicreview` }],
          summary
        };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid request' }));
      }
    });
  } else if (parsedUrl.pathname.startsWith('/local/')) {
    const filePath = path.join(localDir, decodeURIComponent(parsedUrl.pathname.replace('/local/', '')));
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('Not found');
      } else {
        res.writeHead(200, { 'Content-Type': 'application/pdf' });
        res.end(data);
      }
    });
  } else {
    let filePath = path.join(frontendDir, parsedUrl.pathname === '/' ? 'index.html' : parsedUrl.pathname);
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('Not found');
      } else {
        const ext = path.extname(filePath).toLowerCase();
        const type = ext === '.html' ? 'text/html' : ext === '.js' ? 'application/javascript' : 'text/plain';
        res.writeHead(200, { 'Content-Type': type });
        res.end(data);
      }
    });
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
