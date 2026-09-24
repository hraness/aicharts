import hashlib
import io
import pathlib
import sys
import tarfile
import tempfile
import unittest

sys.dont_write_bytecode = True
from prepare import extract, rust


class PreparationTests(unittest.TestCase):
    def archive(self, member, maximum=100):
        with tempfile.TemporaryDirectory() as directory:
            base = pathlib.Path(directory)
            archive = base / "fixture.tar.gz"
            with tarfile.open(archive, "w:gz") as stream:
                stream.addfile(member, io.BytesIO(b"x" * member.size) if member.isfile() else None)
            destination = base / "out"
            destination.mkdir()
            extract(str(archive), str(destination), "root", str(maximum))
            return (destination / "root/file").read_bytes()

    def test_bounded_regular_archive(self):
        member = tarfile.TarInfo("root/file")
        member.size = 3
        self.assertEqual(self.archive(member), b"xxx")
        with self.assertRaisesRegex(ValueError, "bound"):
            self.archive(member, maximum=2)

    def test_traversal_and_escaping_link(self):
        for name in ("../outside", "/absolute", "other/file"):
            with self.subTest(name=name), self.assertRaises(ValueError):
                self.archive(tarfile.TarInfo(name))
        for target in ("../outside", "../../outside", "/tmp/outside"):
            member = tarfile.TarInfo("root/file")
            member.type = tarfile.SYMTYPE
            member.linkname = target
            with self.subTest(target=target), self.assertRaises(tarfile.FilterError):
                self.archive(member)

    def test_directories_are_counted_once_and_duplicate_members_refuse(self):
        with tempfile.TemporaryDirectory() as directory:
            base = pathlib.Path(directory)
            archive = base / "fixture.tar.gz"
            member = tarfile.TarInfo("root")
            member.type = tarfile.DIRTYPE
            for duplicate in (False, True):
                with tarfile.open(archive, "w:gz") as stream:
                    stream.addfile(member)
                    if duplicate:
                        stream.addfile(member)
                destination = base / str(duplicate)
                destination.mkdir()
                if duplicate:
                    with self.assertRaisesRegex(ValueError, "duplicate"):
                        extract(str(archive), str(destination), "root", "100")
                else:
                    extract(str(archive), str(destination), "root", "100")
                    self.assertTrue((destination / "root").is_dir())

    def test_component_drift_refuses(self):
        with tempfile.TemporaryDirectory() as directory:
            base = pathlib.Path(directory)
            installed = base / "installed/lib/rustlib"
            installed.mkdir(parents=True)
            (installed / "components").write_text("rustc-host\n")
            text = ('date="2026-08-21"\n[pkg.rustc]\nversion="pinned"\n'
                    '[pkg.rustc.target.host]\navailable=true\nurl="https://official/artifact"\n'
                    f'hash="{hashlib.sha256(b"artifact").hexdigest()}"\n')
            source = base / "manifest.toml"
            source.write_text(text)
            actual = installed / "multirust-channel-manifest.toml"
            actual.write_text(text)
            rust(str(source), str(base / "installed"), "host", ["rustc"])
            actual.write_text(text.replace("pinned", "other"))
            with self.assertRaisesRegex(ValueError, "version drift"):
                rust(str(source), str(base / "installed"), "host", ["rustc"])
            actual.write_text(text.replace("https://official/artifact", "https://other/artifact"))
            with self.assertRaisesRegex(ValueError, "artifact drift"):
                rust(str(source), str(base / "installed"), "host", ["rustc"])
            (installed / "components").write_text("rustc-host\nunreviewed-host\n")
            with self.assertRaisesRegex(ValueError, "component set"):
                rust(str(source), str(base / "installed"), "host", ["rustc"])


if __name__ == "__main__":
    unittest.main()
