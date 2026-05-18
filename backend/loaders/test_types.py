import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from loaders.base import BaseTestTypeLoader
from loaders.metadata import MetadataLoader
from loaders.cycling import CyclingFileLoader

TEST_TYPES: list[type] = [MetadataLoader, CyclingFileLoader]


def get_loader(filename: str, preferred_file_type: str | None = None) -> BaseTestTypeLoader | None:
    suffix = Path(filename).suffix.lower()
    if preferred_file_type:
        for cls in TEST_TYPES:
            if cls.FILE_TYPE == preferred_file_type and suffix in cls.SUPPORTED_EXTENSIONS:
                return cls()
        return None
    for cls in TEST_TYPES:
        if suffix in cls.SUPPORTED_EXTENSIONS:
            return cls()
    return None


def test_type_manifest() -> list[dict]:
    return [
        {
            "fileType": cls.FILE_TYPE,
            "displayName": cls.DISPLAY_NAME,
            "description": cls.DESCRIPTION,
            "extensions": cls.SUPPORTED_EXTENSIONS,
        }
        for cls in TEST_TYPES
    ]
