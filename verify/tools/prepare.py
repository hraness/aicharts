"""Bounded extraction and Rust manifest admission for assurance-tools.ts.

Python's data filter rejects archive traversal, special files and escaping links.
Only the dated, checksum-verified Rust manifest supplies component digests.
"""

import json
import pathlib
import subprocess
import sys
import tarfile
import tomllib


def extract(archive, destination, archive_root, maximum):
    if not hasattr(tarfile, "data_filter"):
        raise ValueError("Python with tarfile.data_filter is required (3.12+)")
    destination = pathlib.Path(destination)
    if any(destination.iterdir()):
        raise ValueError("extraction destination must be empty")
    expanded = 0
    count = 0
    names = set()

    def admit(member, target):
        name = pathlib.PurePosixPath(member.name)
        if name.is_absolute() or ".." in name.parts:
            raise ValueError("archive path escapes its root")
        if archive_root != "." and name.parts[:1] != (archive_root,):
            raise ValueError("unexpected archive root")
        admitted = tarfile.data_filter(member, target)
        if member.issym() or member.islnk():
            root = destination if archive_root == "." else destination / archive_root
            parent = destination / name.parent if member.issym() else destination
            if not (parent / member.linkname).resolve().is_relative_to(root.resolve()):
                raise tarfile.FilterError("link escapes the selected archive root")
        return admitted

    def members(source):
        nonlocal expanded, count
        for member in source:
            name = str(pathlib.PurePosixPath(member.name))
            if name in names:
                raise ValueError("duplicate archive member")
            names.add(name)
            expanded += member.size
            count += 1
            if expanded > int(maximum) or count > 300_000:
                raise ValueError("expanded archive exceeds its bound")
            yield member

    process = None
    try:
        if archive.endswith(".tar.zst"):
            process = subprocess.Popen(["zstd", "--decompress", "--stdout", archive], stdout=subprocess.PIPE)
            source = tarfile.open(fileobj=process.stdout, mode="r|")
        else:
            source = tarfile.open(archive, mode="r|gz")
        with source:
            source.extractall(destination, members=members(source), filter=admit)
        if process:
            # tarfile stops at the end marker; drain bounded final padding before
            # joining zstd, so a valid final block cannot cause a SIGPIPE.
            padding = 0
            while chunk := process.stdout.read(65_536):
                padding += len(chunk)
                if padding > 1_048_576 or any(chunk):
                    raise ValueError("unexpected data after tar end marker")
            process.stdout.close()
            if process.wait() != 0:
                raise ValueError("archive decompression failed")
    finally:
        if process and process.poll() is None:
            process.kill()
            process.wait()
    print(json.dumps({"members": count, "expandedBytes": expanded}))


def rust(manifest, installed, target, components):
    source = tomllib.loads(pathlib.Path(manifest).read_text())
    root = pathlib.Path(installed) / "lib/rustlib"
    actual = tomllib.loads((root / "multirust-channel-manifest.toml").read_text())
    expected_components = {name if name == "rust-src" else f"{name}-{target}" for name in components}
    if set((root / "components").read_text().splitlines()) != expected_components:
        raise ValueError("installed Rust component set differs from the pin")
    for name in components:
        host = "*" if name == "rust-src" else target
        wanted = source["pkg"][name]
        observed = actual["pkg"][name]
        if wanted["version"] != observed["version"]:
            raise ValueError(f"Rust component version drift: {name}")
        for key in ("available", "url", "hash", "xz_url", "xz_hash"):
            if wanted["target"][host].get(key) != observed["target"][host].get(key):
                raise ValueError(f"Rust component artifact drift: {name}/{key}")
    print(json.dumps({"target": target, "components": components, "date": source["date"]}))


if __name__ == "__main__":
    if sys.argv[1] == "extract":
        extract(*sys.argv[2:])
    elif sys.argv[1] == "rust":
        rust(*sys.argv[2:5], sys.argv[5:])
    else:
        raise ValueError("unknown preparation operation")
