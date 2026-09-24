"""Check that the audit harness cannot mislabel a known defect as a repair."""

from contextlib import redirect_stdout
from copy import deepcopy
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch


ROOT = Path(__file__).resolve().parents[4]
SPEC = importlib.util.spec_from_file_location("native_assurance", ROOT / "scripts/assurance-native-baseline.py")
RUNNER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(RUNNER)


class HarnessTests(unittest.TestCase):
    def setUp(self):
        self.manifest, _ = RUNNER.validate_corpus(ROOT)

    def test_default_never_invokes_a_subprocess(self):
        output = io.StringIO()
        with patch("sys.argv", ["assurance-native-baseline.py"]), \
                patch.object(RUNNER.subprocess, "Popen", side_effect=AssertionError("unexpected execution")), \
                redirect_stdout(output):
            self.assertEqual(RUNNER.main(), 0)
        self.assertEqual(json.loads(output.getvalue())["outcome"], "corpus_validated_no_product_execution")

    def test_every_contract_distinguishes_baseline_from_repair(self):
        for finding, spec in self.manifest["cases"].items():
            with self.subTest(finding=finding):
                self.assertEqual(RUNNER.classification(spec["baseline"], spec), "baseline_counterexample")
                self.assertEqual(RUNNER.classification(spec["repaired"], spec), "repaired_contract")
                self.assertEqual(RUNNER.classification({}, spec), "unexpected")

    def test_unrelated_errors_do_not_qualify_as_attribution_repairs(self):
        spec = self.manifest["cases"]["F01"]
        for field in ("error", "exit"):
            repaired = deepcopy(spec["repaired"])
            repaired["descending"]["second"][field] = "unrelated failure"
            self.assertEqual(RUNNER.classification(repaired, spec), "unexpected")
        repaired = deepcopy(spec["repaired"])
        repaired["ascending"]["reopened"]["ledgerRevision"] = 2
        self.assertEqual(RUNNER.classification(repaired, spec), "unexpected")

    def test_cursor_event_count_alone_does_not_qualify_preservation(self):
        spec = self.manifest["cases"]["F07"]
        repaired = deepcopy(spec["repaired"])
        repaired["mergedTimestamps"][0] += 1
        self.assertEqual(RUNNER.classification(repaired, spec), "unexpected")

    def test_warning_loss_on_reopen_does_not_qualify_as_repair(self):
        spec = self.manifest["cases"]["F08"]
        repaired = deepcopy(spec["repaired"])
        repaired["reopened"]["warnings"].remove("devin_totals_mismatch")
        self.assertEqual(RUNNER.classification(repaired, spec), "unexpected")

    def test_bad_sparse_lengths_refuse_before_creating_any_file(self):
        for value in (True, False, -1, 0, "268435457", 268435456, 268435458, 10**30):
            with self.subTest(value=value):
                run = Mock()
                with self.assertRaisesRegex(RUNNER.HarnessError, "frozen"):
                    RUNNER.oversized(run, {"inputs": {"sourceBytes": value}})
                run.fixture.assert_not_called()

    @unittest.skipUnless(os.name == "posix", "execution is POSIX-qualified")
    def test_streaming_output_cap_and_deadline_settle_the_owned_child(self):
        scripts = [
            ("import os; os.write(1,b'x'*40); os.write(2,b'y'*40)", 2, "output bound"),
            ("import os,time; os.close(1); os.close(2); time.sleep(30)", 0.1, "deadline"),
        ]
        original_popen = RUNNER.subprocess.Popen
        for source, timeout, error in scripts:
            with self.subTest(error=error), tempfile.TemporaryDirectory() as temporary:
                children = []

                def spawn(*args, **kwargs):
                    process = original_popen(*args, **kwargs)
                    children.append(process)
                    return process

                with patch.object(RUNNER, "MAX_OUTPUT", 64), \
                        patch.object(RUNNER.subprocess, "Popen", side_effect=spawn), \
                        self.assertRaisesRegex(RUNNER.HarnessError, error):
                    RUNNER.bounded_command([sys.executable, "-c", source], Path(temporary), {}, timeout)
                self.assertEqual(len(children), 1)
                self.assertIsNotNone(children[0].returncode)
                with self.assertRaises(ChildProcessError):
                    os.waitpid(children[0].pid, os.WNOHANG)


if __name__ == "__main__":
    unittest.main()
