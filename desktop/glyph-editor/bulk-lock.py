"""Run bulk application with the same flock as the native editor and a backup."""

import fcntl
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


def main():
    os.umask(0o077)
    command = sys.argv[1:]
    project = Path(command[command.index("--project") + 1]).resolve()
    stage = Path(command[command.index("--stage") + 1]).resolve()
    if not (project / "fonts").is_dir():
        raise ValueError("Expected an existing editor project")
    with (project / ".editor.lock").open("a+b") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise SystemExit(
                "Close the editor for this project before bulk application."
            )
        backup = Path(tempfile.mkdtemp(prefix="verba-before-bulk-"))
        shutil.copytree(project / "fonts", backup / "fonts")
        for name in ["session.json", "reference-coverage.json"]:
            if (project / name).exists():
                shutil.copy2(project / name, backup / name)
        (stage / "apply-backup.json").write_text(
            json.dumps({"project": str(project), "backup": str(backup)})
        )
        print(f"Draft backup: {backup}", flush=True)
        env = {**os.environ, "VERBA_BULK_LOCK_FD": str(lock.fileno())}
        result = subprocess.run(
            command, check=False, env=env, pass_fds=(lock.fileno(),)
        )
        raise SystemExit(result.returncode)


if __name__ == "__main__":
    main()
