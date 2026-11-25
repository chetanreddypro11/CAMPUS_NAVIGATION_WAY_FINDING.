# CampusWay - Polaris School of Technology

Campus navigation and wayfinding web page (PRD PST_AD_093, v0.1). Search a building, see it on the map and follow numbered walking steps between two places. Built with HTML5, CSS3, JavaScript (ES modules), Bootstrap 5 and Leaflet. No backend, no build step.

## Run
ES modules and `fetch` need a local static server. Do not open `index.html` by double-clicking it; browsers block the JavaScript modules and data request under `file://`.
- VS Code: right-click `index.html`, then "Open with Live Server", or
- Run `python -m http.server 8000` in this folder, then open http://localhost:8000

Bootstrap, Leaflet and fonts load from CDNs, so the first load needs internet. The campus map itself is a local SVG.

## Test
`npm test` (Node 18+). Covers the dataset (unique ids, edge references, positive distances), `searchPlaces`, `filterByCategory`, and eight routing cases: adjacent, far, same place, empty fields, unreachable, step-free, tie-break, and every place pair checked against Floyd-Warshall.

Manual checklist: search "lib" filters the list and a result opens the card; pin count equals place count (20); selecting a list item or a pin highlights both; Show route with Main Gate and Main Library prints numbered steps, metres, minutes and a line that draws itself on the map; Next/Back in the route banner and clicking a step highlight that leg and move the map to it; Preview walks a blue dot along the route; mouse-wheel zoom, the scale bar, Reset view and full screen (Esc exits) work; same start and destination shows an inline error; step-free route to Seminar Hall shows "No step-free route"; no horizontal scrolling at 360 px, 768 px and 1280 px.

## Structure
```
index.html          page shell
styles.css          theme (small, on top of Bootstrap)
places.json         single source of truth: places, junctions, edges
campus-map.svg      local map image (0-100 x 0-100)
placesApi.js        getPlaces, getPlaceById, searchPlaces, filterByCategory, getRoute
routeFinder.js      shortest path + step text
app.js              UI (list, filters, map, details card, route planner)
places.test.mjs     dataset and places API tests
route.test.mjs      routing tests
```

## Data format (`places.json`)
- `places`: placeId, name, category, description, x, y, entranceNote, accessible
- `junctions`: junctionId, name, x, y
- `edges`: fromId, toId, distanceMeters, instruction, stepFree (plus `reverseInstruction`, the text when the edge is walked from toId to fromId)
- `categories`: categoryId, label

Coordinates: percentages (0-100) of the campus map; x runs left to right, y top to bottom. Leaflet uses `L.CRS.Simple` with an SVG overlay and draws a node at `[100 - y, x]`. Edge distances are 1 map unit = 4 m, rounded to 5 m. Route distance, steps and time are always derived, never stored. Walking speed is 80 m per minute; minutes = round(total / 80), at least 1.

Routing: smallest total distance; ties broken by fewer steps. Step-free mode only uses edges with `stepFree: true`.

## Features
Search and category filter, pins matching the data, list and pin selection with details card, route planner with validation, swap, step-free option, numbered steps with distance and time, route drawn on the map, real-map feel (fly-to, wheel zoom, zoom-dependent labels, category pins, scale bar, full screen, search suggestions and category chips on the map, step-by-step route banner with animated preview), shareable route link (URL parameters), print, saved places and recent searches (LocalStorage), phone tabs (Places / Route / Map).

## Limitations
Fictional sample data. Outdoor routes only. No live GPS or "use my location", no indoor navigation, no accounts or backend. Saved places stay in the current browser.
