# COSMOS roadmap and requirement status

Status: **Done** works and was exercised, **Partial** works with stated gaps, **Not started** is absent from the app (no placeholder buttons exist for it).

The base COSMOS specification that the final requirements refer to was not available when Phase 1 was built. Only the "Final requirements and advanced features" document is covered here.

| # | Requirement | Status | Notes |
| --- | --- | --- | --- |
| 1 | Azerbaijani and English | Done for all current screens | i18next, four locale files, instant switching, bilingual search. Azerbaijani was written by the AI and needs review by a native-speaking astronomer. City labels on the globe are in English. |
| 2 | Cinematic graphics | Partial | Done: PBR, HDR pipeline, ACES tone mapping, atmospheric scattering (Earth, Venus, Mars), Hipparcos star brightness and colour, analytic planetary and eclipse shadows, ring shadows, restrained bloom, MSAA, camera transitions. Missing: real surface maps for 7 planets (shown as labelled artistic surfaces), solar imagery, volumetric nebulae. Ambient occlusion is deliberately unused because isolated spheres gain nothing from it. |
| 3 | Camera and navigation | Done | All listed mouse and keyboard controls, history, home button, log-scale transitions. |
| 4 | Scientific database | Partial | Done: modular catalogue, identifiers, aliases, classification, sources, retrieval dates, evidence labels, no invented values, live JPL Horizons comparison. Missing: NASA Exoplanet Archive, ESA, SIMBAD and Gaia connectors; per-value uncertainty. |
| 5 | Earth Explorer | Partial | Done: CesiumJS globe, three imagery layers, keyless real terrain, borders, cities, place search, coordinates, attribution, optional day and night. Missing: 3D buildings (needs a licensed provider or API key); higher-detail borders and multilingual labels. |
| 6 | Astronomical simulation | Done for Sun, 8 planets and the Moon | Real positions, rotation, tilt, retrograde spin, orbits from the ephemeris, eclipses, date selection, real-time, accelerated, reversed and paused time. Other moons are not simulated yet. |
| 7 | Discovery features | Partial | Done: Astronomical Events Calendar, favourites, saved views, recent objects, custom collections. Not started: Exoplanet, Black Hole, Deep Space, Galaxy, Nebula, Neutron Star, Supernova, Space Mission, Planet Surface and Solar Activity explorers. |
| 8 | Educational mode | Done for 10 objects | Beginner and advanced text, facts, history, significance, related objects, references, both languages. |
| 9 | User experience and settings | Done | All listed settings are functional. |
| 10 | Performance | Partial | Done: LOD, frustum culling, lazy and background texture generation, texture eviction, Low to Ultra profiles, FPS limit, performance monitor. Instanced rendering is not needed yet. Tested only on an RTX 5060 Laptop GPU; a slower mid-range laptop has not been measured. |
| 11 | Offline and online modes | Done for current data | Solar System and Natural Earth work offline; viewed tiles and Horizons replies are cached and marked. Catalogue refresh inside the app is not implemented; it is a build step today. |
| 12 | Engineering | Done | Separated modules, unit tests, end-to-end test, graceful network failure, no fake progress. |
| 13 | Windows release | Done, unsigned | Installer, portable executable, icon, version data, persistent settings, error log, documentation. Code signing needs a certificate. |
| 14 | Incremental verification | Ongoing | Phase 1 results are below. |

## Phase 1 verification

Automated checks cover unit tests, translation parity, type checking and an end-to-end run of the desktop app in both languages. Positions are compared with JPL Horizons for five dates from 1950 to 2045.

Final run, 2026-11-18: 49 of 49 unit tests and 23 of 23 end-to-end steps passed against the app installed by `COSMOS-Setup-0.1.0.exe`. The uninstaller removed the program and its shortcuts. The portable executable opened its window. All four graphics profiles reached the 165 Hz display limit on an RTX 5060 Laptop GPU, so this does not measure spare capacity.

Test note: some earlier runs showed unexpected language and globe camera changes while the test window was visible on the desktop. The likely cause is real mouse or keyboard input reaching that window, but this was not proven. After the test window was moved off-screen, both following full runs passed without those changes.

## Hand control (version 0.2.0)

| Requirement | Status | Notes |
| --- | --- | --- |
| Tracking | Done | MediaPipe Hand Landmarker, one or two hands, in a separate worker, on the graphics card with a processor fallback. |
| Gestures | Done | All eight gestures, each can be disabled; actions can be changed where alternatives exist. "Hand movement" uses a raised two-finger pose so that it does not conflict with open-palm rotation. |
| Modes | Done | Mouse, Hand and Hybrid. Mouse and keyboard stay active in all of them. |
| Webcam panel and calibration | Done | Camera choice, live preview, skeleton, status, indicators, thresholds, four-step calibration. |
| Privacy | Done | Consent each run, no automatic start, red indicator, immediate off button and shortcut, local processing, nothing recorded. |
| Integration | Partial | Solar System and Earth Explorer use the existing navigation. Deep Space does not exist yet; it should implement the same `NavigationTarget` interface when built. |
| Real-world testing | **Not done** | No real webcam or person has been tested. See below. |

Results for the packaged 0.2.0 build: 136 of 136 unit tests and 23 of 23 hand-control steps passed on the installed copy, and the general end-to-end test passed 23 of 23 steps in repeated runs after its timing checks were corrected. Tracking ran at about 26 analysed frames per second, about 10 ms each, on an RTX 5060 Laptop GPU. In the image test 56 of 60 cases were correct. All 4 misses were on the open-hand photograph: 35% brightness, warm tint, heavy noise and very close framing.

Automated hand tests use Chromium's simulated camera, four real hand photographs and generated hand poses. Lighting and camera placement were simulated by altering those photographs. They do not replace testing with a real person, webcam and room. Gesture thresholds may need adjustment after that.

## Sky content (version 0.4.0)

Up to 117,933 Hipparcos stars load according to the quality setting. About 15,000 real asteroids, Jupiter Trojans and trans-Neptunian objects move on osculating two-body orbits from the JPL Small-Body Database; planetary perturbations are not modelled, so positions drift slowly away from the reference date. Above one simulated day per second, planet spin is drawn at one day per second and labelled, because true spin would only flicker.

## Next phases

1. **Real planetary imagery.** Add licensed maps for Mercury, Venus, Mars, Jupiter, Saturn, Uranus and Neptune, with higher-resolution Earth and Moon, downloaded and cached on demand.
2. **Moons and small bodies.** Major moons, dwarf planets, asteroids and comets.
3. **Deep sky.** Galaxy, Nebula, Black Hole, Neutron Star and Supernova explorers, using SIMBAD and Gaia, with volumetric rendering clearly marked as modelled.
4. **Exoplanets and missions.** NASA Exoplanet Archive and JPL spacecraft trajectories.
5. **Solar activity and surfaces.** Live solar data and the Planet Surface Explorer.
6. **Release quality.** Code signing, auto-update, wider hardware testing, native-speaker language review.


## Version 0.2.1

Fixed: hand tracking stopped when the hand panel was closed, because the browser pauses a video removed from the page. The camera video now stays attached and frames are read on a timer. The hand-control test now checks that tracking continues after the panel closes and reopens. It still uses a simulated camera.


## Version 0.3.0

Gesture recognition now uses the tracker's 3D hand model, compares whole hand shapes, and confirms gestures by a short vote across frames. Selection gained point-and-hold, a wider reach around targets and a live hand indicator. Time has an automatic speed so that planets visibly move. The Sun has an animated illustrative surface. Shooting stars, meteors over Earth and star twinkling are artistic effects that can be turned off in Settings; star positions remain catalogue positions.

These changes were tested with a simulated camera, photographs and generated hand poses. Recognition quality with a real webcam still has to be confirmed by use.


## Version 0.6.0

Added Russian, a real-progress loading screen, small gesture examples during hand control, a Galaxy view and a drivable Mars rover. The Galaxy view places Sagittarius A* and 12 galaxies from SIMBAD positions and median distances; their structure, colours and motion are artistic models. The rover uses Viking colour and MOLA elevation for the Jezero region with compressed distances; the rover, rocks, fine terrain and survey points are illustrative. Startup now prepares catalogues and shaders first, surface uploads are spread across frames, labels update less often, and internal resolution adapts when the frame rate falls.

## Moons (version 0.5.0)

Nineteen major moons of Mars, Jupiter, Saturn, Uranus and Neptune are simulated. The Galilean moons use astronomy-engine; the others use mean orbits fitted to one year of JPL Horizons elements. Their positions around 2026 and 2027 agree with independent Horizons vectors to within 1 degree, or 4 degrees for Phobos and Deimos. Accuracy falls for dates far from 2026. Surfaces are artistic. Small moons are drawn as spheres and all are assumed tidally locked.

## Privacy correction (version 0.4.0)

Testing found that the MediaPipe library posts small usage records (about 4.4 KB in the captured request) to odml.pa.googleapis.com. Versions 0.2.0 to 0.3.0 did not block this. The records were too small to contain video, but their format was not fully decoded. From 0.4.0 COSMOS blocks every network host except the listed map and science services.
