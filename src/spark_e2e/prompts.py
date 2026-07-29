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


# ── Test-specific guardrails ──────────────────────────────────────────

_BASE_TEST_RULES = (
    "You are a visual E2E test runner. A user has described what they expect to see on a page.\n"
    "Your job: check EVERY expectation against the screenshot and report pass/fail for each.\n"
    "\n"
    "RULES:\n"
    "- Each expectation is a separate check. Report pass/fail independently per expectation.\n"
    "- Only report what you ACTUALLY SEE. If an element is not visible, say so — don't guess.\n"
    "- For text content: quote EXACT text you see. If text is cut off, report the visible portion.\n"
    "- Structural checks (layout, alignment, sizing, visibility) are more reliable than exact color/value checks.\n"
    "- If a check is about dynamic data (numbers, timestamps, user names), be lenient —\n"
    "  only fail if the STRUCTURE is broken (missing label, truncated text), not if the value changed.\n"
    "- If you genuinely cannot determine pass/fail, set confidence to 'low' and explain why.\n"
    "- Be specific in your reasoning: mention WHERE on the page you looked and WHAT you observed.\n"
)


def get_test_prompt(expectations: str, strictness: str = "standard") -> str:
    """Return the prompt for the visual_test command."""
    prompt = _BASE_TEST_RULES
    prompt += "\n\nEXPECTATIONS TO VERIFY:\n" + expectations
    prompt += "\n\n" + _BASE_HALLUCINATION_RULES
    if strictness == "strict":
        prompt += "\n" + _STRICT_ADDENDUM
    elif strictness == "relaxed":
        prompt += "\n" + _RELAXED_ADDENDUM
    prompt += (
        '\n\nRespond ONLY with JSON: {"pass": true|false, '
        '"confidence": "high"|"medium"|"low", '
        '"checks": [{"expectation": "...", "pass": true|false, '
        '"confidence": "high"|"medium"|"low", '
        '"observation": "...", "reasoning": "..."}], '
        '"summary": "..."}'
    )
    return prompt


# ── Baseline comparison prompt ───────────────────────────────────────

_BASELINE_COMPARE_RULES = (
    "You are a visual regression tester. You are shown TWO screenshots of the same page:\n"
    "- Image 1: the BASELINE (reference / known-good state)\n"
    "- Image 2: the CURRENT state (what the page looks like now)\n"
    "\n"
    "Your job: identify MEANINGFUL visual differences between the two. Ignore trivial noise.\n"
    "\n"
    "RULES:\n"
    "- Focus on STRUCTURAL differences: layout shifts, missing elements, new elements, size changes.\n"
    "- Content changes (different text, different numbers, different images) ARE meaningful — report them.\n"
    "- Anti-aliasing differences, sub-pixel rendering, and font hinting variations are NOT meaningful — ignore them.\n"
    "- If an element moved by 1-2px, mention it as minor. If it moved significantly, flag as major.\n"
    "- If you see NO meaningful differences, clearly state that the pages match.\n"
    "- For each difference: describe the region (e.g. 'top-right KPI card'), the type of change,\n"
    "  and the severity (critical/major/minor).\n"
    "- Color changes in text/background that affect readability are meaningful.\n"
    "- Be conservative: if unsure whether a difference is meaningful, mark it as minor, not critical.\n"
)


def get_baseline_compare_prompt(baseline_name: str) -> str:
    """Return the prompt for the baseline compare command."""
    return (
        _BASELINE_COMPARE_RULES
        + f'\n\nBaseline name: "{baseline_name}"'
        + '\n\nRespond ONLY with JSON: {"match": true|false, '
        + '"confidence": "high"|"medium"|"low", '
        + '"changes": [{"region": "...", "type": "added"|"removed"|"changed"|"layout_shift", '
        + '"severity": "critical"|"major"|"minor", "description": "..."}], '
        + '"summary": "..."}'
    )


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
