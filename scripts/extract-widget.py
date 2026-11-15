"""Extract an unsigned candidate into a NEW directory; reject unsafe/corrupt archives."""
import argparse
from pathlib import Path, PurePosixPath
import stat
import zipfile


def extract_widget(source, destination):
    destination = Path(destination).resolve()
    if destination.exists():
        raise ValueError("Extraction destination must not exist")
    with zipfile.ZipFile(source) as archive:
        entries = archive.infolist()
        if len(entries) > 4096 or sum(item.file_size for item in entries) > 256 * 1024 * 1024:
            raise ValueError("Widget exceeds extraction limits")
        seen = set()
        for item in entries:
            path = PurePosixPath(item.filename)
            normalized = path.as_posix().casefold().rstrip("/")
            if (not item.filename or "\\" in item.filename or ":" in item.filename
                    or not path.parts or path.is_absolute() or ".." in path.parts
                    or any(part.endswith((".", " ")) for part in path.parts)
                    or normalized in seen
                    or not (destination / item.filename).resolve().is_relative_to(destination)
                    or stat.S_ISLNK(item.external_attr >> 16)):
                raise ValueError("Unsafe or duplicate widget path")
            seen.add(normalized)
        if archive.testzip() is not None:
            raise ValueError("Corrupt widget payload")
        destination.mkdir(parents=True)
        archive.extractall(destination)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source")
    parser.add_argument("destination")
    args = parser.parse_args()
    extract_widget(args.source, args.destination)
