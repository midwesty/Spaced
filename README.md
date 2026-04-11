# Starfall Directive MVP

A browser-based top-down party RPG prototype inspired by the feel of BG3-style systems, rebuilt as an original sci-fi setting.

## What is included
- Character creation with layered paper-doll preview
- Exploration and same-map turn-based combat
- Party of up to 5 by default, admin-expandable to 10
- Survival: hunger, thirst, fatigue, morale, toxicity
- Shared ship resources: fuel, supplies, rations, water
- Dialogue with skill checks, companion affinity, romance hooks
- Inventory with drag/drop, equipment, cargo, renaming stacks/containers
- Ship hub, sector travel, encounters, quests, crime/stealth hooks
- Admin/testing panel and save/load via localStorage
- JSON-driven content folders for expansion

## Run locally
Because the game loads JSON with `fetch`, start a local server in this folder:

```bash
python -m http.server 8000
```

Then open:
`http://localhost:8000`

## Expand content mostly through JSON
- `data/maps.json`
- `data/dialogue.json`
- `data/quests.json`
- `data/items.json`
- `data/companions.json`
- `data/encounters.json`
- `data/species.json`
- `data/classes.json`

## Asset hooks
The code is already written as if these folders will eventually contain real files:
- `assets/audio/voice/`
- `assets/audio/sfx/`
- `assets/audio/music/`
- `assets/video/cinematics/`
- `assets/images/portraits/`
- `assets/images/sprites/`
- `assets/images/tiles/`
- `assets/images/ui/`

You can swap in real files later without reorganizing the project.

## Notes
This is a strong MVP foundation rather than a finished content-complete RPG. The systems are present, functional, and designed to grow.
