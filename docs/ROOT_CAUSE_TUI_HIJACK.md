# Root Cause: opentmux TUI input hijack

## Summary

Phase 0 established that the parent-visible corruption is not explained by tmux mouse modes being left on. The strongest byte-level evidence shows unbalanced `?1049h` (alternate-screen enable) and `?2004h` (bracketed-paste enable) in the parent stream after split/close, while the corresponding disables are absent in those captures; by contrast, tmux mouse modes appear repeatedly as disables, not enables. The baseline captures also show that the same `?1049h`/`?2004h` signature appears in split/kill traces even before the fake child's own mouse enables ever surface in the parent stream. See `.sisyphus/evidence/tui-hijack/baselines-analysis.md:12-32`, `.sisyphus/evidence/tui-hijack/baselines-analysis.md:44-87`, and `.sisyphus/evidence/tui-hijack/baselines-analysis.md:89-132`.

The minimum evidence-backed direction is: use OpenCode's built-in mouse suppression path at spawn time (`OPENCODE_DISABLE_MOUSE=1`) as the first live validation step, keep T12/T13/T14 as the core defense-in-depth close/redraw fixes, keep T18 as a safe hardening task, defer T11/T15/T16 until live validation narrows the residual bug, and cut T17 because `TERM_PROGRAM` is not reliably available inside tmux panes. That recommendation is grounded in the OpenCode flag/source scan, the signal-cleanup timing analysis, the unchanged diagnostic matrix, and the Ghostty env analysis. See `.sisyphus/evidence/tui-hijack/opencode-cli-flags.md:35-71`, `.sisyphus/evidence/tui-hijack/strace-analysis.md:15-22`, `.sisyphus/evidence/tui-hijack/diag-summary.md:12-31`, and `.sisyphus/evidence/tui-hijack/term-program-analysis.md:1-4`.

## Evidence Inventory

| Artifact | Task | Description |
| --- | --- | --- |
| `.sisyphus/evidence/tui-hijack/baseline-good.bin` | T2 | Direct parent-pane baseline capture around a healthy shell command. |
| `.sisyphus/evidence/tui-hijack/baseline-after-split.bin` | T2 | Parent-visible bytes captured during isolated tmux split flow. |
| `.sisyphus/evidence/tui-hijack/baseline-after-kill.bin` | T2 | Parent-visible bytes captured during isolated tmux kill-pane flow. |
| `.sisyphus/evidence/tui-hijack/repro-plugin-pre.bin` | T2 | Pre-repro direct parent-pane capture before plugin-style split path. |
| `.sisyphus/evidence/tui-hijack/repro-plugin-during.bin` | T2 | Parent-visible bytes during plugin-style split with fake child. |
| `.sisyphus/evidence/tui-hijack/repro-plugin-post.bin` | T2 | Parent-visible bytes after plugin-style close path completes. |
| `.sisyphus/evidence/tui-hijack/baselines-analysis.md` | T2 | Smoking-gun table for DEC-mode enables/disables across baseline and repro captures. |
| `.sisyphus/evidence/tui-hijack/opencode-attach-strace.log` | T3 | SIGINT PTY capture showing OpenCode startup modes and cleanup payload. |
| `.sisyphus/evidence/tui-hijack/opencode-attach-strace-sigterm.log` | T3 | SIGTERM PTY capture showing OpenCode startup modes and cleanup payload. |
| `.sisyphus/evidence/tui-hijack/strace-analysis.md` | T3 | Timing and verdict summary for SIGINT/SIGTERM cleanup behavior. |
| `.sisyphus/evidence/tui-hijack/diag-1-layout-reapply.md` | T4 | Result of removing `applyTmuxLayout()` in the harness. |
| `.sisyphus/evidence/tui-hijack/diag-2-select-pane.md` | T4 | Result of removing `select-pane -T` in the harness. |
| `.sisyphus/evidence/tui-hijack/diag-3-refresh-client.md` | T4 | Result of adding `refresh-client -S` after `kill-pane`. |
| `.sisyphus/evidence/tui-hijack/diag-4-sh-exec.md` | T4 | Result of prepending `OPENCODE_DISABLE_MOUSE=1` in the stub harness. |
| `.sisyphus/evidence/tui-hijack/diag-5-extended-grace.md` | T4 | Result of extending the grace period in the stub harness. |
| `.sisyphus/evidence/tui-hijack/diag-summary.md` | T4 | Consolidated 5×5 diagnostic matrix and task recommendation. |
| `.sisyphus/evidence/tui-hijack/opencode-cli-help.txt` | T5 | Captured `opencode` and `opencode attach` help output. |
| `.sisyphus/evidence/tui-hijack/opencode-cli-flags.md` | T5 | Flag/env verdict showing `OPENCODE_DISABLE_MOUSE=1` is supported. |
| `.sisyphus/evidence/tui-hijack/opencode-issues-scan.md` | T5 | Upstream issue scan covering tmux mouse and shutdown corruption reports. |
| `.sisyphus/evidence/tui-hijack/opencode-serve-4199.log` | T3 | Synthetic OpenCode server log used during signal-handling capture. |
| `.sisyphus/evidence/tui-hijack/env-outside-tmux.txt` | T6 | Host-shell terminal environment snapshot before entering tmux. |
| `.sisyphus/evidence/tui-hijack/env-inside-tmux.txt` | T6 | Fresh tmux-pane environment snapshot showing tmux-managed values. |
| `.sisyphus/evidence/tui-hijack/update-env.txt` | T6 | tmux `update-environment` evidence used to judge TERM_PROGRAM propagation. |
| `.sisyphus/evidence/tui-hijack/term-program-analysis.md` | T6 | TERM_PROGRAM feasibility verdict for Ghostty-specific detection. |
| `.sisyphus/evidence/tui-hijack/task-1-harness-smoke.log` | T1 | Integration-harness smoke-test run against isolated tmux. |
| `.sisyphus/evidence/tui-hijack/task-1-no-tmux.log` | T1 | Harness behavior when tmux is unavailable. |
| `.sisyphus/evidence/tui-hijack/task-2-capture.log` | T2 | Capture-script execution log for baseline/repro byte traces. |

## Validated Root Causes

### 1. Unbalanced alternate-screen enable leaks into the parent-visible stream

This explains screen corruption, overwritten panel boundaries, and the "terminal stuck / input dead after pane close" symptom because the parent capture shows `?1049h` without a balancing `?1049l` after split/close. The strongest proof is the mode table showing `?1049h = 1` and `?1049l = 0` in `baseline-after-split.bin`, `baseline-after-kill.bin`, `repro-plugin-during.bin`, and `repro-plugin-post.bin`. See `.sisyphus/evidence/tui-hijack/baselines-analysis.md:12-32`, `.sisyphus/evidence/tui-hijack/baselines-analysis.md:44-87`, and `.sisyphus/evidence/tui-hijack/baselines-analysis.md:89-132`. **Confidence: HIGH.**

### 2. Unbalanced bracketed-paste enable leaks into the parent-visible stream

This explains raw escape junk entering input and cross-pane typing anomalies because the parent stream retains `?2004h` after the split/close path while the matching `?2004l` disappears in the same captures. The evidence table shows the good direct captures are balanced (`?2004h = 1`, `?2004l = 1`), but split/kill and repro post-close captures become unbalanced (`?2004h = 1`, `?2004l = 0`). See `.sisyphus/evidence/tui-hijack/baselines-analysis.md:20-23` and `.sisyphus/evidence/tui-hijack/baselines-analysis.md:29-32`. **Confidence: HIGH.**

### 3. OpenCode cleans up its mouse/alt-screen/bracketed-paste modes on SIGINT and SIGTERM, but that protection disappears on forced-kill paths

This explains why normal signal handling is not the primary smoking gun, yet shutdown policy still matters for crash/timeout edge cases. The signal captures show that both SIGINT and SIGTERM emit `?1003l`, `?1002l`, `?1000l`, `?1006l`, `?2004l`, and `?1049l` before exit, with cleanup writes occurring in about 7-10 ms. That means OpenCode's own cleanup path is real and fast, but any path that skips it can still leave the terminal dirty. See `.sisyphus/evidence/tui-hijack/strace-analysis.md:17-22`, `.sisyphus/evidence/tui-hijack/strace-analysis.md:24-48`, `.sisyphus/evidence/tui-hijack/strace-analysis.md:108-122`, `.sisyphus/evidence/tui-hijack/opencode-attach-strace.log:45-55`, and `.sisyphus/evidence/tui-hijack/opencode-attach-strace-sigterm.log:45-55`. **Confidence: HIGH.**

### 4. The current close path still has a SIGKILL bypass risk even though OpenCode itself is fast to clean up

The plan's existing close-path description says the plugin currently sends SIGTERM, waits 2 seconds, then SIGKILLs the child if needed; Phase 0 shows OpenCode normally cleans up in milliseconds, but the upstream issue scan also documents terminal corruption after crashes and forced shutdowns. The practical conclusion is that SIGKILL is not the common-path root cause in Phase 0, yet it remains a valid edge-case risk that T12 should harden against by preferring PTY-delivered interrupt and giving OpenCode a full graceful path before escalation. See `.sisyphus/plans/tui-input-hijack-fix.md:57-65`, `.sisyphus/evidence/tui-hijack/strace-analysis.md:108-122`, and `.sisyphus/evidence/tui-hijack/opencode-issues-scan.md:42-54`. **Confidence: MEDIUM.**

## Rejected Hypotheses

### tmux session-scoped mouse settings are the direct cause

Rejected. The parent captures do not show leaked mouse enables from the smoking-gun path; they show repeated mouse disables such as `?1000l`, `?1002l`, `?1003l`, and `?1006l`. The mode table records zero parent-visible `?1000h`, `?1002h`, and `?1006h`, while the disables appear dozens of times in split/kill captures. See `.sisyphus/evidence/tui-hijack/baselines-analysis.md:14-19` and `.sisyphus/evidence/tui-hijack/baselines-analysis.md:29-31`.

### Ghostty-specific detection via `TERM_PROGRAM` is a viable fix path

Rejected. Phase 0 explicitly found that `TERM_PROGRAM` is not in tmux's default `update-environment`, does not survive into a fresh pane, and therefore cannot be relied on for Ghostty detection inside tmux. See `.sisyphus/evidence/tui-hijack/term-program-analysis.md:1-4` and `.sisyphus/notepads/tui-input-hijack-fix/learnings.md:1-7`.

### Any of the five single-line diagnostics already eliminated the bug in the crash-path harness

Rejected. The consolidated diagnostic matrix marks all five experiments as unchanged across all five symptom classes, and each per-diagnostic note repeats the same `?1049h`/`?2004h` post-close signature as the control. See `.sisyphus/evidence/tui-hijack/diag-summary.md:12-31`, `.sisyphus/evidence/tui-hijack/diag-1-layout-reapply.md:18-33`, `.sisyphus/evidence/tui-hijack/diag-2-select-pane.md:21-36`, `.sisyphus/evidence/tui-hijack/diag-3-refresh-client.md:18-33`, `.sisyphus/evidence/tui-hijack/diag-4-sh-exec.md:18-33`, and `.sisyphus/evidence/tui-hijack/diag-5-extended-grace.md:18-33`.

## Recommended Minimum Fix Set

1. **KEEP / validate first: T12, T13, T14.** T12 remains warranted because it protects the cleanup path that OpenCode demonstrably performs well on signal, and T13/T14 remain the best available close/redraw defense-in-depth tasks even though the one-line diagnostic variants alone did not solve the crash-path harness. See `.sisyphus/evidence/tui-hijack/strace-analysis.md:108-122` and `.sisyphus/evidence/tui-hijack/diag-summary.md:26-31`.
2. **KEEP: T18.** Shell-escaping hardening is orthogonal safety work and is not contradicted by any Phase 0 evidence. See `.sisyphus/plans/tui-input-hijack-fix.md:1663-1676`.
3. **DEFER, do not cut yet: T11.** Diag-2 was unchanged, so `select-pane -T` is not implicated by current evidence, but the task should remain deferred rather than cut because the plan explicitly reserves CUT authority for evidence-backed conclusions and Phase 0 did not prove the final production fix stack yet. See `.sisyphus/evidence/tui-hijack/diag-2-select-pane.md:21-36` and `.sisyphus/evidence/tui-hijack/diag-summary.md:26-31`.
4. **DEFER, do not cut yet: T15 and T16.** Phase 0 did not show enough evidence to promote these hardening tasks into the minimum set, but it also did not disprove their value for residual close-path issues after live validation. See `.sisyphus/evidence/tui-hijack/diag-summary.md:28-31` and `.sisyphus/evidence/tui-hijack/opencode-issues-scan.md:42-54`.
5. **CUT: T17.** `~~T17 (Ghostty-specific reset path)~~ CUT: TERM_PROGRAM is not propagated into tmux panes, so the planned detection signal is unreliable in exactly the environment this feature targets.` See `.sisyphus/evidence/tui-hijack/term-program-analysis.md:1-4` and `.sisyphus/plans/tui-input-hijack-fix.md:1594-1608`.
6. **Spawn-side live validation to run before broad tmux-side surgery: apply the T5 finding.** The highest-impact single change from Phase 0 is prepending `env OPENCODE_DISABLE_MOUSE=1` to the plugin spawn command because OpenCode explicitly supports that path and upstream issue history says tmux breakage often clusters around mouse capture. See `.sisyphus/evidence/tui-hijack/opencode-cli-flags.md:35-71` and `.sisyphus/evidence/tui-hijack/opencode-issues-scan.md:21-40`.

## Strategic Recommendation

Because T5 returned **VERDICT: YES**, the plugin should first use OpenCode's native suppression path by prepending `env OPENCODE_DISABLE_MOUSE=1` to `opencode attach ...`. That does not prove the entire bug is gone, because Diag-4 stayed unchanged in the fake-stub harness, but it is still the best first live validation step because it directly targets known tmux mouse-capture breakage using a supported upstream control rather than inventing new tmux-side behavior first. See `.sisyphus/evidence/tui-hijack/opencode-cli-flags.md:35-71`, `.sisyphus/evidence/tui-hijack/diag-4-sh-exec.md:27-33`, and `.sisyphus/evidence/tui-hijack/diag-summary.md:28-31`.

That recommendation narrows the scope of custom attach-time mitigation work and raises the value of close-path hardening instead. Concretely: keep **T12**, **T13**, and **T14** as defense-in-depth fixes for signal delivery and redraw sequencing; keep **T18** as independent command-safety hardening; defer **T11**, **T15**, and **T16** until a real OpenCode rerun proves they are still needed; and cut **T17** now. See `.sisyphus/evidence/tui-hijack/strace-analysis.md:108-122`, `.sisyphus/evidence/tui-hijack/diag-summary.md:26-31`, and `.sisyphus/evidence/tui-hijack/term-program-analysis.md:1-4`.

## Ghostty Note

T17 should be removed from execution scope. The prerequisite assumption for that task was that the plugin could detect Ghostty inside tmux using `TERM_PROGRAM`, but Phase 0 found that tmux overwrites or drops that signal for fresh panes and therefore the planned detector is not present where the plugin needs it. See `.sisyphus/evidence/tui-hijack/term-program-analysis.md:1-4`, `.sisyphus/notepads/tui-input-hijack-fix/learnings.md:1-7`, and `.sisyphus/plans/tui-input-hijack-fix.md:1594-1608`.

The only surviving Ghostty-specific evidence in Phase 0 is that Ghostty remains the user's terminal context, not that Ghostty can be detected reliably from inside tmux without an alternate opt-in signal such as explicit user configuration or another env var that tmux preserves. Until such a detector exists, a Ghostty-only branch would be guesswork and should stay cut. See `.sisyphus/plans/tui-input-hijack-fix.md:37-40`, `.sisyphus/evidence/tui-hijack/term-program-analysis.md:1-4`, and `.sisyphus/evidence/tui-hijack/update-env.txt`.

## Open Questions

- **Does `OPENCODE_DISABLE_MOUSE=1` also eliminate the bracketed-paste leak in a live OpenCode session?** Phase 0 only proved that the env var exists and that the fake-stub harness did not change; it did not capture a real attach session with the flag enabled. See `.sisyphus/evidence/tui-hijack/opencode-cli-flags.md:55-71`, `.sisyphus/evidence/tui-hijack/diag-4-sh-exec.md:27-33`, and `.sisyphus/evidence/tui-hijack/diag-summary.md:28-31`.
- **Does the `?1049h` alternate-screen leak originate from tmux's own attach/client redraw path rather than from OpenCode?** The isolated baseline split/kill captures already show the same `?1049h`/`?2004h` signature before the fake child's mouse enables appear in the parent stream, which keeps tmux's client-attach lifecycle in scope. See `.sisyphus/evidence/tui-hijack/baselines-analysis.md:29-32`, `.sisyphus/evidence/tui-hijack/baselines-analysis.md:44-87`, and `.sisyphus/evidence/tui-hijack/baselines-analysis.md:89-132`.
- **Is there a close-path race where the pane exits before explicit `kill-pane` arrives, leaving tmux to auto-close it independently?** The plan identified that `pane_pid` is the shell PID rather than the final OpenCode PID, so there is still an unresolved race question around shell exit, pane teardown, and redraw ordering that Phase 0 did not directly instrument. See `.sisyphus/plans/tui-input-hijack-fix.md:57-65` and `.sisyphus/plans/tui-input-hijack-fix.md:78-81`.
