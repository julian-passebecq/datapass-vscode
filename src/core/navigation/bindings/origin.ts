/**
 * Binding-provider value metadata (go/NAV-contract.md § Binding sources): the § 34 origin every value carries and
 * the hole shape. Not part of view-spi; shared by the standalone providers under `bindings/`. Pure (no `vscode`).
 */
import type { NavLocation } from "../navTypes";

export type NavOrigin = "static" | "theoretical" | "ai-proposed" | "observed" | "declared" | "datapass-guidance";
export interface NavHole { readonly reason: string; readonly location?: NavLocation }
