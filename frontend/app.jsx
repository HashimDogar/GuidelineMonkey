/* global React, ReactDOM */

function Badge({ tone = "default", children }) {
  const toneClass =
    tone === "ok" ? "badge badge--ok" :
    tone === "warn" ? "badge badge--warn" :
    tone === "danger" ? "badge badge--danger" :
    "badge";
  return <span className={toneClass}>{children}</span>;
}

function ApplicabilityBadge({ applicability }) {
  if (!applicability) return null;
  const map = {
    specific: { label: "Specific guideline", tone: "ok" },
    most_applicable: { label: "Most applicable", tone: "warn" },
    none: { label: "No applicable local guideline", tone: "danger" }
  };
  const v = map[applicability] || { label: applicability, tone: "default" };
  return <Badge tone={v.tone}>{v.label}</Badge>;
}

function LinkList({ items }) {
  if (!items || !items.length) return <p className="small">No links.</p>;
  return (
    <ul className="list list--tight">
      {items.map((g, i) => (
        <li key={i}>
          <a className="link" href={(g.url || g.link)} target="_blank" rel="noreferrer">
            {g.title || g.url || g.link}
          </a>
        </li>
      ))}
    </ul>
  );
}

function Bullets({ items }) {
  if (!items) return null;
  if (Array.isArray(items) && items.length === 0) return <p className="small">—</p>;
  if (Array.isArray(items)) {
    return (
      <ul className="list">
        {items.map((x, i) => <li key={i}>{x}</li>)}
      </ul>
    );
  }
  return <p>{String(items)}</p>;
}

function DecisionTree({ steps }) {
  if (!steps || !steps.length) return null;
  return (
    <div className="tree">
      {steps.map((s, i) => (
        <div className="tree__item" key={i}>
          <span className="tree__if">IF</span> {s.if || s.condition || "—"}{" "}
          <span className="tree__if">THEN</span> {s.then || s.action || "—"}
          {s.note ? <div className="tree__note">Note: {s.note}</div> : null}
        </div>
      ))}
    </div>
  );
}

function Card({ title, subtitle, className = "", headerExtras = null, children }) {
  return (
    <section className={`card ${className}`}>
      <div className="card__header">
        <h2 className="card__title">{title}</h2>
        {headerExtras}
      </div>
      {subtitle ? <p className="card__sub">{subtitle}</p> : null}
      {children}
    </section>
  );
}

function App() {
  const [prompt, setPrompt] = React.useState("");
  const [result, setResult] = React.useState(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState(null);
  const [elapsed, setElapsed] = React.useState(0);
  const timerRef = React.useRef(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);
    setElapsed(0);
    try {
      const res = await fetch("/api/guidelines", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setResult(data);
    } catch (err) {
      console.error(err);
      setError("Request failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    if (loading) {
      timerRef.current = setInterval(() => {
        setElapsed((e) => e + 1);
      }, 1000);
    } else {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    return () => clearInterval(timerRef.current);
  }, [loading]);

  function formatElapsed(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins > 0) {
      return `${seconds}s (${mins}m ${secs}s)`;
    }
    return `${seconds}s`;
  }

  return (
    <div className="container">
      <header className="app-header">
        <div>
          <h1 className="app-title">Guideline Monkey</h1>
          <p className="app-subtitle">Local → NICE → Cochrane — concise, actionable guidance</p>
        </div>
      </header>

      <form className="search" onSubmit={handleSubmit}>
        <input
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Enter clinical question (e.g., ‘Adult with COPD exacerbation in ED’)"
        />
        <button type="submit" disabled={loading || !prompt.trim()}>
          {loading ? "Searching…" : "Search"}
        </button>
      </form>

      {loading && <div className="status">Loading… {formatElapsed(elapsed)}</div>}
      {!loading && !error && result && (
        <div className="status">Completed in {formatElapsed(elapsed)}</div>
      )}
      {error && <div className="alert">{error}</div>}

      {result && (
        <div className="results-grid">
          {/* SUMMARY */}
          <Card title="Summary" className="card--summary">
            {result.summary ? (
              <p className="m6">{result.summary}</p>
            ) : (
              <p className="small">No summary returned.</p>
            )}
          </Card>

          {/* LOCAL */}
          <Card
            title="Local guidelines"
            headerExtras={
              result?.local?.guideline?.applicability ? (
                <div className="badges">
                  <ApplicabilityBadge applicability={result.local.guideline.applicability} />
                </div>
              ) : null
            }
          >
            {result?.local?.guideline && (
              <>
                <p className="m6">
                  <strong>{result.local.guideline.title}</strong>
                  {result.local.guideline.url ? (
                    <> — <a className="link-muted" href={result.local.guideline.url} target="_blank" rel="noreferrer">Open</a></>
                  ) : null}
                </p>
                {result.local.guideline.summary && (
                  <p className="small m8">{result.local.guideline.summary}</p>
                )}
                <hr className="sep" />
              </>
            )}

            {result?.local?.decision_tree && result.local.decision_tree.length > 0 && (
              <>
                <h3 className="m6">Decision tree</h3>
                <DecisionTree steps={result.local.decision_tree} />
              </>
            )}

            {(result?.local?.recommended_investigations || result?.local?.investigations) && (
              <>
                <h3 className="m8">Recommended investigations</h3>
                <Bullets items={result.local.recommended_investigations || result.local.investigations} />
              </>
            )}

            {(result?.local?.recommended_management || result?.local?.management) && (
              <>
                <h3 className="m8">Recommended management</h3>
                <Bullets items={result.local.recommended_management || result.local.management} />
              </>
            )}

            {(result?.local?.links || Array.isArray(result?.local)) && (
              <>
                <h3 className="m8">Links (top 3)</h3>
                {Array.isArray(result?.local)
                  ? <LinkList items={result.local} />
                  : <LinkList items={result.local.links} />}
              </>
            )}
          </Card>

          {/* NATIONAL */}
          <Card title="National guidelines (NICE)">
            {result?.national?.nice_summary && <p className="m6">{result.national.nice_summary}</p>}
            {(result?.national?.recommended_investigations || result?.national?.investigations) && (
              <>
                <h3 className="m8">Recommended investigations</h3>
                <Bullets items={result.national.recommended_investigations || result.national.investigations} />
              </>
            )}
            {(result?.national?.recommended_management || result?.national?.management) && (
              <>
                <h3 className="m8">Recommended management</h3>
                <Bullets items={result.national.recommended_management || result.national.management} />
              </>
            )}
            {result?.national?.cks_link && (
              <p className="m8">
                <a className="link" href={result.national.cks_link} target="_blank" rel="noreferrer">
                  NICE CKS — most relevant page
                </a>
              </p>
            )}

            {/* Back-compat */}
            {Array.isArray(result?.national) && <LinkList items={result.national} />}
          </Card>

          {/* SYSTEMATIC REVIEW */}
          <Card title="Systematic review (Cochrane)">
            {result?.systematic_review?.summary ? (
              <p className="m6">{result.systematic_review.summary}</p>
            ) : <p className="small">No summary returned.</p>}

            {result?.systematic_review?.citation && (
              <p className="small muted">{result.systematic_review.citation}</p>
            )}
            {result?.systematic_review?.link && (
              <p className="m8">
                <a className="link" href={result.systematic_review.link} target="_blank" rel="noreferrer">
                  Open systematic review
                </a>
              </p>
            )}

            {/* Back-compat */}
            {Array.isArray(result?.systematic_reviews) && <LinkList items={result.systematic_reviews} />}
          </Card>
        </div>
      )}
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<App />);
