#!/usr/bin/env python3
"""Validate the native assurance corpus or replay explicitly selected local tools.

No arguments only checks data and hashes. Execution needs --cli and/or both
--cursor-rustc and --rust-deps. See the adjacent corpus README for exit codes.
"""

import argparse
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import selectors
import shutil
import signal
import subprocess
import sys
import tempfile
import time


REPO = Path(__file__).resolve().parent.parent
CORPUS = REPO / "fixtures/usage/assurance/native"
FINDINGS = ("F01", "F05", "F06", "F07", "F08")
KEY = b"Q" * 32  # Public, deterministic fixture material; never a user key.
MAX_INPUT = 1024 * 1024
MAX_OUTPUT = 1024 * 1024
OVERSIZED_SOURCE_BYTES = 256 * 1024 * 1024 + 1


class HarnessError(Exception):
    """An unmet harness precondition, never evidence of a product repair."""


def digest(data):
    return hashlib.sha256(data).hexdigest()


def read_bounded(path, ceiling=MAX_INPUT):
    with path.open("rb") as stream:
        data = stream.read(ceiling + 1)
    if len(data) > ceiling:
        raise HarnessError(f"input exceeds bound: {path.name}")
    return data


def object_at(path):
    value = json.loads(read_bounded(path))
    if not isinstance(value, dict):
        raise HarnessError(f"expected JSON object: {path.name}")
    return value


def relative_file(base, relative):
    path = base / relative
    if path.is_symlink() or not path.is_file() or not path.resolve().is_relative_to(base):
        raise HarnessError("fixture or subject must be a regular contained file")
    return path


def validate_corpus(subject_root):
    manifest = object_at(CORPUS / "manifest.json")
    if manifest.get("schemaVersion") != 1 or set(manifest.get("cases", {})) != set(FINDINGS):
        raise HarnessError("unsupported corpus manifest")
    validate_oversized_source_bytes(manifest["cases"]["F06"]["inputs"]["sourceBytes"])
    for relative, expected in manifest["fixtureSha256"].items():
        actual = digest(read_bounded(relative_file(CORPUS, relative)))
        if actual != expected:
            raise HarnessError(f"fixture hash mismatch: {relative}")
    drift = []
    for relative, expected in manifest["subjectSourceSha256"].items():
        actual = digest(read_bounded(relative_file(subject_root, relative), 4 * MAX_INPUT))
        if actual != expected:
            drift.append(relative)
    trace = object_at(CORPUS / "autosubmit-descendant-trace.json")
    if trace.get("runtimeReproduced") is not False or trace.get("evidence") != "source-trace-only":
        raise HarnessError("F14 must remain explicitly source-traced")
    receipt = object_at(CORPUS / "baseline-receipt.json")
    if any(receipt.get(key) != manifest[key] for key in (
        "baselineCommit", "fixtureSha256", "subjectSourceSha256",
    )):
        raise HarnessError("retained baseline receipt no longer matches the corpus")
    if set(receipt.get("cases", {})) != set(FINDINGS) or any(
        classification(receipt["cases"][finding]["observed"], manifest["cases"][finding])
        != "baseline_counterexample" for finding in FINDINGS
    ):
        raise HarnessError("retained receipt must reproduce each exact baseline predicate")
    return manifest, drift


def validate_oversized_source_bytes(value):
    if type(value) is not int or value != OVERSIZED_SOURCE_BYTES:
        raise HarnessError("F06 requires exactly the frozen 268435457-byte sparse fixture")
    return value


def bounded_command(argv, cwd, env, timeout):
    # This standalone POSIX runner has no competing child waiter. Keep the
    # group leader unreaped until failure cleanup, so its PID pins the group.
    if os.name != "posix" or signal.getsignal(signal.SIGCHLD) != signal.SIG_DFL:
        raise HarnessError("execution requires POSIX with ordinary child ownership")
    process = subprocess.Popen(
        [str(arg) for arg in argv], cwd=cwd, env=env, stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True,
    )
    streams = (process.stdout, process.stderr)
    buffers = [bytearray(), bytearray()]
    received = 0
    deadline = time.monotonic() + timeout
    try:
        with selectors.DefaultSelector() as selector:
            for index, stream in enumerate(streams):
                os.set_blocking(stream.fileno(), False)
                selector.register(stream, selectors.EVENT_READ, index)
            while selector.get_map():
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise HarnessError("selected local command exceeded its deadline")
                for key, _ in selector.select(remaining):
                    try:
                        chunk = os.read(key.fileobj.fileno(), min(65536, MAX_OUTPUT - received + 1))
                    except BlockingIOError:
                        continue
                    if not chunk:
                        selector.unregister(key.fileobj)
                        continue
                    received += len(chunk)
                    if received > MAX_OUTPUT:
                        raise HarnessError("selected local command exceeded its output bound")
                    buffers[key.data].extend(chunk)
        try:
            code = process.wait(timeout=max(0.001, deadline - time.monotonic()))
        except subprocess.TimeoutExpired as error:
            raise HarnessError("selected local command exceeded its deadline") from error
    except BaseException:
        if process.returncode is None:
            # No wait/poll has reaped this leader. Kill the fresh owned group
            # before waiting, including compiler children holding the pipes.
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired as error:
                raise HarnessError("owned local command did not settle after cleanup") from error
        raise
    finally:
        for stream in streams:
            stream.close()
    return code, bytes(buffers[0]), bytes(buffers[1])


def executable(raw):
    path = Path(raw).resolve(strict=True)
    if not path.is_file() or not os.access(path, os.X_OK):
        raise HarnessError("selected tool is not an executable regular file")
    return path


def tool_hash(path):
    checksum = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(MAX_INPUT), b""):
            checksum.update(block)
    return checksum.hexdigest()


class Run:
    def __init__(self, root, cli, subject_root):
        self.root = root
        self.cli = cli
        self.subject_root = subject_root
        self.key = root / "fixture.key"
        self.key.write_bytes(KEY)
        self.key.chmod(0o600)
        # No inherited provider credentials, proxy variables, or home directory.
        # Every product invocation also supplies its source and state explicitly.
        self.env = {"PATH": "/usr/bin:/bin", "LANG": "C", "TZ": "UTC", "TMPDIR": str(root)}

    def command(self, argv, timeout=90):
        code, out_bytes, error_bytes = bounded_command(argv, self.root, self.env, timeout)
        stdout = out_bytes.decode("utf-8", errors="strict").strip()
        stderr = error_bytes.decode("utf-8", errors="strict").strip()
        stderr = stderr.replace(str(self.root), "<scratch>").replace(str(REPO), "<repo>")
        try:
            output = json.loads(stdout)
        except json.JSONDecodeError:
            output = None
        # Only owned numeric projections and fixed errors are retained. In
        # particular, initialization prose and dynamic timestamps are omitted.
        return {"exit": code, "error": stderr, "json": output}

    def invoke(self, *args):
        return self.command([self.cli, *args])

    def initialize(self, name):
        state = self.root / name
        result = self.invoke("init", "--state-dir", state, "--key-file", self.key)
        if result["exit"] != 0:
            raise HarnessError(f"synthetic ledger initialization failed: {result['error']}")
        return state

    def collect(self, state, source, provider):
        return self.invoke(
            "collect", "--state-dir", state, "--key-file", self.key,
            f"--{provider}", source, "--json",
        )

    def status(self, state):
        return self.invoke("status", "--state-dir", state, "--key-file", self.key, "--json")

    def fixture(self, name, destination):
        path = self.root / destination
        path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(CORPUS / name, path)
        return path


def projection(result, keys):
    projected = {"exit": result["exit"], "error": result["error"]}
    value = result["json"]
    if isinstance(value, dict):
        projected.update({key: value[key] for key in keys if key in value})
    return projected


LEDGER_FIELDS = (
    "ledgerRevision", "committedRevision", "sources", "associations", "usageOccurrences",
    "tokens", "outputTokens", "sourcesSkipped", "bytesScanned", "warnings",
)


def ledger_projection(result):
    return projection(result, LEDGER_FIELDS)


def matches(actual, expected):
    """Dictionaries are partial projections; list order and length are exact."""
    if isinstance(expected, dict):
        return isinstance(actual, dict) and all(
            key in actual and matches(actual[key], value) for key, value in expected.items()
        )
    if isinstance(expected, list):
        return isinstance(actual, list) and len(actual) == len(expected) and all(
            matches(left, right) for left, right in zip(actual, expected)
        )
    return actual == expected


def classification(observed, spec):
    baseline = matches(observed, spec["baseline"])
    repaired = matches(observed, spec["repaired"])
    if baseline == repaired:
        return "unexpected"
    return "baseline_counterexample" if baseline else "repaired_contract"


def attribution(run, _spec):
    files = [run.fixture(f"claude-known-owner-{suffix}.jsonl", f"owner-{suffix}.jsonl")
             for suffix in ("a", "b")]

    def source_id(path):
        raw = os.fsencode(path.resolve())
        message = b"aicharts-local-source-v1\0" + bytes([2]) + len(raw).to_bytes(8, "little") + raw
        return hmac.new(KEY, message, hashlib.sha256).digest()

    ordered = sorted(files, key=source_id)
    if source_id(ordered[0]) == source_id(ordered[1]):
        raise HarnessError("synthetic source IDs must be distinct")
    observed = {}
    for name, sources in (("ascending", ordered), ("descending", list(reversed(ordered)))):
        state = run.initialize(f"attribution-{name}")
        first = run.collect(state, sources[0], "claude")
        second = run.collect(state, sources[1], "claude")
        reopened = run.status(state)
        observed[name] = {
            "first": ledger_projection(first), "second": ledger_projection(second),
            "reopened": ledger_projection(reopened),
        }
    return observed


def stats_projection(result):
    projected = projection(result, ("profile", "sources"))
    value = result["json"]
    if isinstance(value, dict) and isinstance(value.get("rows"), list):
        projected["rows"] = len(value["rows"])
        projected["tokens"] = str(sum(
            int(row["tokens"][bucket]) for row in value["rows"]
            for bucket in ("input", "cacheRead", "cacheWrite", "output", "reasoning")
        ))
        projected["records"] = sum(row["records"] for row in value["rows"])
    return projected


def mtime(run, spec):
    path = run.fixture(
        "codex-mtime.jsonl",
        "mtime-home/logs/rollout-2026-09-20T10-00-00-0192f3a4-5b6c-7d8e-9f01-23456789abcd.jsonl",
    )
    args = (
        "stats", "--home", path.parent.parent, "--client", "codex", "--source-root", path.parent,
        "--since", "2026-09-20", "--until", "2026-09-20", "--json",
    )
    before = digest(path.read_bytes())
    recent = spec["inputs"]["recentMtimeSeconds"]
    old = spec["inputs"]["oldMtimeSeconds"]
    os.utime(path, (recent, recent))
    fresh = run.invoke(*args)
    os.utime(path, (old, old))
    stale = run.invoke(*args)
    return {
        "sourceBytesUnchanged": before == digest(path.read_bytes()),
        "recent": stats_projection(fresh), "old": stats_projection(stale),
    }


def oversized(run, spec):
    source_bytes = validate_oversized_source_bytes(spec["inputs"]["sourceBytes"])
    source = run.fixture("claude-known-owner-a.jsonl", "oversized.jsonl")
    control = run.collect(run.initialize("oversized-control"), source, "claude")
    with source.open("r+b") as stream:
        stream.truncate(source_bytes)
    state = run.initialize("oversized-state")
    collect = run.collect(state, source, "claude")
    return {
        "control": ledger_projection(control), "sourceBytes": source.stat().st_size,
        "collect": ledger_projection(collect), "reopened": ledger_projection(run.status(state)),
    }


def warning(run, _spec):
    source = run.fixture("devin-totals-mismatch.json", "devin.json")
    ephemeral = run.invoke("usage", "--key-file", run.key, "--devin", source, "--json")
    state = run.initialize("devin-state")
    persisted = run.collect(state, source, "devin")
    return {
        "ephemeral": ledger_projection(ephemeral), "persisted": ledger_projection(persisted),
        "reopened": ledger_projection(run.status(state)),
    }


def extract_function(source, name):
    # These rustfmt top-level functions end with an unindented closing brace.
    # A changed layout/signature must fail qualification, not run a stale copy.
    pattern = rf"(?ms)^fn {name}\(.*?^\}}"
    found = re.findall(pattern, source)
    if len(found) != 1:
        raise HarnessError(f"Cursor extraction requires one top-level {name} function")
    return found[0]


def cursor(run, _spec, rustc, deps):
    source = read_bounded(run.subject_root / "crates/aicharts-cli/src/source_refresh.rs").decode("utf-8")
    pieces = []
    for name in ("MAX_BYTES", "OVERLAP_MS", "FIRST_RUN_MS", "INVALID", "LIMIT"):
        found = re.findall(rf"(?m)^const {name}: .*;$", source)
        if len(found) != 1:
            raise HarnessError(f"Cursor extraction requires one {name} constant")
        pieces.append(found[0])
    pieces.append("type Result<T> = std::result::Result<T, &'static str>;")
    for name in ("integer", "cents", "text", "day", "project", "latest_event_ms", "merge"):
        pieces.append(extract_function(source, name))
    planner = re.findall(r"(?ms)^    let since_ms = match cache_latest_ms \{.*?^    \};", source)
    if len(planner) != 1:
        raise HarnessError("Cursor range planner changed; review the extraction seam")
    wrapper = read_bounded(CORPUS / "cursor-harness.rs").decode("utf-8")
    wrapper = wrapper.replace("// ASSURANCE_PRODUCTION_HELPERS", "\n\n".join(pieces))
    wrapper = wrapper.replace("    // ASSURANCE_PRODUCTION_RANGE", planner[0])
    generated = run.root / "cursor_assurance.rs"
    generated.write_text(wrapper, encoding="utf-8")
    binary = run.root / "cursor_assurance"
    command = [rustc, "--edition=2021", "--crate-name", "cursor_assurance", generated,
               "-L", f"dependency={deps}", "-o", binary]
    libraries = {}
    for name in ("serde_json", "time"):
        found = sorted(deps.glob(f"lib{name}-*.rlib"))
        if len(found) != 1:
            raise HarnessError(f"Cursor requires exactly one {name} rlib in the selected deps directory")
        command.extend(["--extern", f"{name}={found[0]}"])
        libraries[name] = tool_hash(found[0])
    compiled = run.command(command, timeout=120)
    if compiled["exit"] != 0:
        raise HarnessError(f"Cursor extracted-source compilation failed: {compiled['error']}")
    result = run.command([binary, CORPUS / "cursor-partial-day.json"])
    if result["exit"] != 0 or not isinstance(result["json"], dict):
        raise HarnessError(f"Cursor extracted-source execution failed: {result['error']}")
    return result["json"], {
        "kind": "source-extracted-functions-and-range-planner",
        "networkExercised": False, "authenticatedAcquisitionExercised": False,
        "extractedSourceSha256": digest(("\n\n".join(pieces) + planner[0]).encode()),
        "linkedLibrarySha256": libraries,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cli", help="explicit trusted local aicharts binary; never PATH discovery")
    parser.add_argument("--cursor-rustc", help="explicit trusted rustc for the extracted-source F07 probe")
    parser.add_argument("--rust-deps", help="existing matching Cargo debug/deps directory; no build/download")
    parser.add_argument("--subject-root", type=Path, default=REPO,
                        help="source tree or preserved subject snapshot; defaults to this repository")
    parser.add_argument("--cases", default=",".join(FINDINGS), help="comma-separated finding IDs")
    parser.add_argument("--expect", choices=("baseline", "repaired"), default="baseline")
    args = parser.parse_args()
    selected = args.cases.split(",")
    if not selected or len(selected) != len(set(selected)) or not set(selected) <= set(FINDINGS):
        parser.error("--cases requires unique IDs from " + ",".join(FINDINGS))
    execute = bool(args.cli or args.cursor_rustc or args.rust_deps)
    if execute and set(selected) - {"F07"} and not args.cli:
        parser.error("selected native cases require --cli")
    if execute and "F07" in selected and not (args.cursor_rustc and args.rust_deps):
        parser.error("F07 execution requires --cursor-rustc and --rust-deps")
    try:
        subject_root = args.subject_root.resolve(strict=True)
        manifest, drift = validate_corpus(subject_root)
        report = {
            "schemaVersion": 1, "mode": "execute" if execute else "validate",
            "baselineCommit": manifest["baselineCommit"], "subjectSourceDrift": drift,
            "expected": args.expect, "traceOnly": ["F14"], "cases": {},
        }
        if not execute:
            report["outcome"] = "corpus_validated_no_product_execution"
            print(json.dumps(report, indent=2, sort_keys=True))
            return 0
        if args.expect == "baseline" and drift:
            raise HarnessError("baseline subject source changed; use the retained baseline tree or review a repaired run")
        cli = executable(args.cli) if args.cli else None
        rustc = executable(args.cursor_rustc) if args.cursor_rustc else None
        deps = Path(args.rust_deps).resolve(strict=True) if args.rust_deps else None
        if deps is not None and not deps.is_dir():
            raise HarnessError("--rust-deps must be a directory")
        report["tools"] = {}
        for name, path in (("cli", cli), ("rustc", rustc)):
            if path is not None:
                report["tools"][name] = {"sha256": tool_hash(path)}
        report["binaryProvenance"] = "Caller-supplied executable; source hashes do not attest the binary."
        implementations = {"F01": attribution, "F05": mtime, "F06": oversized, "F08": warning}
        with tempfile.TemporaryDirectory(prefix="aicharts-native-assurance-") as temporary:
            root = Path(temporary).resolve()
            root.chmod(0o700)
            run = Run(root, cli, subject_root)
            for finding in selected:
                spec = manifest["cases"][finding]
                if finding == "F07":
                    observed, evidence = cursor(run, spec, rustc, deps)
                else:
                    observed = implementations[finding](run, spec)
                    evidence = {"kind": "native-cli", "networkExercised": False}
                report["cases"][finding] = {
                    "classification": classification(observed, spec),
                    "observed": observed, "evidence": evidence,
                }
        states = {case["classification"] for case in report["cases"].values()}
        expected = "baseline_counterexample" if args.expect == "baseline" else "repaired_contract"
        if "unexpected" in states:
            report["outcome"], exit_code = "unexpected_behavior", 1
        elif states == {expected}:
            report["outcome"], exit_code = f"all_{expected}", 0
        else:
            report["outcome"], exit_code = "known_behavior_differs_from_expectation", 3
        print(json.dumps(report, indent=2, sort_keys=True))
        return exit_code
    except (HarnessError, OSError, ValueError, KeyError, TypeError) as error:
        print(json.dumps({"schemaVersion": 1, "outcome": "harness_error", "error": str(error)}, sort_keys=True))
        return 1


if __name__ == "__main__":
    sys.exit(main())
