/** @type {import('next').NextConfig} */
const config={
  serverExternalPackages:["pdfjs-dist"],
  outputFileTracingIncludes:{
    "/api/workspace/library/intake":["./lib/server/pdf-extraction-worker.mjs","./node_modules/pdfjs-dist/legacy/build/*.mjs","./node_modules/pdfjs-dist/package.json","./node_modules/@napi-rs/canvas*/**/*"],
    "/api/workspace/library/revisions/*":["./lib/server/pdf-extraction-worker.mjs","./node_modules/pdfjs-dist/legacy/build/*.mjs","./node_modules/pdfjs-dist/package.json","./node_modules/@napi-rs/canvas*/**/*"],
    "/api/workspace/library/coverage":["./lib/server/pdf-extraction-worker.mjs","./node_modules/pdfjs-dist/legacy/build/*.mjs","./node_modules/pdfjs-dist/package.json","./node_modules/@napi-rs/canvas*/**/*"],
    "/api/workspace/library/coverage/*":["./lib/server/pdf-extraction-worker.mjs","./node_modules/pdfjs-dist/legacy/build/*.mjs","./node_modules/pdfjs-dist/package.json","./node_modules/@napi-rs/canvas*/**/*"],
    "/api/workspace/programme":["./lib/server/pdf-extraction-worker.mjs","./node_modules/pdfjs-dist/legacy/build/*.mjs","./node_modules/pdfjs-dist/package.json","./node_modules/@napi-rs/canvas*/**/*"],
    "/api/workspace/assurance":["./lib/server/pdf-extraction-worker.mjs","./node_modules/pdfjs-dist/legacy/build/*.mjs","./node_modules/pdfjs-dist/package.json","./node_modules/@napi-rs/canvas*/**/*"],
    "/api/workspace/assurance/*":["./lib/server/pdf-extraction-worker.mjs","./node_modules/pdfjs-dist/legacy/build/*.mjs","./node_modules/pdfjs-dist/package.json","./node_modules/@napi-rs/canvas*/**/*"],
    "/api/ai/analyse":["./lib/server/pdf-extraction-worker.mjs","./node_modules/pdfjs-dist/legacy/build/*.mjs","./node_modules/pdfjs-dist/package.json","./node_modules/@napi-rs/canvas*/**/*"]
  }
};
export default config;
