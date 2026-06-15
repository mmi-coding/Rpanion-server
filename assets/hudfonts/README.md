# Bundled HUD/OSD fonts

These TrueType fonts are bundled with the fork so the customizable graphic HUD
(OSD) can render in distinctive faces, both in the in-browser editor preview and
in the burned-in video on the device (via `fontconfig`/`librsvg`). They are
copied into the device's HUD fonts dir on startup (see `server/hudFonts.ts`).

All four are licensed under the **SIL Open Font License 1.1** (OFL), which permits
bundling and redistribution:

| File | Family | Source | Notes |
|------|--------|--------|-------|
| `Oxanium-Medium.ttf` | Oxanium | Google Fonts (OFL) | DJI / FPV-OSD-style; variable font instanced to a medium weight |
| `ChakraPetch-Regular.ttf` | Chakra Petch | Google Fonts (OFL) | the fork's display face |
| `IBMPlexMono-Regular.ttf` | IBM Plex Mono | IBM Plex (OFL) | telemetry-readout mono |
| `IBMPlexSans-Regular.ttf` | IBM Plex Sans | IBM Plex (OFL) | clean sans |

The IBM Plex and Chakra Petch files are the Latin subsets shipped by the
`@fontsource/*` packages (already a dependency for the web UI), converted
`woff2 → ttf`. Oxanium was taken from the Google Fonts repository and instanced
to a single static weight. The full OFL text is at <https://openfontlicense.org>.

Users can also **import** their own `.ttf`/`.otf` from the HUD Editor page.
