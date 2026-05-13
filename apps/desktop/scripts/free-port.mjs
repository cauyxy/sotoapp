#!/usr/bin/env node
import { execSync } from "node:child_process";
import { platform } from "node:os";

const port = Number(process.argv[2]);
if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  console.error("free-port: expected a port number as the first argument");
  process.exit(1);
}

const isWindows = platform() === "win32";

try {
  if (isWindows) {
    const out = execSync(`netstat -ano | findstr LISTENING | findstr :${port}`, {
      stdio: ["ignore", "pipe", "ignore"]
    }).toString();
    const pids = new Set(
      out
        .split(/\r?\n/)
        .map((line) => line.trim().split(/\s+/).pop())
        .filter((pid) => pid && /^\d+$/.test(pid))
    );
    for (const pid of pids) {
      try {
        execSync(`taskkill /F /PID ${pid}`, { stdio: "ignore" });
        console.log(`free-port: killed PID ${pid} holding :${port}`);
      } catch {
        // process already gone
      }
    }
  } else {
    const out = execSync(`lsof -ti tcp:${port}`, {
      stdio: ["ignore", "pipe", "ignore"]
    })
      .toString()
      .trim();
    if (out) {
      const pids = out.split(/\s+/).filter(Boolean);
      execSync(`kill -9 ${pids.join(" ")}`, { stdio: "ignore" });
      console.log(`free-port: killed ${pids.join(", ")} holding :${port}`);
    }
  }
} catch {
  // port was already free, or lookup tool not available — nothing to do
}
