"""Anti-hallucination guardrail prompts for VLM tools.

These prompts are appended to every VLM request to reduce hallucination.
The strictness level is configurable via ``prompts.strictness`` in the config file.
"""

# ── Base guardrails (applied at all strictness levels) ──────────────

_BASE_HALLUCINATION_RULES = (
    "IMPORTANT ANTI-HALLUCINATION RULES:\n"
    "- Only report what you ACTUALLY SEE in the screenshot. Never invent, guess, or\n"
    "  assume elements that might logically exist but aren't visible.\n"
    "- When quoting text, transcribe EXACT characters you see. If text is partially\n"
    "  cut off, blurry, or too small to read reliably, state that you cannot read it\n"
    "  clearly rather than filling in what you think it says.\n"
    "- Do NOT assign meaning to numbers — e.g. a red '0' could be a positive indicator\n"
    "  (zero errors), don't assume it's negative.\n"
    "- Distinguish between a rendering bug vs. actual UI content before reporting.\n"
)

# ── Assert-specific guardrails ──────────────────────────────────────

_BASE_ASSERT_RULES = (
    "ANTI-HALLUCINATION RULES:\n"
    "- Quote EXACT text/numbers you see on screen. Do not paraphrase or approximate.\n"
    "- If the assertion mentions a specific value (e.g. '0.56s'), but the live value has\n"
    "  changed (e.g. shows '0.57s'), that is NOT a failure — dynamic data updates.\n"
    "  Check the assertion about STRUCTURAL conditions (e.g. 'TTFB label is visible')\n"
    "  not exact instantaneous values.\n"
    "- When confidence is medium or low, explain specifically what you're uncertain about.\n"
    "- Only fail an assertion when there is CLEAR visual evidence contradicting it.\n"
    "  'I cannot tell for sure' should give pass=false with confidence=low, NOT pass=true.\n"
)

# ── Strictness variations ───────────────────────────────────────────

_STRICT_ADDENDUM = (
    "\nSTRICT MODE: Only report issues you are VERY confident about (95%+ confidence).\n"
    "If there is ANY ambiguity, mark it as pass/inconclusive rather than reporting a false positive.\n"
)

_RELAXED_ADDENDUM = (
    "\nRELAXED MODE: You may report plausible issues even with moderate confidence.\n"
    "Flag anything that looks suspicious — false positives are acceptable for thoroughness.\n"
)


def get_review_prompt(strictness: str = "standard") -> str:
    """Return the anti-hallucination prompt for visual_review / visual_inspect."""
    prompt = _BASE_HALLUCINATION_RULES
    if strictness == "strict":
        prompt += _STRICT_ADDENDUM
    elif strictness == "relaxed":
        prompt += _RELAXED_ADDENDUM
    return prompt


def get_assert_prompt(strictness: str = "standard") -> str:
    """Return the anti-hallucination prompt for visual_assert."""
    prompt = _BASE_ASSERT_RULES
    if strictness == "strict":
        prompt += _STRICT_ADDENDUM
    elif strictness == "relaxed":
        prompt += _RELAXED_ADDENDUM
    return prompt


# Backward-compatible aliases (used by server.py migration)
NO_HALLUCINATION = _BASE_HALLUCINATION_RULES
NO_HALLUCINATION_ASSERT = _BASE_ASSERT_RULES


def get_aesthetics_prompt(aesthetics: str) -> str:
    """Return the aesthetics prompt block, or empty string if no rules."""
    if not aesthetics.strip():
        return ""
    return (
        "AESTHETIC & LAYOUT PRINCIPLES (project-specific):\n"
        "Apply the following aesthetic standards when evaluating this UI:\n\n"
        f"{aesthetics}\n\n"
        "When reporting issues, reference which specific aesthetic principle is violated.\n"
    )
