function App() {
  const [prompt, setPrompt] = React.useState('');
  const [result, setResult] = React.useState(null);
  const [loading, setLoading] = React.useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch('/api/guidelines', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt })
      });
      const data = await res.json();
      setResult(data);
    } catch (err) {
      setResult({ summary: 'Request failed.' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <h1>Guideline Monkey</h1>
      <form onSubmit={handleSubmit}>
        <input
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          placeholder="Enter clinical question"
          style={{ width: '60%' }}
        />
        <button type="submit">Search</button>
      </form>
      {loading && <p>Loading...</p>}
      {result && (
        <div>
          <section>
            <h2>Summary</h2>
            <p>{result.summary}</p>
          </section>
          <section>
            <h2>Local Guidelines</h2>
            <ul>
              {result.local && result.local.map((g, i) => (
                <li key={i}>
                  <a href={g.link} target="_blank" rel="noreferrer">{g.title}</a>
                </li>
              ))}
            </ul>
          </section>
          <section>
            <h2>NICE Guidelines</h2>
            <ul>
              {result.national && result.national.map((g, i) => (
                <li key={i}>
                  <a href={g.link} target="_blank" rel="noreferrer">{g.title}</a>
                </li>
              ))}
            </ul>
          </section>
          <section>
            <h2>International Guidelines</h2>
            <ul>
              {result.international && result.international.map((g, i) => (
                <li key={i}>
                  <a href={g.link} target="_blank" rel="noreferrer">{g.title}</a>
                </li>
              ))}
            </ul>
          </section>
          <section>
            <h2>Systematic Reviews</h2>
            <ul>
              {result.systematic_reviews && result.systematic_reviews.map((g, i) => (
                <li key={i}>
                  <a href={g.link} target="_blank" rel="noreferrer">{g.title}</a>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);