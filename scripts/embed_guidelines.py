from pathlib import Path

from langchain_community.vectorstores import Chroma
from langchain_community.document_loaders import PyPDFLoader, PDFMinerLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_huggingface import HuggingFaceEmbeddings  # pip install -U langchain-huggingface

REPO_ROOT = Path(__file__).resolve().parents[1]
PDF_DIR = REPO_ROOT / "documents" / "local_ocr"        # <= your folder
PERSIST_DIR = REPO_ROOT / "vectorstore" / "chroma"
PERSIST_DIR.mkdir(parents=True, exist_ok=True)

print(f"Looking for PDFs in: {PDF_DIR}")
pdf_files = sorted(PDF_DIR.glob("*.pdf"))
if not pdf_files:
    raise SystemExit(f"No PDFs found in {PDF_DIR}")

def extract_pages(path: Path):
    pages = []
    try:
        pages = PyPDFLoader(str(path)).load()
    except Exception as e:
        print(f"[warn] PyPDF failed for {path.name}: {e}")
    # If PyPDF gave empty text, try PDFMiner
    if sum(len(d.page_content.strip()) for d in pages) == 0:
        try:
            pages = PDFMinerLoader(str(path)).load()
        except Exception as e:
            print(f"[warn] PDFMiner failed for {path.name}: {e}")
    total_chars = sum(len(d.page_content) for d in pages)
    if total_chars == 0:
        print(f"[skip] {path.name}: no extractable text (likely scanned).")
        return []
    print(f"[ok] {path.name}: {len(pages)} pages, {total_chars} chars.")
    return pages

all_docs = []
for f in pdf_files:
    all_docs.extend(extract_pages(f))

if not all_docs:
    raise SystemExit("No text extracted from any PDF. If they’re scanned, run OCR (e.g. ocrmypdf) and re-run.")

splitter = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=150)
chunks = splitter.split_documents(all_docs)
if not chunks:
    raise SystemExit("Text was extracted but chunking produced 0 chunks; adjust splitter settings.")

embedding = HuggingFaceEmbeddings(model_name="sentence-transformers/all-MiniLM-L6-v2")
db = Chroma.from_documents(chunks, embedding, persist_directory=str(PERSIST_DIR))
db.persist()
print(f"✅ Embedded {len(chunks)} chunks from {len(all_docs)} pages into {PERSIST_DIR}")
