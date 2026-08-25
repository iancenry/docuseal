# pdfium.ts — Node.js port of `lib/pdfium.rb`

TypeScript port of the Ruby FFI bindings to **libpdfium** (FPDF), using
[`koffi`](https://koffi.dev) instead of Ruby-FFI.

- **Targeted koffi version:** `^3.x` (BigInt-pointer API; `koffi.load`, `koffi.struct`,
  `koffi.proto`, `koffi.pointer`, `koffi.opaque`, `koffi.as`, `koffi.view`,
  `koffi.register`/`unregister`). The API used is stable across late 2.x as well,
  but BigInt pointer values are a Koffi 3.x behavior — pin `koffi@^3`.
- **Library discovery order:** `$PDFIUM_PATH` → platform default name
  (`libpdfium.dylib` / `libpdfium.so` / `libpdfium.dll`) →
  `/usr/local/lib/libpdfium.dylib`. On darwin two extra fallbacks are probed:
  `~/lib/libpdfium.dylib` (docusealco/pdfium-binaries install location used by the
  test machine) and the LibreOffice-bundled `libpdfiumlo.dylib` (mirrors the Ruby
  loader). All searched paths and per-path errors are listed in the thrown error.
- The library is initialized lazily on first use (Ruby initialized at require
  time) via `FPDF_InitLibraryWithConfig`, and `FPDF_DestroyLibrary` is hooked to
  `process.on('exit')`.

## Ported 1:1 (same semantics, camelCase names)

| Ruby | TypeScript |
| --- | --- |
| `Pdfium.initialize_library` / `cleanup_library` | `initializeLibrary()` / `cleanupLibrary()` |
| `Pdfium.error_message` / `check_last_error` | `errorMessage()` / `checkLastError()` |
| `Pdfium::Document.open_bytes(bytes, password)` | `Document.openBytes(data, password?)` |
| `Pdfium::Document.open_file(path, password)` | `Document.openFile(path, password?)` |
| `Pdfium::Document.create` | `Document.create()` |
| `Document#page_count` | `document.pageCount` |
| `Document#get_page(i)` (memoized) | `document.getPage(i)` (memoized) |
| `Document#import_pages(src_doc)` | `document.importPages(src)` |
| `Document#save(io, flags:)` | `document.save(stream, flags?)` |
| `Document#close` (+ page cascade, FFL teardown) | `document.close()` |
| `Page#width` / `Page#height` (memoized) | `page.width` / `page.height` |
| `Page#text` (UTF-16LE → UTF-8, memoized) | `page.text` |
| `Page#text_nodes` (surrogate pairing, reading-order sort) | `page.textNodes()` |
| `Page#text_objects` (per-run Tj/TJ extraction + sort) | `page.textObjects()` |
| `Page#line_nodes` (path/segment heuristics, tilt 0/90) | `page.lineNodes()` |
| `Page#render_to_bitmap(width:/height:/scale:/background_color:/flags:)` | `page.renderToBitmap({width,height,scale,backgroundColor,flags})` |
| `Page#rotate` (box transforms, annots, clip matrix, GenerateContent) | `page.rotate()` |
| `Page#flatten(flag)` | `page.flatten(flag?)` |
| `Page#close` / closed? guards | `page.close()` / `isClosed()` / `ensureNotClosed()` |

Constants/enums (`FPDF_ANNOT`, render flags, `FLAT_*`, `FLATTEN_*`,
`FPDF_ERR_*` + `PDFIUM_ERRORS`, page-object & segment types, `MAX_SIZE`) and all
struct layouts (`FPDF_LIBRARY_CONFIG`, `FPDF_FORMFILLINFO_V2`, `FS_MATRIX`,
plus `FS_RECTF` for the clip param) are mirrored exactly. Every `attach_function`
from the Ruby file is bound, including ones Ruby only attached for completeness
(`FPDFText_CountRects`, `FPDFText_GetRect`, `FPDFPath_GetPathSegment`,
`FPDFPathSegment_GetType/GetPoint`, `FPDFText_GetCharIndexAtPos`).

Node port callers use: `openBytes`/`openFile`/`create`, `pageCount`, `getPage`,
`save`, `renderToBitmap`, `text`, `textNodes`, `textObjects`, `lineNodes`,
`rotate`, `flatten`, `close` — matching every `Pdfium.` usage found in
`lib/templates/*`, `lib/submissions/generate_result_attachments.rb`, and
`lib/document_metadatas.rb`.

## Adapted

- **`renderToPng()` is new.** The Ruby code hands raw BGRA bytes (rendered with
  `FPDF_REVERSE_BYTE_ORDER`, so effectively RGBA) to libvips. This port has no
  vips dependency, so `renderToPng()` wraps `renderToBitmap()` with a small
  dependency-free PNG encoder (`encodePngRgba`, zlib via `node:zlib`). Raw
  RGBA access remains available through `renderToBitmap()`.
- **`Document#save` callback** uses `koffi.proto` + `koffi.register` instead of
  `FFI::Function`; chunks are copied out of pdfium memory before invoking the
  JS writer (safe for async stream consumers). `saveToBuffer()` added for the
  common StringIO pattern.
- **GC safety net:** Ruby relied purely on explicit `close`/block forms. A
  `FinalizationRegistry` best-effort closes documents (FFL env + document
  handle) if a `Document` is garbage-collected unclosed. Pages are closed by
  their document, mirroring Ruby's cascade.
- **`FPDF_LoadDocument` path** is passed as UTF-16LE wide string (the actual
  pdfium signature); Ruby passed ANSI bytes and only worked for ASCII paths.
- **`FPDFTextObj_GetFontSize`** is declared with its real `float` return type
  (Ruby declared it `:int`). Preference order is preserved: out-param font size,
  then reported value, then object height, with the `1 → 8` remap.
- **`ulong` ABI:** platform-dependent width (32-bit on Windows, 64-bit LP64
  elsewhere); return values normalized to JS numbers.
- **Output params** (`_Out_ float*/double*`) use koffi single-element arrays;
  text buffers use typed arrays decoded with `TextDecoder('utf-16le')`.
- Ruby's `@text ||= ''` re-ran on empty pages (falsy `''`); the port uses an
  explicit null sentinel so empty text is cached too.

## Bug fix notes

- **`FPDF_FORMFILLINFO_V2` / `FPDF_FILEWRITE` must live in stable memory.** The
  first port built both structs with `koffi.as(obj, 'T *')`, but `koffi.as()`
  only yields *transient* memory that koffi recycles for later encodings —
  pdfium, like Ruby's `FFI::MemoryPointer` users, retains the form-fill info
  for the document's lifetime and reads the file-write struct during
  `FPDF_SaveAsCopy`. The recycled block was overwritten by the next transient
  allocation (the save-time `FPDF_FILEWRITE`), so `WriteBlock` landed exactly
  on `FPDF_FORMFILLINFO.Release`; `FPDFDOC_ExitFormFillEnvironment` then
  "called Release", which was now the *already unregistered* WriteBlock
  trampoline → koffi threw `Cannot use non-registered callback beyond FFI call`
  on the next FFI call after every `save()` (tests: "saves documents back to
  PDF bytes", "creates brand new documents"). Fix: allocate both structs with
  `koffi.alloc(typeName, 1)` and fill every member explicitly via
  `koffi.encode(mem, koffi.offsetof(type, member), memberType, value)`
  (`allocateStruct`/`freeStruct` helpers; freed in `close()`, the GC
  finalizer, and after each save).
- **koffi hands callback pointer arguments as external objects, not bigints.**
  The WriteBlock callback guarded with `typeof data === 'bigint'`, which never
  matched, so every chunk was silently dropped while still returning 1
  ("bytes written") — `saveToBuffer()` produced an empty buffer with a success
  status. The guard now only rejects nullish data / non-positive sizes and
  copies via `koffi.view(data, length)` regardless of pointer representation.
- **PNG chunk layout:** the encoder was correct all along (signature at 0–7,
  IHDR length at 8–11, `IHDR` type at 12–15). The failing test read the length
  field at offset 12 — which holds `0x49484452` (`"IHDR"`) in any valid PNG.
  Test expectation corrected to offset 8.

## Deferred / TODO

- **AcroForm widget introspection**: only `InitFormFillEnvironment` /
  `ExitFormFillEnvironment` / `FPDF_FFLDraw` / `FPDFPage_Flatten` are ported,
  exactly what the Ruby file had. Field enumeration lives elsewhere in the app.
- **vips/sharp interplay** (preview JPEG/Palette PNG encoding in
  `process_document.rb`) intentionally out of scope; consume
  `renderToBitmap()`/`renderToPng()` upstream.
- No leptonica-dependent helpers existed in the Ruby source, so none were
  ported; if they are added there, OCR-adjacent glue belongs in a separate
  module.
- Bindings exist but have no high-level wrappers yet (parity with Ruby, which
  also lacked them): `FPDFText_CountRects/GetRect`, path-segment iteration,
  `FPDFText_GetCharIndexAtPos`. Easy to expose when needed.
- All calls are synchronous (like Ruby). Async variants could wrap
  `func.async` from koffi later.

## Build notes

- Expected compiler settings: `strict: true`, `target: ES2022` (private `#`
  fields), `module: node16`, `esModuleInterop: true`, `types: ["node"]`.
- Runtime deps: `koffi ^3`, Node >= 18 (global `TextDecoder`/`FinalizationRegistry`).
