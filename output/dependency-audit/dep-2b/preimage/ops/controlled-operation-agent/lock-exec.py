"""仅给固定 OPS 执行入口传递 flock；子进程存活期间锁也不能被重新领取。"""
import fcntl
import os
from pathlib import Path
import stat
import sys


def main():
    root, node, loader, script, *arguments = sys.argv[1:]
    directory = Path(root)
    info = directory.lstat()
    if directory.resolve() != directory or not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
        raise ValueError("OPS_LOCK_ROOT_INVALID")
    expected_script = Path(__file__).resolve().with_name("run.ts")
    if Path(script).resolve() != expected_script or not Path(node).is_absolute() or not Path(loader).is_absolute():
        raise ValueError("OPS_LOCK_EXECUTABLE_INVALID")
    for index, name in enumerate(("queue-control", "production-state", "agent-local")):
        lock_path = directory / (name + ".lock")
        fd = os.open(lock_path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
        lock_info = os.fstat(fd)
        if not stat.S_ISREG(lock_info.st_mode) or lock_info.st_uid != os.getuid() or lock_info.st_mode & 0o077:
            raise ValueError("OPS_LOCK_FILE_INVALID")
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if fd != index + 3:
            os.dup2(fd, index + 3)
            os.close(fd)
        os.set_inheritable(index + 3, True)
    os.execv(node, [node, "--import", loader, script, *arguments])


try:
    main()
except BlockingIOError:
    print("OPS_LOCK_BUSY", file=sys.stderr)
    sys.exit(75)
except Exception:
    print("OPS_LOCK_REFUSED", file=sys.stderr)
    sys.exit(1)
