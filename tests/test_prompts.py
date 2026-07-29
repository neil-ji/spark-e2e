"""Tests for Tier 1 prompts: test, locate, baseline_compare."""

import pytest
from spark_e2e.prompts import (
    get_test_prompt,
    get_locate_prompt,
    get_baseline_compare_prompt,
)


class TestGetTestPrompt:
    def test_includes_expectations(self):
        prompt = get_test_prompt("sidebar has 5 items", "standard")
        assert "sidebar has 5 items" in prompt
        assert "EXPECTATIONS TO VERIFY" in prompt
        assert '"pass": true|false' in prompt

    def test_strict_mode_is_longer(self):
        std = get_test_prompt("x", "standard")
        strict = get_test_prompt("x", "strict")
        assert len(strict) > len(std)

    def test_relaxed_is_shorter_than_strict(self):
        strict = get_test_prompt("x", "strict")
        relaxed = get_test_prompt("x", "relaxed")
        assert len(relaxed) < len(strict)

    def test_multi_expectation_text(self):
        prompt = get_test_prompt(
            "A. sidebar has items\nB. cards equal height\nC. no clipping", "standard"
        )
        assert "A. sidebar has items" in prompt
        assert "B. cards equal height" in prompt
        assert "C. no clipping" in prompt


class TestGetLocatePrompt:
    def test_includes_target(self):
        prompt = get_locate_prompt("the Submit button")
        assert "the Submit button" in prompt
        assert "Find this element:" in prompt

    def test_requests_coordinates(self):
        prompt = get_locate_prompt("login link")
        assert "x" in prompt
        assert "y" in prompt
        assert "coordinates" in prompt

    def test_handles_special_chars(self):
        prompt = get_locate_prompt('button labeled "Sign In"')
        assert 'button labeled "Sign In"' in prompt

    def test_returns_found_schema(self):
        prompt = get_locate_prompt("any element")
        assert '"found": true|false' in prompt
        assert '"confidence"' in prompt


class TestGetBaselineComparePrompt:
    def test_includes_baseline_name(self):
        prompt = get_baseline_compare_prompt("dashboard-v1")
        assert "dashboard-v1" in prompt

    def test_describes_two_image_comparison(self):
        prompt = get_baseline_compare_prompt("v1")
        assert "BASELINE" in prompt
        assert "CURRENT" in prompt
        assert "TWO screenshots" in prompt

    def test_returns_match_schema(self):
        prompt = get_baseline_compare_prompt("v1")
        assert '"match": true|false' in prompt
        assert '"changes"' in prompt
        assert '"region"' in prompt

    def test_mentions_anti_aliasing(self):
        prompt = get_baseline_compare_prompt("v1")
        assert "Anti-aliasing" in prompt
