import React from "react";
import ReactDOM from "react-dom/client";

/**
 * Guideline Monkey — structured output renderer
 *
 * EXPECTED RESPONSE SHAPE FROM /api/guidelines
 * -------------------------------------------------
 * {
 *   "summary": "string",
 *   "local": {
 *     "decision_tree": [
 *        { "if": "string", "then": "string", "note": "optional string" }
 *     ],
 *     "recommended_investigations": ["string", ...],
 *     "recommended_management": ["string", ...],
 *     "links": [ { "title": "string", "url": "https://..." }, ... ],
 *     "guideline": {
 *        "title": "Specific local guideline matched (or most applicable)",
 *        "summary": "short summary",
 *        "url": "https://...",
 *        "applicability": "specific | most_applicable | none"
 *     }
 *   },
 *   "national": {
 *     "nice_summary": "string",
 *     "recommended_investigations": ["string", ...],
 *     "recommended_management": ["string", ...],
 *     "cks_link": "https://..."
 *   },
 *   "systematic_review": {
 *     "summary": "string",
 *     "link": "https://...",
 *     "citation": "optional string"
 *   }
 * }
 *
 * This component is backwards-compatible with your previous, simpler shape
 * (summary + arrays of {title, link}). If the structured fields are missing,
 * it will gracefully render whatever is available.
 */

function Section({ title, children }) {
  return (
    <section className="mt-8">
      <h2 className="text-xl font-semibold mb-3">{title}</h2>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function LinkList({ items }) {
  if (!items || !items.length) return null;
  return (
    <ul className="list-disc pl-5 space-y-1">
      {items.map((g, i) => (
        <li key={i}>
          {g.url ? (
            <a className="underline" href={g.url} target="_blank" rel="noreferrer">
              {g.title || g.url}
            </a>
          ) : (
            <a className="underline" href={g.link} target="_blank" rel="noreferrer">
              {g.title || g.link}
            </a>
          )}
        </li>
      ))}
    </ul>
  );
}

function Bullets({ items, emptyLabel = "—" }) {
  if (!items) return null;
  if (Array.isArray(items) && items.length === 0) return <p>{emptyLabel}</p>;
  if (Array.isArray(items)) {
    return (
      <ul className="list-disc pl-5 space-y-1">
        {items.map((x, idx) => (
          <li key={idx}>{x}</li>
        ))}
      </ul>
    );
  }
  // allow string fallback
  return <p>{String(items)}</p>;
}

function DecisionTree({ steps }) {
  if (!steps || !steps.length) return null;
  return (
    <ol className="list-decimal pl-5 space-y-2">
      {steps.map((s, i) => (
        <li key={i}>
          <div>
            <span className="font-medium">IF</span> {s.if || s.condition || "—"} {" "}
            <span className="font-medium">THEN</span> {s.then || s.action || "—"}
            {s.note ? <span className="block text-sm text-gray-600">Note: {s.note}</span> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

function Badge({ children, tone = "default" }) {
  const tones = {
    default: "bg-gray-100 text-gray-800",
    match: "bg-green-100 text-green-800",
    fallback: "bg-amber-100 text-amber-900",
    none: "bg-red-100 text-red-800",
  };
  return (
    <span className={`inline-block text-xs px-2 py-0.5 rounded-full ${tones[tone] || tones.default}`}>
      {children}
    </span>
  );
}

function ApplicabilityBadge({ applicability }) {
  if (!applicability) return null;
  const map = {
    specific: { label: "Specific guideline", tone: "match" },
    most_applicable: { label: "Most applicable guideline", tone: "fallback" },
    none: { label: "No applicable guideline", tone: "none" },
  };
  const v = map[applicability] || { label: applicability };
  return <Badge tone={v.tone}>{v.label}</Badge>;
}

function App() {
  const [prompt, setPrompt] = React.useState("");
  const [result, setResult] = React.useState(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/guidelines", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
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

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-6">Guideline Monkey</h1>

      <form onSubmit={handleSubmit} className="flex items-center gap-2 mb-4">
        <input
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Enter clinical question (e.g., 'Adult with COPD exacerbation in ED')"
          className="flex-1 border rounded-lg px-3 py-2"
        />
        <button
          type="submit"
          disabled={loading || !prompt.trim()}
          className="px-4 py-2 rounded-lg bg-black text-white disabled:opacity-50"
        >
          {loading ? "Searching…" : "Search"}
        </button>
      </form>

      {loading && <p className="text-sm text-gray-600">Loading…</p>}
      {error && (
        <div className="border border-red-200 bg-red-50 text-red-800 rounded-lg p-3 mb-4">
          {error}
        </div>
      )}

      {result && (
        <div className="space-y-6">
          {/* SUMMARY */}
          {result.summary && (
            <Section title="Summary">
              <p className="leading-relaxed">{result.summary}</p>
            </Section>
          )}

          {/* LOCAL GUIDELINES */}
          <Section title="Local guidelines">
            {result?.local?.guideline && (
              <div className="border rounded-lg p-3">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-medium">{result.local.guideline.title}</h3>
                  <ApplicabilityBadge applicability={result.local.guideline.applicability} />
                </div>
                {result.local.guideline.summary && (
                  <p className="text-sm text-gray-700 mb-2">{result.local.guideline.summary}</p>
                )}
                {result.local.guideline.url && (
                  <a
                    className="text-sm underline"
                    href={result.local.guideline.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open guideline
                  </a>
                )}
              </div>
            )}

            {/* Decision tree */}
            {result?.local?.decision_tree && result.local.decision_tree.length > 0 && (
              <div>
                <h4 className="font-medium mb-1">Decision tree</h4>
                <DecisionTree steps={result.local.decision_tree} />
              </div>
            )}

            {/* Recommended investigations */}
            {(result?.local?.recommended_investigations || result?.local?.investigations) && (
              <div>
                <h4 className="font-medium mb-1">Recommended investigations</h4>
                <Bullets items={result.local.recommended_investigations || result.local.investigations} />
              </div>
            )}

            {/* Recommended management */}
            {(result?.local?.recommended_management || result?.local?.management) && (
              <div>
                <h4 className="font-medium mb-1">Recommended management</h4>
                <Bullets items={result.local.recommended_management || result.local.management} />
              </div>
            )}

            {/* Links for most applicable guidelines (up to 3) */}
            {(result?.local?.links || result?.local) && (
              <div>
                <h4 className="font-medium mb-1">Links (top 3)</h4>
                <LinkList items={(result.local.links || result.local).slice?.(0, 3) || []} />
              </div>
            )}

            {/* Back-compat with old shape: result.local as array of {title, link} */}
            {Array.isArray(result?.local) && (
              <div>
                <h4 className="font-medium mb-1">Local guideline links</h4>
                <LinkList items={result.local} />
              </div>
            )}
          </Section>

          {/* NATIONAL (NICE) */}
          <Section title="National guidelines (NICE)">
            {result?.national?.nice_summary && (
              <p className="mb-2">{result.national.nice_summary}</p>
            )}
            {(result?.national?.recommended_investigations || result?.national?.investigations) && (
              <div>
                <h4 className="font-medium mb-1">Recommended investigations</h4>
                <Bullets items={result.national.recommended_investigations || result.national.investigations} />
              </div>
            )}
            {(result?.national?.recommended_management || result?.national?.management) && (
              <div>
                <h4 className="font-medium mb-1">Recommended management</h4>
                <Bullets items={result.national.recommended_management || result.national.management} />
              </div>
            )}
            {result?.national?.cks_link && (
              <p className="mt-2">
                <a className="underline" href={result.national.cks_link} target="_blank" rel="noreferrer">
                  NICE CKS — most relevant page
                </a>
              </p>
            )}

            {/* Back-compat with old shape */}
            {Array.isArray(result?.national) && (
              <div className="mt-2">
                <LinkList items={result.national} />
              </div>
            )}
          </Section>

          {/* SYSTEMATIC REVIEW */}
          <Section title="Systematic review (Cochrane)">
            {result?.systematic_review?.summary && (
              <p className="mb-2">{result.systematic_review.summary}</p>
            )}
            {result?.systematic_review?.citation && (
              <p className="text-sm text-gray-700">{result.systematic_review.citation}</p>
            )}
            {result?.systematic_review?.link && (
              <p className="mt-2">
                <a className="underline" href={result.systematic_review.link} target="_blank" rel="noreferrer">
                  Open systematic review
                </a>
              </p>
            )}

            {/* Back-compat with old shape */}
            {Array.isArray(result?.systematic_reviews) && (
              <div className="mt-2">
                <LinkList items={result.systematic_reviews} />
              </div>
            )}
          </Section>
        </div>
      )}
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<App />);
