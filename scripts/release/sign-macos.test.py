#!/usr/bin/env python3
"""Behavioral tests use mocked Apple tools; no credentials or signing service."""
import base64
import gzip
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import sys
import stat
import struct
import subprocess
import tarfile
import tempfile
import unittest
from unittest.mock import patch
import zipfile

SPEC = importlib.util.spec_from_file_location("signing", Path(__file__).with_name("sign-macos.py"))
signing = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(signing)
TEAM = "A1B2C3D4E5"
VERSION = "0.3.1"
UUID = "12345678-1234-1234-1234-123456789abc"


class SigningTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="aicharts-signing-test-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        self.work = self.root / "aicharts-apple-signing"
        self.output = self.root / "signed-artifacts"
        self.archive = self.root / signing.archive_name(VERSION, unsigned=True)
        self.binary = struct.pack("<IIIIIIII", 0xFEEDFACF, 0x0100000C, 0, 2, 0, 0, 0, 0) + b"not executable"
        self.notices = {name: f"{name} text\n".encode() for name in signing.NOTICES}
        self.native_archive()
        self.calls = []
        self.search_list = [str(self.root / "login space.keychain-db"), str(self.root / "other.keychain-db")]
        self.status = "Accepted"
        self.wait_id = UUID
        self.metadata = ("Identifier=dev.hraness.aicharts\nTeamIdentifier=" + TEAM + "\n"
                         "CodeDirectory v=20500 size=100 flags=0x10000(runtime) hashes=2+7 location=embedded\n"
                         "Timestamp=Sep 30, 2026 at 2:00:00 AM\n")
        self.identity_team = TEAM
        self.tool_failure = None
        self.environment = {
            "RUNNER_TEMP": str(self.root), "HOME": str(self.root),
            "APPLE_DEVELOPER_ID_P12_BASE64": base64.b64encode(b"fake private p12").decode(),
            "APPLE_DEVELOPER_ID_P12_PASSWORD": "never-print-me",
            "APPLE_NOTARY_KEY_P8_BASE64": base64.b64encode(b"fake private p8").decode(),
            "APPLE_NOTARY_KEY_ID": "ABCDE12345", "APPLE_NOTARY_ISSUER_ID": UUID,
        }
        for active in (patch.dict(os.environ, self.environment), patch.object(signing, "TEAM_ID", TEAM),
                       patch.object(signing.sys, "platform", "darwin"), patch.object(signing, "run", self.tool)):
            active.start()
            self.addCleanup(active.stop)

    def native_archive(self, extra=False, symlink=False, notices=None):
        with tarfile.open(self.archive, "w:gz", format=tarfile.USTAR_FORMAT) as archive:
            member = tarfile.TarInfo("aicharts")
            member.size = len(self.binary)
            member.mode = 0o755
            if symlink:
                member.type = tarfile.SYMTYPE
                member.linkname = "/bin/sh"
                member.size = 0
            archive.addfile(member, None if symlink else io.BytesIO(self.binary))
            for name in signing.NOTICES if notices is None else notices:
                notice = tarfile.TarInfo(name)
                notice.size = len(self.notices[name])
                archive.addfile(notice, io.BytesIO(self.notices[name]))
            if extra:
                archive.addfile(tarfile.TarInfo("extra"))
        Path(str(self.archive) + ".sha256").write_text(signing.digest(self.archive.read_bytes()) + "  " + self.archive.name + "\n")

    def tool(self, args, timeout=60):
        args = [str(arg) for arg in args]
        self.calls.append(args)
        self.assertFalse(any(name in os.environ for name in signing.SECRET_NAMES))
        if self.tool_failure and self.tool_failure in args:
            raise signing.SigningError("mock Apple rejection")
        if "create-keychain" in args:
            Path(args[-1]).touch(mode=0o600)
            for path in (self.work / "credentials").iterdir():
                self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
        if args[:4] == ["/usr/bin/security", "list-keychains", "-d", "user"]:
            if len(args) == 4:
                return "\n".join(json.dumps(path) for path in self.search_list)
            self.assertEqual(args[4], "-s")
            self.search_list = args[5:]
            return ""
        if "delete-keychain" in args:
            self.search_list = [path for path in self.search_list if path != args[-1]]
        if "find-identity" in args:
            if str(self.work / "credentials" / "signing.keychain-db") not in self.search_list:
                return "0 valid identities found"
            return f'  1) {"A" * 40} "Developer ID Application: Example ({self.identity_team})"\n'
        if "--display" in args:
            return self.metadata
        if "notarytool" in args:
            if "submit" in args:
                self.assertEqual(timeout, 180)
                self.assertNotIn("--wait", args)
                return json.dumps({"id": UUID})
            self.assertEqual(timeout, 960)
            self.assertIn("15m", args)
            self.assertIn("wait", args)
            self.assertEqual(args[3], UUID)
            return json.dumps({"status": self.status, "id": self.wait_id})
        return ""

    def test_search_list_preserves_existing_entries_and_removes_only_owned_keychain(self):
        existing = list(self.search_list)
        self.sign()
        added = next(call for call in self.calls if call[:5] == ["/usr/bin/security", "list-keychains", "-d", "user", "-s"])
        self.assertEqual(added[5:], existing + [str(self.work / "credentials" / "signing.keychain-db")])
        self.assertEqual(self.search_list, existing)
        self.assertEqual(sum("delete-keychain" in call for call in self.calls), 1)

    def test_cancellation_after_append_preserves_another_owners_new_entry(self):
        existing = list(self.search_list)
        other = str(self.root / "concurrent-owner.keychain-db")
        def interrupted(args, timeout=60):
            result = self.tool(args, timeout)
            if list(map(str, args))[:5] == ["/usr/bin/security", "list-keychains", "-d", "user", "-s"]:
                self.search_list.append(other)
                raise SystemExit(143)
            return result
        with patch.object(signing, "run", interrupted), self.assertRaises(SystemExit) as stopped:
            self.sign()
        self.assertEqual(stopped.exception.code, 143)
        self.assertEqual(self.search_list, existing + [other])
        self.assertFalse(self.output.exists())
        self.assertFalse(self.work.exists())
        self.assertEqual(sum("list-keychains" in call and "-s" in call for call in self.calls), 1)

    def sign(self):
        signing.sign(self.archive, VERSION, self.output, self.work)

    def test_final_archive_is_signed_then_notarized_and_keychain_is_removed(self):
        self.sign()
        final = self.output / signing.archive_name(VERSION)
        self.assertTrue(final.is_file())
        self.assertEqual(Path(str(final) + ".sha256").read_text().strip(), signing.digest(final.read_bytes()) + "  " + final.name)
        root = signing.archive_root(VERSION)
        with tarfile.open(final) as archive:
            self.assertEqual([entry.name for entry in archive],
                             [root, f"{root}/bin", f"{root}/bin/aicharts", *(f"{root}/{name}" for name in signing.NOTICES)])
            self.assertEqual(archive.getmember(f"{root}/bin/aicharts").mode, 0o755)
            self.assertEqual(archive.extractfile(f"{root}/bin/aicharts").read(), self.binary)
            for name in signing.NOTICES:
                self.assertEqual(archive.extractfile(f"{root}/{name}").read(), self.notices[name])
                self.assertEqual(archive.getmember(f"{root}/{name}").mode, 0o644)
        codesign = next(args for args in self.calls if "--sign" in args)
        self.assertIn("runtime", codesign)
        self.assertIn("--timestamp", codesign)
        self.assertIn("dev.hraness.aicharts", codesign)
        self.assertIn("certificate leaf[field.1.2.840.113635.100.6.1.13] exists", codesign[-2])
        notarized = next(i for i, args in enumerate(self.calls) if "--check-notarization" in args)
        removed = next(i for i, args in enumerate(self.calls) if "delete-keychain" in args)
        self.assertLess(notarized, removed)
        self.assertFalse(self.work.exists())
        self.assertTrue(all(args[0] in ("/usr/bin/security", "/usr/bin/codesign", "/usr/bin/xcrun") for args in self.calls))
        receipt = json.loads((self.root / "aicharts-apple-notarization.json").read_text())
        self.assertEqual(receipt["submissionId"], UUID)
        self.assertEqual(receipt["status"], "Accepted")
        self.assertEqual(receipt["state"], "verified")
        self.assertEqual(receipt["signedBinarySha256"], signing.digest(self.binary))

    def test_notary_rejection_removes_credentials_and_never_creates_release(self):
        self.status = "Invalid"
        with self.assertRaisesRegex(signing.SigningError, "not Accepted"):
            self.sign()
        self.assertFalse(self.output.exists())
        self.assertFalse(self.work.exists())
        self.assertTrue(any("delete-keychain" in args for args in self.calls))
        receipt = json.loads((self.root / "aicharts-apple-notarization.json").read_text())
        self.assertEqual(receipt["submissionId"], UUID)
        self.assertEqual(receipt["status"], "Invalid")

    def test_incomplete_notary_status_is_not_success(self):
        self.status = "In Progress"
        with self.assertRaisesRegex(signing.SigningError, "not Accepted"):
            self.sign()
        self.assertFalse(self.output.exists())

    def test_wait_timeout_preserves_submission_and_exact_hashes_without_retry(self):
        def timed_out(args, timeout=60):
            if "wait" in args:
                self.calls.append([str(arg) for arg in args])
                raise RuntimeError("Apple tool failed or timed out: xcrun")
            return self.tool(args, timeout)
        with patch.object(signing, "run", timed_out):
            with self.assertRaisesRegex(RuntimeError, "timed out"):
                self.sign()
        self.assertFalse(self.output.exists())
        self.assertFalse(self.work.exists())
        receipt_text = (self.root / "aicharts-apple-notarization.json").read_text()
        receipt = json.loads(receipt_text)
        self.assertEqual(receipt["submissionId"], UUID)
        self.assertEqual(receipt["state"], "wait-incomplete")
        self.assertIsNone(receipt["status"])
        self.assertEqual(receipt["signedBinarySha256"], signing.digest(self.binary))
        self.assertEqual(receipt["unsignedArchiveSha256"], signing.digest(self.archive.read_bytes()))
        self.assertRegex(receipt["submissionZipSha256"], "^[0-9a-f]{64}$")
        self.assertEqual(sum("submit" in args for args in self.calls), 1)
        self.assertEqual(sum("wait" in args for args in self.calls), 1)
        for private in ("fake private p12", "fake private p8", "never-print-me", str(self.work)):
            self.assertNotIn(private, receipt_text)

    def test_wait_cannot_accept_a_different_submission(self):
        self.wait_id = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
        with self.assertRaisesRegex(signing.SigningError, "another submission"):
            self.sign()
        self.assertFalse(self.output.exists())
        receipt = json.loads((self.root / "aicharts-apple-notarization.json").read_text())
        self.assertEqual(receipt["submissionId"], UUID)
        self.assertEqual(receipt["state"], "wait-incomplete")
        self.assertIsNone(receipt["status"])

    def test_submit_failure_retains_hashes_and_never_retries_an_unknown_submission(self):
        self.tool_failure = "submit"
        with self.assertRaisesRegex(signing.SigningError, "mock Apple rejection"):
            self.sign()
        self.assertFalse(self.output.exists())
        self.assertFalse(self.work.exists())
        receipt = json.loads((self.root / "aicharts-apple-notarization.json").read_text())
        self.assertIsNone(receipt["submissionId"])
        self.assertEqual(receipt["state"], "submission-started")
        self.assertEqual(receipt["signedBinarySha256"], signing.digest(self.binary))
        self.assertEqual(sum("submit" in args for args in self.calls), 1)
        self.assertFalse(any("wait" in args for args in self.calls))

    def test_arbitrary_service_status_is_not_retained_in_diagnostics(self):
        self.status = "unexpected secret echoed by service"
        with self.assertRaisesRegex(signing.SigningError, "not Accepted"):
            self.sign()
        receipt_text = (self.root / "aicharts-apple-notarization.json").read_text()
        self.assertNotIn(self.status, receipt_text)
        self.assertEqual(json.loads(receipt_text)["status"], "Unrecognized")

    def test_wrong_certificate_team_is_rejected_before_signing(self):
        self.identity_team = "Z9Y8X7W6V5"
        with self.assertRaisesRegex(signing.SigningError, "expected Developer ID"):
            self.sign()
        self.assertFalse(any("--sign" in args for args in self.calls))
        self.assertFalse(self.work.exists())

    def test_hardened_runtime_and_timestamp_are_required(self):
        self.metadata = self.metadata.replace("(runtime)", "(none)")
        with self.assertRaisesRegex(signing.SigningError, "hardened runtime"):
            self.sign()
        self.assertFalse(any("notarytool" in args for args in self.calls))

    def test_missing_secure_timestamp_is_rejected(self):
        self.metadata = "\n".join(line for line in self.metadata.splitlines() if not line.startswith("Timestamp="))
        with self.assertRaisesRegex(signing.SigningError, "secure timestamp"):
            self.sign()
        self.assertFalse(any("notarytool" in args for args in self.calls))

    def test_actual_signed_metadata_must_match_expected_team(self):
        self.metadata = self.metadata.replace("TeamIdentifier=" + TEAM, "TeamIdentifier=Z9Y8X7W6V5")
        with self.assertRaisesRegex(signing.SigningError, "identity mismatch"):
            self.sign()
        self.assertFalse(self.output.exists())

    def test_term_interruption_unwinds_and_removes_credentials(self):
        def interrupted(args, timeout=60):
            if "notarytool" in args:
                # The installed SIGTERM handler raises SystemExit(143).
                raise SystemExit(143)
            return self.tool(args, timeout)
        with patch.object(signing, "run", interrupted):
            with self.assertRaises(SystemExit) as stopped:
                self.sign()
        self.assertEqual(stopped.exception.code, 143)
        self.assertFalse(self.output.exists())
        self.assertFalse(self.work.exists())
        self.assertTrue(any("delete-keychain" in args for args in self.calls))

    def test_post_notarization_verification_failure_blocks_publication(self):
        self.tool_failure = "--check-notarization"
        with self.assertRaisesRegex(signing.SigningError, "mock Apple rejection"):
            self.sign()
        self.assertFalse(self.output.exists())
        self.assertFalse(self.work.exists())

    def test_keychain_cleanup_failure_blocks_publication_and_removes_private_files(self):
        self.tool_failure = "delete-keychain"
        with self.assertRaisesRegex(signing.SigningError, "mock Apple rejection"):
            self.sign()
        self.assertFalse(self.output.exists())
        self.assertFalse(self.work.exists())

    def test_extra_tar_member_rejected_before_apple_tools(self):
        self.native_archive(extra=True)
        with self.assertRaisesRegex(signing.SigningError, "extra members"):
            self.sign()
        self.assertFalse(self.calls)
        self.assertFalse(self.work.exists())

    def test_gzip_expansion_is_bounded_before_tar_headers_are_parsed(self):
        self.archive.write_bytes(gzip.compress(b"x" * 2048))
        Path(str(self.archive) + ".sha256").write_text(signing.digest(self.archive.read_bytes()) + "  " + self.archive.name + "\n")
        with patch.object(signing, "MAX_TAR_BYTES", 1024), patch.object(signing.tarfile, "open") as parser:
            with self.assertRaisesRegex(signing.SigningError, "expanded archive byte limit"):
                self.sign()
            parser.assert_not_called()
        self.assertFalse(self.calls)
        self.assertFalse(self.work.exists())
        self.assertFalse(self.output.exists())

    def test_oversized_pax_body_cannot_make_unbounded_gzip_reads(self):
        extension = tarfile.TarInfo("extended")
        extension.type = tarfile.XHDTYPE
        extension.size = signing.MAX_TAR_BYTES * 1024
        self.archive.write_bytes(gzip.compress(extension.tobuf()))
        Path(str(self.archive) + ".sha256").write_text(signing.digest(self.archive.read_bytes()) + "  " + self.archive.name + "\n")
        original_read = gzip.GzipFile.read
        def guarded_read(stream, size=-1):
            self.assertGreaterEqual(size, 0)
            self.assertLessEqual(size, 65_536)
            return original_read(stream, size)
        with patch.object(gzip.GzipFile, "read", guarded_read):
            with self.assertRaises((tarfile.ReadError, signing.SigningError)):
                self.sign()
        self.assertFalse(self.calls)
        self.assertFalse(self.work.exists())
        self.assertFalse(self.output.exists())

    def test_symlink_payload_rejected_before_apple_tools(self):
        self.native_archive(symlink=True)
        with self.assertRaisesRegex(signing.SigningError, "regular aicharts"):
            self.sign()
        self.assertFalse(self.calls)

    def test_missing_or_reordered_notices_rejected_before_apple_tools(self):
        for notices in (signing.NOTICES[:2], tuple(reversed(signing.NOTICES))):
            self.native_archive(notices=notices)
            # sign() removes the credentials from the environment it was given.
            with patch.dict(os.environ, self.environment), \
                    self.assertRaisesRegex(signing.SigningError, "notice files in order"):
                self.sign()
        self.assertFalse(self.calls)
        self.assertFalse(self.work.exists())

    def test_unsigned_package_round_trips_through_the_signing_input_checks(self):
        binary, notices, output = self.root / "built", self.root / "notices", self.root / "unsigned"
        binary.write_bytes(self.binary)
        notices.mkdir()
        output.mkdir()
        for name, text in self.notices.items():
            (notices / name).write_bytes(text)
        archive = signing.package_unsigned(binary, notices, VERSION, output)
        self.assertEqual(archive.name, signing.archive_name(VERSION, unsigned=True))
        extracted = self.root / "extracted-binary"
        self.assertEqual(signing.unpack_native(archive, VERSION, extracted), self.notices)
        self.assertEqual(extracted.read_bytes(), self.binary)
        with self.assertRaises(FileExistsError):
            signing.package_unsigned(binary, notices, VERSION, output)
        (notices / "NOTICE.md").unlink()
        with self.assertRaises(FileNotFoundError):
            signing.package_unsigned(binary, notices, VERSION, self.root)

    def test_unsigned_package_refuses_a_non_executable_payload(self):
        binary, notices = self.root / "script", self.root / "notices"
        binary.write_bytes(b"#!/bin/sh\n")
        notices.mkdir()
        with self.assertRaisesRegex(signing.SigningError, "arm64 Mach-O"):
            signing.package_unsigned(binary, notices, VERSION, self.root)

    def test_payload_checksum_rejected_before_apple_tools(self):
        Path(str(self.archive) + ".sha256").write_text("0" * 64 + "  " + self.archive.name + "\n")
        with self.assertRaisesRegex(signing.SigningError, "checksum mismatch"):
            self.sign()
        self.assertFalse(self.calls)

    def test_payload_must_be_arm64_macho_before_apple_tools(self):
        self.binary = b"#!/bin/sh\necho payload must never run\n"
        self.native_archive()
        with self.assertRaisesRegex(signing.SigningError, "arm64 Mach-O"):
            self.sign()
        self.assertFalse(self.calls)

    def test_macho_must_be_an_executable_not_a_dylib(self):
        self.binary = self.binary[:12] + struct.pack("<I", 6) + self.binary[16:]
        self.native_archive()
        with self.assertRaisesRegex(signing.SigningError, "arm64 Mach-O executable"):
            self.sign()
        self.assertFalse(self.calls)

    def test_team_placeholder_fails_closed(self):
        with patch.object(signing, "TEAM_ID", "__AICHARTS_APPLE_TEAM_ID__"):
            with self.assertRaisesRegex(signing.SigningError, "not configured"):
                self.sign()
        self.assertFalse(self.calls)

    def artifact_zip(self, extra=None):
        path = self.root / "artifact.zip"
        with zipfile.ZipFile(path, "w") as archive:
            archive.write(self.archive, self.archive.name)
            archive.write(Path(str(self.archive) + ".sha256"), self.archive.name + ".sha256")
            if extra:
                archive.writestr(extra, b"unexpected")
        return path

    def test_exact_artifact_zip_digest_and_two_file_inventory_are_verified(self):
        archive = self.artifact_zip()
        destination = self.root / "extracted"
        signing.unpack_artifact(archive, signing.digest(archive.read_bytes()), VERSION, destination)
        self.assertEqual((destination / self.archive.name).read_bytes(), self.archive.read_bytes())

    def test_wrong_artifact_zip_digest_is_a_hard_failure(self):
        archive = self.artifact_zip()
        destination = self.root / "extracted"
        with self.assertRaisesRegex(signing.SigningError, "ZIP digest mismatch"):
            signing.unpack_artifact(archive, "0" * 64, VERSION, destination)
        self.assertFalse(destination.exists())

    def test_extra_or_traversal_zip_member_is_rejected(self):
        archive = self.artifact_zip("../escaped")
        with self.assertRaisesRegex(signing.SigningError, "exactly the unsigned archive"):
            signing.unpack_artifact(archive, signing.digest(archive.read_bytes()), VERSION, self.root / "extracted")
        self.assertFalse((self.root / "extracted").exists())

    def test_cleanup_rejects_unowned_path(self):
        with self.assertRaisesRegex(signing.SigningError, "dedicated runner"):
            signing.cleanup(self.root)
        self.assertTrue(self.root.exists())


class ToolBoundaryTests(unittest.TestCase):
    def test_subprocess_receives_no_apple_or_provider_credentials(self):
        result = subprocess.CompletedProcess([], 0, stdout="ok", stderr="")
        with patch.dict(os.environ, {"APPLE_DEVELOPER_ID_P12_PASSWORD": "private", "OPENAI_API_KEY": "private"}), \
             patch.object(signing.subprocess, "run", return_value=result) as child:
            self.assertEqual(signing.run(["/usr/bin/security", "test"]), "ok")
        self.assertEqual(set(child.call_args.kwargs["env"]), {"PATH", "HOME", "LC_ALL"})

    def test_tool_errors_do_not_echo_secret_arguments_or_output(self):
        result = subprocess.CompletedProcess([], 1, stdout="private", stderr="private")
        with patch.object(signing.subprocess, "run", return_value=result):
            with self.assertRaisesRegex(signing.SigningError, "^Apple tool failed: security$"):
                signing.run(["/usr/bin/security", "-p", "private"])


@unittest.skipUnless(sys.platform == "darwin", "requires the real macOS codesign parser")
class NativeRequirementParserTests(unittest.TestCase):
    def test_literal_designated_and_verification_requirements_use_real_parser(self):
        with tempfile.TemporaryDirectory(prefix="hraness-requirement-parser-") as folder:
            root = Path(folder)
            binary = root / "owned-fixture"
            shutil.copyfile("/usr/bin/true", binary)
            binary.chmod(0o755)
            rule = 'identifier "dev.hraness.signing-parser-fixture"'
            environment = {"PATH": "/usr/bin:/bin:/usr/sbin:/sbin", "HOME": str(root), "LC_ALL": "C"}
            def codesign(*arguments):
                return subprocess.run(["/usr/bin/codesign", *arguments, str(binary)],
                                      capture_output=True, text=True, env=environment, timeout=15)
            signed = codesign("--force", "--sign", "-", "--identifier", "dev.hraness.signing-parser-fixture",
                              "--requirements", signing.requirement_argument(rule, designated=True))
            self.assertEqual(signed.returncode, 0, signed.stderr)
            accepted = codesign("--verify", "--strict", "--test-requirement", signing.requirement_argument(rule))
            self.assertEqual(accepted.returncode, 0, accepted.stderr)
            rejected = codesign("--verify", "--strict", "--test-requirement",
                                signing.requirement_argument('identifier "other.identity"'))
            self.assertNotEqual(rejected.returncode, 0)
            self.assertIn("code failed to satisfy specified code requirement", rejected.stderr)


if __name__ == "__main__":
    unittest.main()
