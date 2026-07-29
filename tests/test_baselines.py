"""Tests for baseline storage CRUD."""

import json
import os
import shutil
import pytest
from spark_e2e.baselines import (
    save_baseline,
    load_baseline,
    list_baselines,
    delete_baseline,
    read_baseline_screenshot,
    BaselineMeta,
)


BASELINES_DIR = os.path.join(os.getcwd(), ".spark-e2e", "baselines")


@pytest.fixture(autouse=True)
def clean_baselines():
    """Remove test baselines before and after each test."""
    if os.path.isdir(BASELINES_DIR):
        shutil.rmtree(BASELINES_DIR, ignore_errors=True)
    yield
    if os.path.isdir(BASELINES_DIR):
        shutil.rmtree(BASELINES_DIR, ignore_errors=True)


class TestBaselineCRUD:
    def test_save_creates_dir_with_files(self):
        buf = b"fake-png-data"
        d = save_baseline("test-v1", buf, "http://localhost:5173",
                          {"width": 1600, "height": 1200, "deviceScaleFactor": 1})
        assert os.path.isdir(d)
        assert os.path.isfile(os.path.join(d, "screenshot.png"))
        assert os.path.isfile(os.path.join(d, "meta.json"))

        with open(os.path.join(d, "meta.json")) as f:
            meta = json.load(f)
        assert meta["name"] == "test-v1"
        assert meta["url"] == "http://localhost:5173"
        assert meta["viewport"]["width"] == 1600
        assert "timestamp" in meta

    def test_save_with_findings(self):
        buf = b"fake-data"
        findings = {"pass": True, "summary": "all good"}
        save_baseline("with-findings", buf, "http://localhost:3000",
                      {"width": 800, "height": 600, "deviceScaleFactor": 1},
                      findings=findings)

        entry = load_baseline("with-findings")
        assert entry is not None
        meta, _ = entry
        assert meta.findings == findings

    def test_load_returns_none_for_missing(self):
        assert load_baseline("nonexistent") is None

    def test_load_returns_meta_and_path(self):
        buf = b"hello"
        save_baseline("load-test", buf, "http://example.com",
                      {"width": 1024, "height": 768, "deviceScaleFactor": 2})

        entry = load_baseline("load-test")
        assert entry is not None
        meta, ss_path = entry
        assert meta.name == "load-test"
        assert meta.url == "http://example.com"
        assert meta.viewport["deviceScaleFactor"] == 2
        assert "screenshot.png" in ss_path

    def test_list_returns_empty_initially(self):
        assert list_baselines() == []

    def test_list_returns_newest_first(self):
        buf = b"x"
        save_baseline("older", buf, "http://a.com",
                      {"width": 1, "height": 1, "deviceScaleFactor": 1})
        save_baseline("newer", buf, "http://b.com",
                      {"width": 1, "height": 1, "deviceScaleFactor": 1})

        bl = list_baselines()
        assert len(bl) == 2
        assert bl[0].name == "newer"
        assert bl[1].name == "older"

    def test_delete_removes_baseline(self):
        buf = b"x"
        save_baseline("to-delete", buf, "http://x.com",
                      {"width": 1, "height": 1, "deviceScaleFactor": 1})

        assert delete_baseline("to-delete") is True
        assert load_baseline("to-delete") is None
        assert delete_baseline("to-delete") is False

    def test_read_screenshot_returns_bytes(self):
        buf = b"test-png-bytes"
        save_baseline("read-test", buf, "http://x.com",
                      {"width": 1, "height": 1, "deviceScaleFactor": 1})

        result = read_baseline_screenshot("read-test")
        assert result is not None
        assert result == b"test-png-bytes"

    def test_read_screenshot_returns_none_for_missing(self):
        assert read_baseline_screenshot("no-such") is None
