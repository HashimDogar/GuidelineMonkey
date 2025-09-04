// pages/api/query.ts
import type { NextApiRequest, NextApiResponse } from 'next'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const prompt = req.body.prompt || "";

  const response = await fetch("http://localhost:11434/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "phi3:mini",
      prompt: prompt,
      stream: false
    })
  });

  const result = await response.json();
  res.status(200).json({ response: result.response });
}
