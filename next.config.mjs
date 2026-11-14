const docxRuntime=["./lib/server/docx-extraction-worker.mjs","./lib/server/docx-parser.mjs","./node_modules/yauzl/**/*","./node_modules/pend/**/*","./node_modules/saxes/**/*","./node_modules/xmlchars/**/*"];
const pdfRuntime=["./lib/server/pdf-extraction-worker.mjs","./node_modules/pdfjs-dist/legacy/build/*.mjs","./node_modules/pdfjs-dist/package.json","./node_modules/@napi-rs/canvas*/**/*"];
/** @type {import('next').NextConfig} */
const config={
  serverExternalPackages:["pdfjs-dist"],
  outputFileTracingIncludes:{
    "/api/workspace/services":[...docxRuntime,...pdfRuntime],
    "/api/workspace/evidence":[...docxRuntime],
    "/api/workspace/evidence/*/inspect":[...docxRuntime,...pdfRuntime],
    "/api/workspace/library/intake":[...docxRuntime,"./lib/server/pdf-extraction-worker.mjs","./node_modules/pdfjs-dist/legacy/build/*.mjs","./node_modules/pdfjs-dist/package.json","./node_modules/@napi-rs/canvas*/**/*"],
    "/api/workspace/library/revisions/*":[...docxRuntime,"./lib/server/pdf-extraction-worker.mjs","./node_modules/pdfjs-dist/legacy/build/*.mjs","./node_modules/pdfjs-dist/package.json","./node_modules/@napi-rs/canvas*/**/*"],
    "/api/workspace/library/coverage":[...docxRuntime,"./lib/server/pdf-extraction-worker.mjs","./node_modules/pdfjs-dist/legacy/build/*.mjs","./node_modules/pdfjs-dist/package.json","./node_modules/@napi-rs/canvas*/**/*"],
    "/api/workspace/library/coverage/*":[...docxRuntime,"./lib/server/pdf-extraction-worker.mjs","./node_modules/pdfjs-dist/legacy/build/*.mjs","./node_modules/pdfjs-dist/package.json","./node_modules/@napi-rs/canvas*/**/*"],
    "/api/workspace/programme":[...docxRuntime,"./lib/server/pdf-extraction-worker.mjs","./node_modules/pdfjs-dist/legacy/build/*.mjs","./node_modules/pdfjs-dist/package.json","./node_modules/@napi-rs/canvas*/**/*"],
    "/api/workspace/assurance":[...docxRuntime,"./lib/server/pdf-extraction-worker.mjs","./node_modules/pdfjs-dist/legacy/build/*.mjs","./node_modules/pdfjs-dist/package.json","./node_modules/@napi-rs/canvas*/**/*"],
    "/api/workspace/assurance/*":[...docxRuntime,"./lib/server/pdf-extraction-worker.mjs","./node_modules/pdfjs-dist/legacy/build/*.mjs","./node_modules/pdfjs-dist/package.json","./node_modules/@napi-rs/canvas*/**/*"],
    "/api/ai/analyse":[...docxRuntime,"./lib/server/pdf-extraction-worker.mjs","./node_modules/pdfjs-dist/legacy/build/*.mjs","./node_modules/pdfjs-dist/package.json","./node_modules/@napi-rs/canvas*/**/*"]
  }
};
export default config;
