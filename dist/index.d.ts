import { z } from 'zod';

interface PluginInput {
    directory: string;
    serverUrl?: URL | string;
    client: {
        session: {
            status(): Promise<{
                data?: Record<string, {
                    type: string;
                }>;
            }>;
            subscribe(callback: (event: {
                type: string;
                properties?: unknown;
            }) => void): () => void;
        };
    };
}
interface PluginOutput {
    name: string;
    event?: (input: {
        event: {
            type: string;
            properties?: unknown;
        };
    }) => Promise<void>;
    tool?: Record<string, unknown>;
    config?: unknown;
}
type Plugin = (ctx: PluginInput) => Promise<PluginOutput>;

declare const TmuxLayoutSchema: z.ZodEnum<["main-horizontal", "main-vertical", "tiled", "even-horizontal", "even-vertical"]>;
type TmuxLayout = z.infer<typeof TmuxLayoutSchema>;
declare const TmuxConfigSchema: z.ZodObject<{
    enabled: z.ZodDefault<z.ZodBoolean>;
    layout: z.ZodDefault<z.ZodEnum<["main-horizontal", "main-vertical", "tiled", "even-horizontal", "even-vertical"]>>;
    main_pane_size: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    enabled: boolean;
    layout: "main-horizontal" | "main-vertical" | "tiled" | "even-horizontal" | "even-vertical";
    main_pane_size: number;
}, {
    enabled?: boolean | undefined;
    layout?: "main-horizontal" | "main-vertical" | "tiled" | "even-horizontal" | "even-vertical" | undefined;
    main_pane_size?: number | undefined;
}>;
type TmuxConfig = z.infer<typeof TmuxConfigSchema>;
declare const PluginConfigSchema: z.ZodObject<{
    enabled: z.ZodDefault<z.ZodBoolean>;
    port: z.ZodDefault<z.ZodNumber>;
    layout: z.ZodDefault<z.ZodEnum<["main-horizontal", "main-vertical", "tiled", "even-horizontal", "even-vertical"]>>;
    main_pane_size: z.ZodDefault<z.ZodNumber>;
    auto_close: z.ZodDefault<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    enabled: boolean;
    port: number;
    layout: "main-horizontal" | "main-vertical" | "tiled" | "even-horizontal" | "even-vertical";
    main_pane_size: number;
    auto_close: boolean;
}, {
    enabled?: boolean | undefined;
    port?: number | undefined;
    layout?: "main-horizontal" | "main-vertical" | "tiled" | "even-horizontal" | "even-vertical" | undefined;
    main_pane_size?: number | undefined;
    auto_close?: boolean | undefined;
}>;
type PluginConfig = z.infer<typeof PluginConfigSchema>;

declare const OpencodeSubagentTmux: Plugin;

export { type PluginConfig, type TmuxConfig, type TmuxLayout, OpencodeSubagentTmux as default };
