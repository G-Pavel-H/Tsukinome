"""Tsukinome code-index sidecar (Phase 6; embedding backend swapped to ONNX in Phase 14).

The real engine behind the TypeScript ``CodeIndex`` interface. It uses CocoIndex's tree-sitter
``RecursiveSplitter`` to AST-chunk a repo checkout (whole functions/classes stay intact), embeds
each chunk with a *local* model (no API key, ~$0), and writes the rows into our ``code_chunks``
table tagged with a per-run ``namespace``. A ``query-embed`` mode embeds a query string with the
*same* model so retrieval (done in TS against pgvector) shares the document vector space.

Phase 14 — embedding runtime: the model (``all-MiniLM-L6-v2``, 384-dim) is unchanged, but it now
runs on **ONNX Runtime via fastembed** instead of PyTorch/SentenceTransformer. torch was a ~2GB
install wanting ~1.5GB RAM and OOM'd small hosts; fastembed is ~177MB of deps + a ~90MB model.
Two knobs are load-bearing for memory (found by measuring): ``threads=1`` — onnxruntime otherwise
spawns one memory arena per CPU core (~1.5GB on a 10-core box); and a small ``EMBED_BATCH_SIZE`` —
the peak tracks batch size, so a small batch keeps it near the ~290MB model-load floor. Same
vectors, same 384 dims → no ``code_chunks`` migration.

Design note (CocoIndex 1.0): 1.0 replaced the declarative ``flow_def`` / ``sources`` / ``targets``
pipeline with a reactive component model. For our one-shot, per-run batch job we don't need that
machinery — we use CocoIndex purely for its tree-sitter chunking (its real value) and own the
walk / embed / INSERT ourselves. This keeps ``code_chunks`` owned by migration 006 (CocoIndex
never manages the table).

This is the one Phase-6 piece that runs only where Python + CocoIndex + fastembed are installed —
it is exercised by the gated integration test and the ``debug:index-repo`` demo, never in CI
(mirroring how ``e2b-sandbox.ts`` is verified against the live service, not in CI).

Usage:
    python cocoindex_flow.py index --namespace <ns> --dir <repo_dir> [--model <hf_model>]
    python cocoindex_flow.py query-embed --query "<text>" [--model <hf_model>]

Env: DATABASE_URL must point at the pgvector-enabled Postgres (same DB as the app). Only the
``index`` command needs it; ``query-embed`` is DB-free.
"""

import argparse
import json
import os
import sys

# Keep tokenizer threading calm. Cheap insurance; embedding runs single-threaded (see below).
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

DEFAULT_MODEL = "sentence-transformers/all-MiniLM-L6-v2"
# Embedding dimension of DEFAULT_MODEL (all-MiniLM-L6-v2). Must match src/index/types.ts
# EMBEDDING_DIM and the code_chunks.embedding vector(384) column (migration 006).
EMBEDDING_DIM = 384

# Memory-critical (Phase 14). onnxruntime allocates one arena per intra-op thread, so on a
# multi-core host the default balloons to ~1.5GB; pin to 1. The peak also tracks batch size —
# a small batch keeps it near the ~290MB model-load floor (batch_size=1 → ~298MB; 16 → ~388MB).
EMBED_THREADS = 1
EMBED_BATCH_SIZE = 4

# Target chunk size / overlap in BYTES (CocoIndex 1.0's RecursiveSplitter measures bytes).
CHUNK_SIZE = 1200
CHUNK_OVERLAP = 120

# Source file extensions we index. Keep in sync with the fake index's SOURCE_EXT and the
# toolchains' sourceExts (src/toolchain/toolchain.ts): TS/JS + Python.
SOURCE_EXT = (".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".py")
# Directories we never descend into.
EXCLUDED_DIRS = {
    "node_modules", "dist", ".git", "coverage", "build", ".next",
    "__pycache__", ".venv", "venv", ".pytest_cache", ".mypy_cache", ".tox",
}

_MODEL = DEFAULT_MODEL
_EMBEDDER = None  # lazily-loaded fastembed TextEmbedding, cached for the process lifetime


def _embedder():
    """Load (once) and return the fastembed TextEmbedding for ``_MODEL``."""
    global _EMBEDDER
    if _EMBEDDER is None:
        from fastembed import TextEmbedding

        # threads=1 is the memory guard (see EMBED_THREADS). fastembed downloads the ONNX model
        # from HuggingFace on first use and caches it; the download is a no-op on later runs.
        _EMBEDDER = TextEmbedding(model_name=_MODEL, threads=EMBED_THREADS)
    return _EMBEDDER


def _embed(texts):
    """Embed a list of strings → list[list[float]], small-batched to bound peak memory."""
    return [vec.tolist() for vec in _embedder().embed(texts, batch_size=EMBED_BATCH_SIZE)]


def _iter_source_files(root: str):
    """Yield (absolute_path, path_relative_to_root) for every indexable source file."""
    for dirpath, dirnames, filenames in os.walk(root):
        # Prune excluded directories in place so os.walk never descends into them.
        dirnames[:] = [d for d in dirnames if d not in EXCLUDED_DIRS]
        for name in filenames:
            if name.endswith(SOURCE_EXT):
                abspath = os.path.join(dirpath, name)
                yield abspath, os.path.relpath(abspath, root)


def _to_vector_literal(values) -> str:
    """pgvector text literal, e.g. ``[0.1,0.2,...]`` — matches TS toVectorLiteral."""
    return "[" + ",".join(repr(float(v)) for v in values) + "]"


def cmd_index(args: argparse.Namespace) -> int:
    global _MODEL
    _MODEL = args.model
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        print("DATABASE_URL is required for `index`", file=sys.stderr)
        return 2

    import psycopg
    from cocoindex.ops.code import CodeSource
    from cocoindex.ops.text import RecursiveSplitter, detect_code_language

    splitter = RecursiveSplitter()

    # Chunk every source file (AST-aware where tree-sitter knows the language), collecting
    # (path, start_line, end_line, text) so we can batch-embed and batch-insert once.
    collected: list[tuple[str, int, int, str]] = []
    for abspath, relpath in _iter_source_files(args.dir):
        try:
            with open(abspath, encoding="utf-8") as fh:
                text = fh.read()
        except (OSError, UnicodeDecodeError):
            continue  # unreadable / binary-ish file — skip, don't fail the run
        if not text.strip():
            continue
        language = detect_code_language(filename=os.path.basename(abspath))
        src = CodeSource(text, language=language)
        for chunk in splitter.split(src, CHUNK_SIZE, chunk_overlap=CHUNK_OVERLAP):
            if chunk.text.strip():
                collected.append((relpath, chunk.start.line, chunk.end.line, chunk.text))

    if not collected:
        return 0

    # Embed every chunk (small-batched to bound peak memory; shares the model with query-embed).
    embeddings = _embed([c[3] for c in collected])

    rows = [
        (args.namespace, path, start, end, content, _to_vector_literal(vec))
        for (path, start, end, content), vec in zip(collected, embeddings)
    ]
    with psycopg.connect(database_url) as conn:
        with conn.cursor() as cur:
            cur.executemany(
                """INSERT INTO code_chunks
                       (namespace, path, start_line, end_line, content, embedding)
                   VALUES (%s, %s, %s, %s, %s, %s::vector)""",
                rows,
            )
        conn.commit()
    return 0


def cmd_query_embed(args: argparse.Namespace) -> int:
    """Embed a query with the same local model; print the vector as JSON to stdout."""
    global _MODEL
    _MODEL = args.model
    [vec] = _embed([args.query])
    json.dump(vec, sys.stdout)
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Tsukinome code-index sidecar")
    sub = parser.add_subparsers(dest="command", required=True)

    p_index = sub.add_parser("index", help="chunk + embed a repo into code_chunks")
    p_index.add_argument("--namespace", required=True)
    p_index.add_argument("--dir", required=True)
    p_index.add_argument("--model", default=DEFAULT_MODEL)
    p_index.set_defaults(func=cmd_index)

    p_query = sub.add_parser("query-embed", help="embed a query string (JSON vector to stdout)")
    p_query.add_argument("--query", required=True)
    p_query.add_argument("--model", default=DEFAULT_MODEL)
    p_query.set_defaults(func=cmd_query_embed)

    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
