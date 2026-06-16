# Product

> Context for design tooling (impeccable). Captured from the existing codebase, not
> a redesign brief — this fork has a committed visual identity (see DESIGN.md) that
> design work must preserve.

## Register

product

## Users

Drone / UAV operators and field engineers bringing up and diagnosing an ArduPilot
**companion computer** (Raspberry Pi 4 / Pi Zero 2 W) over a 4G LTE link. They reach this
web console from a laptop or tablet — often in the field, over a VPN (CGNAT) — during
pre-flight setup and in-flight troubleshooting. The job: get the telemetry/video link up
and keep it healthy **without dropping to an SSH shell**. Reliability and legibility beat
flourish; a misread status in the field has real cost.

## Product Purpose

A self-hosted console (runs *on* the companion computer) to configure and monitor the
whole LTE companion stack: network adapters, the LTE modem (RNDIS/QMI/PPP data paths),
MAVLink telemetry links, video streaming, VPN (WireGuard/Tailscale), NTRIP, DDNS, the HUD
overlay, and system health. Success = an operator can configure a subsystem, understand its
live state, and recover from a fault entirely from the web UI.

## Brand Personality

Instrument-grade. Calm, precise, rugged, legible — a night-cockpit / avionics panel, not a
consumer SaaS dashboard. Voice in UI copy: terse, technical, unhedged (labels not marketing).
Three words: **precise · rugged · legible.**

## Anti-references

- Generic Bootstrap admin templates (the undifferentiated "default" look).
- Purple→blue AI-gradient dashboards, glassmorphism, pastel/rounded "friendly" SaaS.
- Decorative motion, hero animations, anything that delays the operator from the task.
- Marketing-page warmth (cream/sand bg, oversized display type) on what is a tool.

## Design Principles

1. **The tool disappears into the task.** Earned familiarity over novelty; standard
   affordances for standard jobs. A field operator should never have to learn the UI.
2. **Every control is self-documenting.** Each page = one-line intro + a collapsed help
   section; every control label carries a HelpTip (fork rule — see docs/UI-GUIDELINES.md).
3. **Identity is signal, not decoration.** Amber = primary / active / attention; green =
   live; red = fault. Accent colour earns its place by carrying state, never as garnish.
4. **Density with rhythm.** Dense, data-rich pages are fine — but spacing must be
   consistent and deliberate so the density reads as designed, not cramped.
5. **Legible in any light.** High contrast (WCAG AA), and both a day (light) and night
   (dark) theme are first-class, because the field isn't always dark.

## Accessibility & Inclusion

Target **WCAG 2.1 AA** contrast for text and UI state. Visible keyboard focus on every
control. `prefers-reduced-motion` fully respected. Light and dark themes both ship and both
must pass contrast. Status must never be conveyed by colour alone (badges carry text).
