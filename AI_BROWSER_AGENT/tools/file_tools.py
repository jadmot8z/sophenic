from pathlib import Path


class FileTools:
    def __init__(self, data_dir: Path):
        self.root = (data_dir / "uploads").resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def list_files(self):
        return [p.name for p in self.root.iterdir() if p.is_file() and not p.is_symlink()]

    def resolve_upload(self, name):
        if not name or Path(name).name != name or "/" in name or "\\" in name:
            raise ValueError("Nom de fichier simple requis")
        candidate = self.root / name
        path = candidate.resolve()
        if candidate.is_symlink() or path.parent != self.root or not path.is_file():
            raise ValueError("Fichier absent du dossier uploads autorisé")
        return str(path)
