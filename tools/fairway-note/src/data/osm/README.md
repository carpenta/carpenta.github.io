# OpenStreetMap hole shapes (ODbL 1.0)

The files in this folder are derived from OpenStreetMap data, © OpenStreetMap contributors, and are available under the
Open Database License 1.0 (https://opendatacommons.org/licenses/odbl/1-0/). See https://www.openstreetmap.org/copyright.
They are kept apart from the app's other data: nothing here comes from the courses' own pages, and the official pars,
lengths and hole notes in `../courses.json` take nothing from here.

| File | What it is |
| --- | --- |
| `everis.json` | The Derivative Database the app draws (v27): for each matched hole of 에버리스 골프리조트, simplified outlines of its greens, tees, fairways, bunkers and nearby water, and its line of play, in metres east and north of the middle of its greens, with the OSM element ids used. Written by `scripts/osm-holes.mjs`. |
| `everis-holes.json` | The hand-made mapping from each hole to its OSM tees, greens and fairways, with the evidence for each match, and the two holes left on the schematic and why. |

## Source

- Data as of OSM base 2026-11-20T14:28:25Z, fetched once on 2026-11-20 from the Overpass API (overpass-api.de), outside
  the app and its build. The app makes no request: the data is bundled.
- The query, for the area of the course's boundary (way 593260890, `leisure=golf_course`, "에버리스CC"):

```
[out:json][timeout:120];
way(593260890)->.c;
.c map_to_area->.a;
(
  .c;
  nwr(area.a)["golf"];
  nwr(area.a)["natural"="water"];
  nwr(area.a)["leisure"="golf_course"];
  nwr(area.a)["building"];
  nwr(area.a)["name"];
  way(area.a)["highway"];
);
out geom;
```

## Rebuilding

Save the query's JSON answer outside the repository, then from `tools/fairway-note`:

```sh
npm run osm:holes -- <path to the answer>.json
```

The script prints each hole's measured length beside the official one. Run by hand only; the build and CI never fetch
or rebuild this data.
