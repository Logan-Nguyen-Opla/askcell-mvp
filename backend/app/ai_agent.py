"""
ai_agent.py
===========
Gemini Live client + tool specifications for AskCell.

This layer wires the deterministic ``get_gene_expression`` tool from the
``cell_engine`` into Google's Gemini model using the official ``google-genai``
SDK. We run the function-calling loop *manually* (automatic function calling is
disabled) so the flow is explicit and auditable:

    user message
        -> Gemini decides to call get_gene_expression(gene_name=...)
        -> we intercept the call and execute real Python against the matrix
        -> we feed the exact numbers back to Gemini
        -> Gemini synthesizes a scientific natural-language answer

The model is forbidden (via system prompt) from inventing biological metrics;
all numbers come from the in-memory dataset.
"""

from __future__ import annotations

import os

from google import genai
from google.genai import types

from .cell_engine import cell_engine_instance

# --------------------------------------------------------------------------- #
# Configuration
# --------------------------------------------------------------------------- #
MODEL = "gemini-2.5-flash"  # ultra-low latency, strong structured/tool output

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
GET_GENE_EXPRESSION_DECLARATION = types.FunctionDeclaration(
    name="get_gene_expression",
    description=(
        "Query the currently loaded single-cell RNA-seq dataset for the "
        "expression statistics of a single gene. Returns the mean expression, "
        "maximum expression, and the percentage of cells expressing the gene. "
        "Use this for any question about how strongly or how widely a gene is "
        "expressed in the sample."
    ),
    parameters=types.Schema(
        type=types.Type.OBJECT,
        properties={
            "gene_name": types.Schema(
                type=types.Type.STRING,
                description=(
                    "The gene symbol to look up, e.g. 'CD3D', 'PDCD1', 'MS4A1'."
                ),
            ),
        },
        required=["gene_name"],
    ),
)

TOOLS = types.Tool(function_declarations=[GET_GENE_EXPRESSION_DECLARATION])

# Local dispatch table: tool name -> python callable.
TOOL_REGISTRY = {
    "get_gene_expression": lambda gene_name: cell_engine_instance.get_gene_expression(
        gene_name=gene_name
    ),
}

_MAX_TOOL_ROUNDS = 5  # safety bound on the function-calling loop


# --------------------------------------------------------------------------- #
# Client (lazy singleton so import never fails when the key is absent)
# --------------------------------------------------------------------------- #
_client: genai.Client | None = None


def _get_client() -> genai.Client:
    global _client
    if _client is None:
        api_key = os.environ.get("GEMINI_API_KEY")
        if not api_key:
            raise RuntimeError(
                "GEMINI_API_KEY is not set. Add it to backend/.env "
                "(see .env.example)."
            )
        _client = genai.Client(api_key=api_key)
    return _client


def _config(system_instruction: str = SYSTEM_PROMPT) -> types.GenerateContentConfig:
    return types.GenerateContentConfig(
        system_instruction=system_instruction,
        tools=[TOOLS],
        temperature=0.2,
        # We drive the loop ourselves for transparency / control.
        automatic_function_calling=types.AutomaticFunctionCallingConfig(
            disable=True
        ),
    )


# --------------------------------------------------------------------------- #
# Public entry point
# --------------------------------------------------------------------------- #
def run_chat(message: str) -> str:
    """Run one user turn through Gemini with manual function calling.

    Returns the model's final synthesized natural-language reply.
    """
    client = _get_client()
    config = _config(SYSTEM_PROMPT + _dataset_context())

    contents: list[types.Content] = [
        types.Content(role="user", parts=[types.Part.from_text(text=message)])
    ]

    for _ in range(_MAX_TOOL_ROUNDS):
        response = client.models.generate_content(
            model=MODEL,
            contents=contents,
            config=config,
        )

        function_calls = response.function_calls
        if not function_calls:
            # No tool requested -> this is the final answer.
            return (response.text or "").strip()

        # Append the model's tool-calling turn verbatim.
        contents.append(response.candidates[0].content)

        # Execute every requested tool call and append the results.
        for fc in function_calls:
            tool = TOOL_REGISTRY.get(fc.name)
            if tool is None:
                result = {"error": f"Unknown tool '{fc.name}'."}
            else:
                try:
                    result = tool(**dict(fc.args))
                except Exception as exc:  # surface errors to the model, don't crash
                    result = {"error": str(exc)}

            contents.append(
                types.Content(
                    role="user",
                    parts=[
                        types.Part.from_function_response(
                            name=fc.name,
                            response={"result": result},
                        )
                    ],
                )
            )

    # Loop exhausted -> ask once more for a plain answer.
    final = client.models.generate_content(
        model=MODEL, contents=contents, config=config
    )
    return (final.text or "").strip()
