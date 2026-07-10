import { spawn } from "node:child_process";
import { win32 } from "node:path";

const INSTALL_EVENTS = new Set(["--squirrel-install", "--squirrel-updated"]);

export function handleSquirrelStartup({
  platform = process.platform,
  argv = process.argv,
  execPath = process.execPath,
  quit,
  spawnProcess = spawn
}) {
  if (platform !== "win32") return false;

  const command = argv[1];
  if (command === "--squirrel-obsolete") {
    quit();
    return true;
  }

  let shortcutArgument;
  if (INSTALL_EVENTS.has(command)) {
    shortcutArgument = `--createShortcut=${win32.basename(execPath)}`;
  } else if (command === "--squirrel-uninstall") {
    shortcutArgument = `--removeShortcut=${win32.basename(execPath)}`;
  } else {
    return false;
  }

  const updateExecutable = win32.resolve(win32.dirname(execPath), "..", "Update.exe");
  const child = spawnProcess(updateExecutable, [shortcutArgument], { detached: true });
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    quit();
  };
  child.once("error", finish);
  child.once("close", finish);
  return true;
}
