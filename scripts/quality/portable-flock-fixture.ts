import { chmodSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const systemFlock = spawnSync("sh", ["-c", "command -v flock"], { encoding: "utf8" }).stdout.trim();

export function prepareRealFlockCommand(fallbackPath: string): string {
  if (systemFlock) return systemFlock;

  const python = spawnSync("python3", ["--version"], { stdio: "ignore" });
  if (python.status !== 0) {
    throw new Error("FAIL: real flock contention requires either flock or python3");
  }

  writeFileSync(fallbackPath, `#!/usr/bin/env python3
import fcntl
import os
import subprocess
import sys

args = sys.argv[1:]
if args == ["--version"]:
    print("areaforge portable flock fixture 1")
    raise SystemExit(0)

nonblocking = False
unlock = False
while args and args[0].startswith("-"):
    option = args.pop(0)
    if option == "-n":
        nonblocking = True
    elif option == "-u":
        unlock = True
    elif option == "--":
        break
    else:
        raise SystemExit(64)

if not args:
    raise SystemExit(64)

target = args.pop(0)
operation = fcntl.LOCK_UN if unlock else fcntl.LOCK_EX
if nonblocking and not unlock:
    operation |= fcntl.LOCK_NB

def apply_lock(fd):
    try:
        fcntl.flock(fd, operation)
    except BlockingIOError:
        raise SystemExit(1)

if target.isdigit():
    apply_lock(int(target))
    raise SystemExit(0)

if unlock:
    raise SystemExit(64)

fd = os.open(target, os.O_CREAT | os.O_RDWR, 0o600)
try:
    apply_lock(fd)
    status = subprocess.run(args).returncode if args else 0
finally:
    fcntl.flock(fd, fcntl.LOCK_UN)
    os.close(fd)
raise SystemExit(status)
`);
  chmodSync(fallbackPath, 0o755);
  return fallbackPath;
}
