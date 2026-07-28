"""CLI integration tests for spark-e2e."""
import subprocess
import sys
import pytest


def run_cli(*args: str) -> "subprocess.CompletedProcess[str]":
    """Run the spark-e2e CLI with given args and capture output."""
    return subprocess.run(
        [sys.executable, "-m", "spark_e2e", *args],
        capture_output=True,
        text=True,
        timeout=10,
    )


class TestCLIHelp:
    """Test that CLI help output is correct."""

    @pytest.mark.parametrize("cmd,expected", [
        ("--help", "doctor"),
        ("--help", "snapshot"),
        ("--help", "review"),
        ("--help", "assert"),
        ("--help", "scroll"),
    ])
    def test_help_contains_commands(self, cmd, expected):
        """Main --help should list all expected commands."""
        result = run_cli(cmd)
        output = (result.stdout or "") + (result.stderr or "")
        assert expected in output, f"'{expected}' not found in: {output[:200]}"

    def test_setup_help(self):
        """Python CLI help should list available commands."""
        result = run_cli("--help")
        output = (result.stdout or "") + (result.stderr or "")
        assert "doctor" in output or "Commands" in output or "positional arguments" in output


class TestCLICommands:
    """Test that CLI commands are correctly registered."""

    def test_init_removed(self):
        """'init' should NOT be a command anymore."""
        result = run_cli("init", "--help")
        output = (result.stdout or "") + (result.stderr or "")
        # Should either fail with "invalid choice" or show something else
        assert "invalid choice" in output.lower() or "unknown" in output.lower() or result.returncode != 0

    def test_no_init_in_help(self):
        """'init' should not appear in the main help text."""
        result = run_cli("--help")
        output = (result.stdout or "") + (result.stderr or "")
        # "init" could appear in other contexts, but the subcommand section
        # should use indented command names like "  setup", "  navigate"
        lines = output.split("\n")
        init_lines = [l for l in lines if l.strip().startswith("init")]
        assert len(init_lines) == 0, f"'init' found in commands list: {init_lines}"


class TestCLIErrorHandling:
    """Test CLI error handling."""

    def test_no_args_shows_help(self):
        """Running with no args should show usage info."""
        result = run_cli()
        output = (result.stdout or "") + (result.stderr or "")
        assert "usage" in output.lower() or "Usage" in output

    def test_unknown_command(self):
        """Unknown commands should produce error."""
        result = run_cli("nonexistent-command-xyz")
        output = (result.stdout or "") + (result.stderr or "")
        # Should produce some kind of error or help
        assert len(output) > 0

    def test_help_has_nonzero_exit(self):
        """--help should exit cleanly."""
        result = run_cli("--help")
        assert result.returncode == 0


class TestCLIDoctor:
    """Test the doctor command exists and works."""

    def test_doctor_runs(self):
        """doctor should run without crashing."""
        result = run_cli("doctor")
        # doctor should exit 0 and produce output
        assert result.returncode == 0
        output = (result.stdout or "") + (result.stderr or "")
        assert len(output) > 0
