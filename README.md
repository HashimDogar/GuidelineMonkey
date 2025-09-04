# Guideline Monkey (RAG Edition)

## Setup Instructions

1. Place your local, NICE, and international guideline PDFs in the appropriate folders under `documents/`.
2. Create the vector store by running:

   ```bash
   cd scripts
   python3 embed_guidelines.py
   ```

3. Start the local Ollama server:

   ```bash
   ollama serve
   ```

4. Run the frontend:

   ```bash
   npm install
   npm run dev
   ```

5. Submit a prompt like: **"My patient has asthma"** to get guideline-derived answers.
