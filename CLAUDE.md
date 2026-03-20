# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Topolino is a browser-based 3D car game built with Three.js. A Fiat Topolino FBX model drives on an infinite road with drift physics, tire tracks, and an orbital camera. No build system — pure ES modules loaded via CDN importmap.

## Running the Project

```bash
# Option 1: Node.js
npx serve -l 3000

# Option 2: Python
python -m http.server 8000

# Option 3: use start_server.bat (tries Node then Python)
```

The game must be served over HTTP (not file://) because ES modules and FBX loading require it.

## Architecture

All game logic lives in `src/` as ES modules. `index.html` is a minimal shell that loads `src/main.js`.

**Shared state pattern:** `state.js` exports a single mutable object (`state.car`, `state.carSpeed`, `state.carAngle`, `state.velocity`, `state.keys`, etc.). All modules that need game state import from it. Physics writes to state, rendering reads from it.

**Game loop:** `main.js` calls `requestAnimationFrame` and invokes each module's `update*()` function in order: `updatePhysics()` → `updateShadow()` → `updateTracks()` → `updateCamera()` → `updateRoad()` → `renderer.render()`.

**Key module responsibilities:**
- `config.js` — all tunable constants (physics, colors, dimensions)
- `materials.js` — centralized material definitions + `getMaterialForMesh(name)` mapping. This is the single source of truth for which FBX mesh gets which material
- `car.js` — FBX loading, calls `getMaterialForMesh()` per mesh, detects wheels by name containing `roue`
- `physics.js` — bicycle model steering, grip/drift with quadratic corner factor, visual body roll on `state.carVisual`
- `tracks.js` — emits 4 tire track stamps every N frames using a custom ShaderMaterial with procedural noise

**Three.js is loaded via CDN** (v0.160.0) through an importmap in `index.html`. There is no `package.json` or `node_modules`.

## Assets

All assets are in `Asssets/` (note: double 's', this is intentional, do not rename).

- `topolino_low49k.fbx` — optimized model used at runtime (49k polys)
- `topolino.FBX` — high-detail source model (not loaded in game)
- `fabric2.jpg`, `leather.jpg` — UV textures for luggage meshes
- Other `.jpg` files are available but not all are currently used

## FBX Mesh Names

The model contains ~80 named meshes (French naming: `roue_avant_gauche_pneu`, `y_carrosserie_toit`, `bagage_sangles`, etc.). Material assignment in `materials.js` uses exact lowercase name matching via Sets (`greyMeshes`, `darkMeshes`, `toitMeshes`, `rougeMeshes`) and direct string comparisons. When adding new material assignments, add the exact mesh name to the appropriate Set in `materials.js`.

## Language

The user works in French. Code comments are in French. Variable names mix French and English.
