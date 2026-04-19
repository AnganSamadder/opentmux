import { test, expect } from "bun:test";
import { TmuxConfigSchema, PluginConfigSchema } from "../config";

test("TmuxConfigSchema has new config fields", () => {
  const config = TmuxConfigSchema.parse({});
  expect(config.spawn_delay_ms).toBe(300);
  expect(config.max_retry_attempts).toBe(2);
  expect(config.layout_debounce_ms).toBe(150);
  expect(config.max_agents_per_column).toBe(3);
  // New TUI isolation flags defaults
  expect(config.tui_graceful_shutdown).toBe(true);
  expect(config.tui_conditional_layout_reapply).toBe(true);
  expect(config.tui_silent_refresh_after_close).toBe(true);
  expect(config.tui_sh_exec_wrapper).toBe(false);
  expect(config.tui_explicit_mode_reset).toBe(false);
  expect(config.tui_ghostty_hardening).toBe(false);
});

test("PluginConfigSchema has new config fields (defaults)", () => {
  const cfg = PluginConfigSchema.parse({});
  expect(cfg.tui_graceful_shutdown).toBe(true);
  expect(cfg.tui_conditional_layout_reapply).toBe(true);
  expect(cfg.tui_silent_refresh_after_close).toBe(true);
  expect(cfg.tui_sh_exec_wrapper).toBe(false);
  expect(cfg.tui_explicit_mode_reset).toBe(false);
  expect(cfg.tui_ghostty_hardening).toBe(false);
});

test("PluginConfigSchema backward compatibility: legacy JSON missing new fields defaults applied", () => {
  const legacyJson: unknown = { enabled: true, port: 4096 };
  const cfg = PluginConfigSchema.parse(legacyJson);
  expect(cfg.enabled).toBe(true);
  expect(cfg.port).toBe(4096);
  expect(cfg.tui_graceful_shutdown).toBe(true);
  expect(cfg.tui_conditional_layout_reapply).toBe(true);
  expect(cfg.tui_silent_refresh_after_close).toBe(true);
  expect(cfg.tui_sh_exec_wrapper).toBe(false);
  expect(cfg.tui_explicit_mode_reset).toBe(false);
  expect(cfg.tui_ghostty_hardening).toBe(false);
});

test("TmuxConfigSchema accepts custom values", () => {
  const config = TmuxConfigSchema.parse({
    spawn_delay_ms: 500,
    max_retry_attempts: 3,
    layout_debounce_ms: 200,
    max_agents_per_column: 4,
  });
  expect(config.spawn_delay_ms).toBe(500);
  expect(config.max_retry_attempts).toBe(3);
  expect(config.layout_debounce_ms).toBe(200);
  expect(config.max_agents_per_column).toBe(4);
  // Ensure new flags can be read when provided
  expect(config.tui_graceful_shutdown).toBe(true);
  expect(config.tui_conditional_layout_reapply).toBe(true);
  expect(config.tui_silent_refresh_after_close).toBe(true);
  expect(config.tui_sh_exec_wrapper).toBe(false);
  expect(config.tui_explicit_mode_reset).toBe(false);
  expect(config.tui_ghostty_hardening).toBe(false);
});

test("TmuxConfigSchema validates min/max constraints", () => {
  expect(() => TmuxConfigSchema.parse({ spawn_delay_ms: 10 })).toThrow();
  expect(() => TmuxConfigSchema.parse({ spawn_delay_ms: 3000 })).toThrow();
  expect(() => TmuxConfigSchema.parse({ max_agents_per_column: 0 })).toThrow();
  expect(() => TmuxConfigSchema.parse({ max_agents_per_column: 15 })).toThrow();
});
