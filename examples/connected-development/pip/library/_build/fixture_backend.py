"""Minimal dependency-free PEP 517 / PEP 660 build backend for the fixture.

It exists only so the fixture builds without downloading a build backend from
a package index. build_editable produces a standard editable wheel whose .pth
file puts this checkout's src/ directory on sys.path.
"""

import base64
import hashlib
import os
import tomllib
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _project():
    with open(os.path.join(ROOT, "pyproject.toml"), "rb") as handle:
        project = tomllib.load(handle)["project"]
    return project["name"].replace("-", "_"), project["version"], project


def _record_line(path, data):
    digest = base64.urlsafe_b64encode(hashlib.sha256(data).digest()).rstrip(b"=").decode()
    return f"{path},sha256={digest},{len(data)}"


def _write_wheel(wheel_directory, entries):
    dist, version, project = _project()
    info = f"{dist}-{version}.dist-info"
    metadata = (
        "Metadata-Version: 2.1\n"
        f"Name: {project['name']}\nVersion: {version}\n"
        f"Summary: {project.get('description', '')}\n"
        f"Requires-Python: {project.get('requires-python', '')}\n"
    )
    wheel = "Wheel-Version: 1.0\nGenerator: fixture_backend\nRoot-Is-Purelib: true\nTag: py3-none-any\n"
    entries = dict(entries)
    entries[f"{info}/METADATA"] = metadata.encode()
    entries[f"{info}/WHEEL"] = wheel.encode()
    record = [_record_line(path, data) for path, data in entries.items()]
    record.append(f"{info}/RECORD,,")
    entries[f"{info}/RECORD"] = ("\n".join(record) + "\n").encode()
    name = f"{dist}-{version}-py3-none-any.whl"
    with zipfile.ZipFile(os.path.join(wheel_directory, name), "w") as archive:
        for path, data in entries.items():
            archive.writestr(path, data)
    return name


def get_requires_for_build_wheel(config_settings=None):
    return []


def get_requires_for_build_editable(config_settings=None):
    return []


def build_wheel(wheel_directory, config_settings=None, metadata_directory=None):
    src = os.path.join(ROOT, "src")
    entries = {}
    for directory, _, files in os.walk(src):
        for filename in files:
            if filename.endswith(".py"):
                path = os.path.join(directory, filename)
                with open(path, "rb") as handle:
                    entries[os.path.relpath(path, src).replace(os.sep, "/")] = handle.read()
    return _write_wheel(wheel_directory, entries)


def build_editable(wheel_directory, config_settings=None, metadata_directory=None):
    dist, _, _ = _project()
    return _write_wheel(wheel_directory, {f"{dist}.pth": (os.path.join(ROOT, "src") + "\n").encode()})
