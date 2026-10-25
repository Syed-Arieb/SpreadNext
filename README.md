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

## Deploy

The app is hosted on Firebase Hosting.

```bash
npm run deploy
```

This runs the production build and deploys the output in `dist/spread-next/browser` to Firebase Hosting via the Firebase CLI. The Hosting site is configured in `firebase.json` and the Firebase project in `.firebaserc`.

Deployment is also automated with GitHub Actions: every push to `master` that changes app source (see `.github/workflows/firebase-deploy.yml`) runs the build and deploys to Firebase Hosting. The workflow uses the `FIREBASE_SERVICE_ACCOUNT` repository secret, which you can create with `firebase init hosting:github` or by generating a service account key with Hosting deploy permissions.

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
