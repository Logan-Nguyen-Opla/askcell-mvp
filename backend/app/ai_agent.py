"""
ai_agent.py
===========
Anthropic Claude client + tool specifications for AskCell.

This layer wires the deterministic ``get_gene_expression`` tool from the
``cell_engine`` into Anthropic's Claude models using the official ``anthropic``
SDK. We run the tool-use (function-calling) loop *manually* so the flow is
explicit and auditable:

    user message
        -> Claude decides to call get_gene_expression(gene_name=...)
        -> we intercept the call and execute real Python against the matrix
        -> we feed the exact numbers back to Claude as a tool_result
        -> Claude synthesizes a scientific natural-language answer

The model is forbidden (via system prompt) from inventing biological metrics;
all numbers come from the in-memory dataset.

(Originally built on Google Gemini; migrated to Anthropic Claude.)
"""

from __future__ import annotations

import json
import os

import anthropic

from .cell_engine import cell_engine_instance

# --------------------------------------------------------------------------- #
# Configuration
# --------------------------------------------------------------------------- #
# Haiku 4.5 — fast and cost-effective, ample for this single-tool Q&A agent.
# Swap to "claude-sonnet-4-6" or "claude-opus-4-8" for higher reasoning depth.
MODEL = "claude-haiku-4-5"
MAX_TOKENS = 1024

SYSTEM_PROMPT = (
    "You are AskCell AI, an elite Molecular Biologist and Bioinformatics "
    "Expert specializing in single-cell transcriptomics (scRNA-seq). Your task "
    "is to analyze gene expression profiles and deliver clear, structured, and "
    "scientifically sound explanations. When users ask about a specific gene, "
    "you MUST query the data matrix using the get_gene_expression tool first. "
    "You are strictly forbidden from guessing, estimating, or fabricating "
    "biological metrics. Always ground every numeric claim in the tool's "
    "output, and format key figures (percentages, mean/max expression) in "
    "bold for readability."
)


def _dataset_context() -> str:
    """Describe the currently loaded dataset for the system prompt.

    Grounds the model in the real annotation so it answers cell-type questions
    using names that actually exist instead of replying "I can't find that".
    """
    overview = cell_engine_instance.cell_type_overview()
    n_cells = overview["n_cells"]
    n_genes = overview["n_genes"]
    header = (
        f"\n\nCURRENTLY LOADED DATASET: '{overview['filename']}' "
        f"({n_cells} cells, {n_genes} genes)."
    )

    cell_types = overview["cell_types"]
    if not cell_types:
        return header + (
            " This dataset has NO cell-type annotation, so cells are identified "
            "only by numeric index. If the user asks about a named cell type, "
            "explain that this file has no cell-type labels."
        )

    listing = ", ".join(f"{ct['name']} ({ct['count']} cells)" for ct in cell_types)
    return header + (
        f" Cell types present (from the '{overview['label_field']}' column): "
        f"{listing}. These are the ONLY cell types in this dataset; when the "
        "user asks about cells, map their question to these exact names. You do "
        "not have a tool for per-cell-type statistics, so answer cell-type "
        "questions from this list plus your biology expertise, and use "
        "get_gene_expression for gene-level numbers."
    )


# --------------------------------------------------------------------------- #
# Tool declaration (mapped 1:1 to cell_engine.get_gene_expression)
# --------------------------------------------------------------------------- #
TOOLS = [
    {
        "name": "get_gene_expression",
        "description": (
            "Query the currently loaded single-cell RNA-seq dataset for the "
            "expression statistics of a single gene. Returns the mean "
            "expression, maximum expression, and the percentage of cells "
            "expressing the gene. Call this for any question about how strongly "
            "or how widely a gene is expressed in the sample."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "gene_name": {
                    "type": "string",
                    "description": (
                        "The gene symbol to look up, e.g. 'CD3D', 'PDCD1', "
                        "'MS4A1'."
                    ),
                }
            },
            "required": ["gene_name"],
        },
    }
]

# Local dispatch table: tool name -> python callable.
TOOL_REGISTRY = {
    "get_gene_expression": lambda gene_name: cell_engine_instance.get_gene_expression(
        gene_name=gene_name
    ),
}

_MAX_TOOL_ROUNDS = 5  # safety bound on the tool-use loop


# --------------------------------------------------------------------------- #
# Client (lazy singleton so import never fails when the key is absent)
# --------------------------------------------------------------------------- #
_client: anthropic.Anthropic | None = None


def _get_client() -> anthropic.Anthropic:
    global _client
    if _client is None:
        api_key = os.environ.get("ANTHROPIC_API_KEY")
        if not api_key:
            raise RuntimeError(
                "ANTHROPIC_API_KEY is not set. Add it to backend/.env "
                "(see .env.example)."
            )
        _client = anthropic.Anthropic(api_key=api_key)
    return _client


def _final_text(message) -> str:
    """Concatenate the text blocks of a Claude response."""
    return "".join(
        block.text for block in message.content if block.type == "text"
    ).strip()


# --------------------------------------------------------------------------- #
# Public entry point
# --------------------------------------------------------------------------- #
def run_chat(message: str) -> str:
    """Run one user turn through Claude with manual tool execution.

    Returns the model's final synthesized natural-language reply.
    """
    client = _get_client()
    system = SYSTEM_PROMPT + _dataset_context()
    messages: list[dict] = [{"role": "user", "content": message}]

    for _ in range(_MAX_TOOL_ROUNDS):
        response = client.messages.create(
            model=MODEL,
            max_tokens=MAX_TOKENS,
            system=system,
            tools=TOOLS,
            messages=messages,
        )

        if response.stop_reason != "tool_use":
            # No tool requested -> this is the final answer.
            return _final_text(response)

        # Append Claude's tool-calling turn verbatim (preserves tool_use blocks).
        messages.append({"role": "assistant", "content": response.content})

        # Execute every requested tool call and collect the results.
        tool_results = []
        for block in response.content:
            if block.type != "tool_use":
                continue
            tool = TOOL_REGISTRY.get(block.name)
            if tool is None:
                result = {"error": f"Unknown tool '{block.name}'."}
            else:
                try:
                    result = tool(**dict(block.input))
                except Exception as exc:  # surface errors to the model, don't crash
                    result = {"error": str(exc)}
            tool_results.append(
                {
                    "type": "tool_result",
                    "tool_use_id": block.id,
                    "content": json.dumps(result),
                }
            )

        messages.append({"role": "user", "content": tool_results})

    # Loop exhausted -> ask once more for a plain answer (no tools).
    final = client.messages.create(
        model=MODEL,
        max_tokens=MAX_TOKENS,
        system=system,
        messages=messages,
    )
    return _final_text(final)
