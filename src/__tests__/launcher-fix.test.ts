import { test, expect, describe, beforeEach, afterEach, mock, spyOn } from "bun:test";
import * as procUtils from "../utils/process";
import {
  hashCwd,
  sessionNameForCwd,
  buildTmuxSessionMap,
  findTmuxSessionForPid,
  getSessionPort,
  setSessionPort,
  shellQuote,
} from "../bin/opentmux";

const NO_RUN = "OPENCODE_TMUX_NO_RUN";

describe("launcher-fix: auto_close, reclaim, reuse", () => {
  let originalNoRun: string | undefined;

  beforeEach(() => {
    originalNoRun = process.env[NO_RUN];
    process.env[NO_RUN] = "1";
  });

  afterEach(() => {
    if (originalNoRun === undefined) delete process.env[NO_RUN];
    else process.env[NO_RUN] = originalNoRun;
    mock.restore();
  });

  // ── hashCwd + sessionNameForCwd (reuse foundation) ───────────────────────

  describe("hashCwd", () => {
    test("returns deterministic 8-char hex for same input", () => {
      const a = hashCwd("/Users/djtchill/my-project");
      const b = hashCwd("/Users/djtchill/my-project");
      expect(a).toBe(b);
      expect(a).toMatch(/^[0-9a-f]{8}$/);
    });

    test("returns different hashes for different inputs", () => {
      const a = hashCwd("/Users/djtchill/project-a");
      const b = hashCwd("/Users/djtchill/project-b");
      expect(a).not.toBe(b);
    });

    test("handles empty string without throwing", () => {
      expect(() => hashCwd("")).not.toThrow();
      expect(hashCwd("")).toMatch(/^[0-9a-f]{8}$/);
    });
  });

  describe("sessionNameForCwd", () => {
    test("produces opencode- prefixed name", () => {
      expect(sessionNameForCwd("/foo")).toMatch(/^opencode-[0-9a-f]{8}$/);
    });

    test("same cwd → same session name (reuse invariant)", () => {
      expect(sessionNameForCwd("/Users/djtchill/work")).toBe(
        sessionNameForCwd("/Users/djtchill/work"),
      );
    });

    test("different cwd → different session name (no collision)", () => {
      expect(sessionNameForCwd("/a")).not.toBe(sessionNameForCwd("/b"));
    });
  });

  // ── shellQuote (security: tmux command construction) ─────────────────────

  describe("shellQuote", () => {
    test("leaves safe alphanumeric strings unquoted", () => {
      expect(shellQuote("opencode-abc123")).toBe("opencode-abc123");
    });

    test("wraps strings with spaces in single quotes", () => {
      expect(shellQuote("has space")).toBe("'has space'");
    });

    test("escapes embedded single quotes", () => {
      expect(shellQuote("it's")).toBe("'it'\\''s'");
    });

    test("quotes strings with shell metacharacters", () => {
      expect(shellQuote("a;b")).toBe("'a;b'");
      expect(shellQuote("$HOME")).toBe("'$HOME'");
    });
  });

  // ── buildTmuxSessionMap (reclaim foundation) ─────────────────────────────

  describe("buildTmuxSessionMap", () => {
    test("returns empty maps when tmux unavailable", () => {
      spyOn(procUtils, "safeExec").mockReturnValue(null);
      const map = buildTmuxSessionMap();
      expect(map.panePidToSession.size).toBe(0);
      expect(map.attachedSessions.size).toBe(0);
    });

    test("parses pane_pid → session_name mapping", () => {
      spyOn(procUtils, "safeExec").mockImplementation((cmd: string) => {
        if (cmd.includes("list-panes")) {
          return "12345 mysession\n67890 othersession";
        }
        if (cmd.includes("list-clients")) {
          return "mysession";
        }
        return null;
      });
      const map = buildTmuxSessionMap();
      expect(map.panePidToSession.get(12345)).toBe("mysession");
      expect(map.panePidToSession.get(67890)).toBe("othersession");
      expect(map.attachedSessions.has("mysession")).toBe(true);
      expect(map.attachedSessions.has("othersession")).toBe(false);
    });

    test("handles malformed pane output gracefully", () => {
      spyOn(procUtils, "safeExec").mockImplementation((cmd: string) => {
        if (cmd.includes("list-panes")) {
          return "notanumber session\n\n  \n12345 good-session";
        }
        if (cmd.includes("list-clients")) {
          return "";
        }
        return null;
      });
      const map = buildTmuxSessionMap();
      expect(map.panePidToSession.get(12345)).toBe("good-session");
      expect(map.panePidToSession.has(NaN)).toBe(false);
      expect(map.attachedSessions.size).toBe(0);
    });
  });

  // ── findTmuxSessionForPid (process-tree walk) ────────────────────────────

  describe("findTmuxSessionForPid", () => {
    test("returns session name when pid is directly a pane pid", () => {
      const map = {
        panePidToSession: new Map([[100, "sess-a"]]),
        attachedSessions: new Set<string>(),
      };
      expect(findTmuxSessionForPid(100, map)).toBe("sess-a");
    });

    test("walks up process tree to find ancestor pane pid", () => {
      const map = {
        panePidToSession: new Map([[50, "sess-root"]]),
        attachedSessions: new Set<string>(),
      };
      const getParentPid = spyOn(procUtils, "safeExec").mockImplementation(
        (cmd: string) => {
          if (cmd.includes("ppid") && cmd.includes("200")) return "50";
          if (cmd.includes("ppid") && cmd.includes("50")) return "1";
          return null;
        },
      );
      expect(findTmuxSessionForPid(200, map)).toBe("sess-root");
      expect(getParentPid).toHaveBeenCalled();
    });

    test("returns null when no ancestor is a pane pid", () => {
      const map = {
        panePidToSession: new Map([[999, "unrelated"]]),
        attachedSessions: new Set<string>(),
      };
      spyOn(procUtils, "safeExec").mockImplementation((cmd: string) => {
        if (cmd.includes("ppid") && cmd.includes("300")) return "1";
        return null;
      });
      expect(findTmuxSessionForPid(300, map)).toBeNull();
    });

    test("terminates on cycle (visited set prevents infinite loop)", () => {
      const map = {
        panePidToSession: new Map<number, string>(),
        attachedSessions: new Set<string>(),
      };
      spyOn(procUtils, "safeExec").mockImplementation((cmd: string) => {
        if (cmd.includes("ppid") && cmd.includes("400")) return "401";
        if (cmd.includes("ppid") && cmd.includes("401")) return "400";
        return null;
      });
      expect(findTmuxSessionForPid(400, map)).toBeNull();
    });
  });

  // ── getSessionPort / setSessionPort (port storage for reuse) ──────────────

  describe("getSessionPort", () => {
    test("extracts port from tmux show-environment output", () => {
      spyOn(procUtils, "safeExec").mockReturnValue("OPENCODE_PORT=4096\n");
      expect(getSessionPort("opencode-abc12345")).toBe(4096);
    });

    test("returns null when output is empty", () => {
      spyOn(procUtils, "safeExec").mockReturnValue(null);
      expect(getSessionPort("opencode-abc12345")).toBeNull();
    });

    test("returns null when env var not present in output", () => {
      spyOn(procUtils, "safeExec").mockReturnValue("SOME_OTHER_VAR=foo\n");
      expect(getSessionPort("opencode-abc12345")).toBeNull();
    });

    test("returns null when port value is not a number", () => {
      spyOn(procUtils, "safeExec").mockReturnValue("OPENCODE_PORT=notanumber\n");
      expect(getSessionPort("opencode-abc12345")).toBeNull();
    });
  });

  describe("setSessionPort", () => {
    test("calls tmux set-environment with quoted session name and port", () => {
      const spy = spyOn(procUtils, "safeExec").mockReturnValue("");
      setSessionPort("opencode-abc12345", 4100);
      expect(spy).toHaveBeenCalledWith(
        "tmux set-environment -t opencode-abc12345 OPENCODE_PORT 4100",
      );
    });

    test("quotes session names with special characters", () => {
      const spy = spyOn(procUtils, "safeExec").mockReturnValue("");
      setSessionPort("has space", 4096);
      expect(spy).toHaveBeenCalledWith(
        "tmux set-environment -t 'has space' OPENCODE_PORT 4096",
      );
    });
  });
});