import { useState, FormEvent } from "react";

function App() {
  const [prompt, setPrompt] = useState("");
  const [response, setResponse] = useState("");

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "phi3:mini", prompt, stream: false })
    });
    const data = await res.json();
    setResponse(data.response);
  };

  return (
    <div>
      <h1>Guideline Monkey</h1>
      <form onSubmit={handleSubmit}>
        <input
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Enter prompt"
        />
        <button type="submit">Submit</button>
      </form>
      {response && <pre>{response}</pre>}
    </div>
  );
}

export default App;
