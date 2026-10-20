.DEFAULT_GOAL := help

.PHONY: help install start build wasm watch test clean

help:
	@node -e "console.log('SpreadNext commands:\n  make install  Install dependencies\n  make start    Start the dev server\n  make build    Build for production\n  make wasm     Rebuild the Rust formula engine\n  make watch    Build in watch mode (development)\n  make test     Run unit tests\n  make clean    Remove build output')"

install:
	npm install

start:
	npm start

build:
	npm run build

wasm:
	npm run build:wasm

watch:
	npm run watch

test:
	npm test

clean:
	@node -e "for (const dir of ['dist', 'out-tsc', 'engine/target']) require('fs').rmSync(dir, { recursive: true, force: true })"
