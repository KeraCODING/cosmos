# COSMOS

Desktop universe explorer for Windows. Version 0.6.0 contains the Solar System, Earth Explorer and webcam hand control. See [docs/ROADMAP.md](docs/ROADMAP.md) for what is finished and what is not.

**Download:** [COSMOS-Setup-0.6.0.exe](https://github.com/KeraCODING/cosmos/releases/tag/v0.6.0)

## Install

Run `release/COSMOS-Setup-0.6.0.exe`, or start `release/COSMOS-0.6.0-portable.exe` without installing. No browser or development tools are needed.

The files are not code-signed yet, so Windows SmartScreen may warn on first launch. Choose **More info**, then **Run anyway**.

## Quranaşdırma və istifadə (Azərbaycan dili)

`COSMOS-Setup-0.6.0.exe` faylını işə salın və ya quraşdırmadan `COSMOS-0.6.0-portable.exe` faylını açın. Windows SmartScreen xəbərdarlıq göstərərsə, **More info**, sonra **Run anyway** seçin. Dili **Parametrlər** bölməsindən dəyişə bilərsiniz; dəyişiklik dərhal tətbiq olunur.

## Controls

| Input | Action |
| --- | --- |
| Left drag | Rotate |
| Right drag | Pan |
| Mouse wheel, `+`, `-` | Zoom |
| Click | Select |
| Double click, `F` | Focus |
| `W` `A` `S` `D` | Move |
| `Space` | Pause or resume |
| `Esc` | Close panel or go back |
| `F11` | Fullscreen |
| `Ctrl+K` or `/` | Search |

## Hand control

Choose **Mouse**, **Hand** or **Hybrid** at the top of the window. COSMOS asks for permission the first time the camera is needed in each run, shows a red indicator while it is active, and never starts it automatically. Video is analysed on this computer and is not saved or transmitted. COSMOS blocks network access to every host except its listed map and science services. `Ctrl+Shift+C` turns it off at once. Mouse and keyboard always keep working.

| Gesture | Default action |
| --- | --- |
| Open palm, moving | Rotate the camera |
| Two fingers raised, moving | Move the view horizontally and vertically |
| Point with index finger | Aim the cursor and highlight an object |
| Short pinch and release | Select what the cursor was on |
| Keep pointing until the ring fills | Select without a pinch |
| Hold a pinch, then open or close the fingers | Zoom |
| Pinch with both hands, then move them | Zoom |
| Fist | Stop camera movement |
| Open palm held still | Open the hand menu |

Each gesture can be disabled or reassigned in the hand panel, which also has calibration and sensitivity controls.

## Where data is kept

Everything is under `%APPDATA%\COSMOS`: `settings.json`, `logs\cosmos.log`, `tile-cache\` and `data-cache\`. Downloaded data can be cleared in Settings.

## Development

Requires Node.js 24 or newer.

```bash
npm install
```

```bash
npm run dev
```

| Command | Purpose |
| --- | --- |
| `npm test` | Astronomy and logic tests, including comparison with stored JPL Horizons vectors |
| `npm run i18n:check` | Confirms Azerbaijani and English files match and that used keys exist |
| `npm run typecheck` | TypeScript check |
| `npm run build` then `npm run smoke` | Drives the real desktop app end to end |
| `npm run build` then `npm run hand:test` | Tests hand control with a simulated camera and real hand photographs; never opens a real webcam |
| `npm run data` | Downloads fresh NASA, JPL, Hipparcos and Natural Earth data |
| `npm run moons` | Refits moon orbits from JPL Horizons |
| `npm run sky` | Rebuilds the sky map, solving its orientation against Hipparcos stars |
| `npm run icon` | Regenerates the icon |
| `npm run dist` | Builds the installer and portable executable into `release/` |

Keep the project in a short path when running `npm run dist`. The NSIS installer tool fails when its template paths exceed the Windows path limit.

## Structure

| Path | Responsibility |
| --- | --- |
| `src/main`, `src/preload` | Desktop shell, disk cache, settings file, logging |
| `src/renderer/src/astro` | Astronomical calculations |
| `src/renderer/src/sim` | Simulation clock |
| `src/renderer/src/engine` | 3D rendering, camera, shaders, texture management |
| `src/renderer/src/earth` | Earth Explorer (CesiumJS) |
| `src/renderer/src/data` | Catalogue, search, JPL Horizons service, generated data |
| `src/renderer/src/settings` | User settings and local library |
| `src/renderer/src/i18n`, `locales/` | Translation system and text |
| `src/renderer/src/hands` | Hand tracking worker, gesture logic, calibration |
| `src/renderer/src/ui` | Interface |
| `tests/`, `scripts/smoke.mjs` | Automated tests |

## Data and licences

Planet and Sun values: NASA NSSDCA fact sheets. Ephemerides: astronomy-engine (MIT), checked against JPL Horizons. Stars: ESA Hipparcos catalogue via CDS VizieR. Asteroid orbits: NASA JPL Small-Body Database. Sky map, Natural Earth II and Moon image: bundled with CesiumJS (Apache-2.0). Online layers: NASA GIBS Blue Marble, OpenStreetMap (ODbL), Terrain Tiles on AWS (Mapzen and source agencies). Hand tracking: MediaPipe Hand Landmarker (Apache-2.0), bundled and run locally. Place search: Nominatim, used only when the user submits a search. Attribution is shown in the app.
