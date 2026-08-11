# Ooffice

This is for angular components optimized for business application.

## In this project
- [i2v-tree](https://github.com/gjcampbell/ooffice/tree/master/projects/of-tree) - a virtual tree for Angular. It has excellent performance for 10s of thousands of items, supports search, expand/collapse all, templating, drag and drop, lazy load, keyboard navigation.
- of-demo - the demo/documentation app for i2v-tree.

## Requirements

| | |
| --- | --- |
| Angular | 18.x |
| TypeScript | 5.5 |
| Node.js | ^18.19.1 \|\| ^20.11.1 \|\| >=22 |

## Commands

```
npm install
npm run build        # build the i2v-tree library into dist/i2v-tree
npm run build:demo   # build the demo app into dist/of-demo
npm start            # serve the demo app
npm test             # run unit tests (Karma + Jasmine, headless Chrome)
npm run lint         # run ESLint
```

## Known gap

The API-doc generator in `tools/` (`docjson-to-md.ts`, `ts-doc-parser.ts`, previously `npm run docmd`) is written
against TypeDoc 0.15 internals — `typedoc/dist/lib/models`, `Application.expandInputFiles`, `flags.isExported`,
`comment.shortText`, reflection `decorators` — none of which exist in a TypeDoc release compatible with TypeScript 5.5.
TypeDoc and those scripts were left out of the Angular 18 upgrade; they need a rewrite against the modern TypeDoc API
before `i2v-tree.gendoc.md` can be regenerated for the demo site.

