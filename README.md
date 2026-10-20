# SpreadNext

SpreadNext is a spreadsheet web app built with Angular and Rust. It has an editable grid, formulas, cell styling, range selection, undo and redo, autosave, and CSV and XLSX export.

<img height="300" alt="image" src="https://github.com/user-attachments/assets/71695d2a-783d-4c3d-8230-4f9d877c4a93" />

## Features

- Excel-style formulas with autocomplete
- Click or drag cells to add references to a formula
- Formula engine written in Rust and compiled to WebAssembly
- Bold, italic, underline, strikethrough, and text alignment
- Drag selection, Shift-click selection, and range stats
- Resizable columns and fixed row heights
- Undo, redo, and autosave in the browser
- Dark and light themes
- CSV and XLSX export, plus print
- Gridline and compact row options

## Requirements

- Node.js and npm
- Rust with the `wasm32-unknown-unknown` target, only if you want to rebuild the formula engine

## Setup

```bash
git clone https://github.com/Syed-Arieb/spreadnext.git
cd spreadnext
npm install
```

## Run Locally

```bash
npm start
```

Open `http://localhost:4200/`. The app reloads when source files change.

## Build

```bash
npm run build
```

The production files are written to `dist/spread-next`.

## Tests

```bash
npm test
```

## Formula Engine

The prebuilt engine is in `public/formula-engine.wasm`. Formula evaluation, CSV export, and XLSX export run in the Rust engine. You only need Rust to change the engine source in `engine/`.

```bash
rustup target add wasm32-unknown-unknown
npm run build:wasm
```

## Documentation

- [Contributing](docs/CONTRIBUTING.md)
- [Security](docs/SECURITY.md)

## License

This project uses the MIT License. See [LICENSE](LICENSE).
