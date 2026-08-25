import { deflateSync } from 'node:zlib';
import koffi from 'koffi';

declare const documentBrand: unique symbol;
declare const pageBrand: unique symbol;
declare const bitmapBrand: unique symbol;
declare const textPageBrand: unique symbol;
declare const pageObjectBrand: unique symbol;
declare const pathSegmentBrand: unique symbol;
declare const formHandleBrand: unique symbol;

export type FPDFDocumentPtr = bigint & { readonly [documentBrand]: true };
export type FPDFPagePtr = bigint & { readonly [pageBrand]: true };
export type FPDFBitmapPtr = bigint & { readonly [bitmapBrand]: true };
export type FPDFTextPagePtr = bigint & { readonly [textPageBrand]: true };
export type FPDFPageObjectPtr = bigint & { readonly [pageObjectBrand]: true };
export type FPDFPathSegmentPtr = bigint & { readonly [pathSegmentBrand]: true };
export type FPDFFormHandlePtr = bigint & { readonly [formHandleBrand]: true };

export type Handle<T> = T | null;

export const LIB_NAME = 'pdfium';

export const MAX_SIZE = 32767;

export const FPDF_ANNOT = 0x01;
export const FPDF_LCD_TEXT = 0x02;
export const FPDF_NO_NATIVETEXT = 0x04;
export const FPDF_GRAYSCALE = 0x08;
export const FPDF_REVERSE_BYTE_ORDER = 0x10;
export const FPDF_RENDER_LIMITEDIMAGECACHE = 0x200;
export const FPDF_RENDER_FORCEHALFTONE = 0x400;
export const FPDF_PRINTING = 0x800;

export const DEFAULT_RENDER_FLAGS =
  FPDF_ANNOT | FPDF_LCD_TEXT | FPDF_NO_NATIVETEXT | FPDF_REVERSE_BYTE_ORDER;

export const DEFAULT_BACKGROUND_COLOR = 0xffffffff;

export const FPDF_PAGEOBJ_UNKNOWN = 0;
export const FPDF_PAGEOBJ_TEXT = 1;
export const FPDF_PAGEOBJ_PATH = 2;
export const FPDF_PAGEOBJ_IMAGE = 3;
export const FPDF_PAGEOBJ_SHADING = 4;
export const FPDF_PAGEOBJ_FORM = 5;

export const FPDF_SEGMENT_UNKNOWN = -1;
export const FPDF_SEGMENT_LINETO = 0;
export const FPDF_SEGMENT_BEZIERTO = 1;
export const FPDF_SEGMENT_MOVETO = 2;

export const FLAT_NORMALDISPLAY = 0;
export const FLAT_PRINT = 1;

export const FLATTEN_FAIL = 0;
export const FLATTEN_SUCCESS = 1;
export const FLATTEN_NOTHINGTODO = 2;

export const FPDF_INCREMENTAL = 1;
export const FPDF_NO_INCREMENTAL = 2;
export const FPDF_REMOVE_SECURITY = 3;

export const FPDF_ERR_SUCCESS = 0;
export const FPDF_ERR_UNKNOWN = 1;
export const FPDF_ERR_FILE = 2;
export const FPDF_ERR_FORMAT = 3;
export const FPDF_ERR_PASSWORD = 4;
export const FPDF_ERR_SECURITY = 5;
export const FPDF_ERR_PAGE = 6;

export const PDFIUM_ERRORS: Readonly<Record<number, string>> = {
  [FPDF_ERR_SUCCESS]: 'Success',
  [FPDF_ERR_UNKNOWN]: 'Unknown error',
  [FPDF_ERR_FILE]: 'Error open file',
  [FPDF_ERR_FORMAT]: 'Invalid format',
  [FPDF_ERR_PASSWORD]: 'Incorrect password',
  [FPDF_ERR_SECURITY]: 'Security scheme error',
  [FPDF_ERR_PAGE]: 'Page not found'
};

export function errorMessage(code: number): string {
  return PDFIUM_ERRORS[code] ?? `Unknown error code: ${code}`;
}

export class PdfiumError extends Error {}

export interface TextNode {
  readonly content: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly endx: number;
  readonly endy: number;
}

export interface TextObject extends TextNode {
  readonly fontSize: number;
}

export interface LineNode {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly tilt: number;
  readonly endx: number;
  readonly endy: number;
}

export interface RenderOptions {
  width?: number | undefined;
  height?: number | undefined;
  scale?: number | undefined;
  backgroundColor?: number | undefined;
  flags?: number | undefined;
}

export interface RenderedBitmap {
  data: Uint8Array;
  width: number;
  height: number;
}

export interface PdfWriteTarget {
  write(chunk: Uint8Array): unknown;
}

class TextNodeImpl implements TextNode {
  readonly content: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;

  constructor(content: string, x: number, y: number, w: number, h: number) {
    this.content = content;
    this.x = x;
    this.y = y;
    this.w = w;
    this.h = h;
  }

  get endx(): number {
    return this.x + this.w;
  }

  get endy(): number {
    return this.y + this.h;
  }
}

class TextObjectImpl extends TextNodeImpl implements TextObject {
  readonly fontSize: number;

  constructor(content: string, x: number, y: number, w: number, h: number, fontSize: number) {
    super(content, x, y, w, h);
    this.fontSize = fontSize;
  }
}

class LineNodeImpl implements LineNode {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly tilt: number;

  constructor(x: number, y: number, w: number, h: number, tilt: number) {
    this.x = x;
    this.y = y;
    this.w = w;
    this.h = h;
    this.tilt = tilt;
  }

  get endx(): number {
    return this.x + this.w;
  }

  get endy(): number {
    return this.y + this.h;
  }
}

interface KoffiLib {
  func(signature: string): (...args: unknown[]) => unknown;
}

export const SaveWriteBlockProto = koffi.proto(
  'int FPDF_FILEWRITE_WriteBlockProc(void *pThis, const void *pData, size_t cb)'
);

export const FPDF_LIBRARY_CONFIG = koffi.struct('FPDF_LIBRARY_CONFIG', {
  version: 'int',
  m_pUserFontPaths: 'void *',
  m_pIsolate: 'void *',
  m_v8EmbedderSlot: 'uint32',
  m_pPlatform: 'void *',
  m_RendererType: 'int'
});

type KoffiTypeSpec = string | ReturnType<typeof koffi.pointer>;
type KoffiAllocation = ReturnType<typeof koffi.alloc>;

export const FPDF_FORMFILLINFO_MEMBER_TYPES = {
  version: 'int',
  Release: 'void *',
  FFI_Invalidate: 'void *',
  FFI_OutputSelectedRect: 'void *',
  FFI_SetCursor: 'void *',
  FFI_SetTimer: 'void *',
  FFI_KillTimer: 'void *',
  FFI_GetLocalTime: 'void *',
  FFI_OnChange: 'void *',
  FFI_GetPage: 'void *',
  FFI_GetCurrentPage: 'void *',
  FFI_GetRotation: 'void *',
  FFI_ExecuteNamedAction: 'void *',
  FFI_SetTextFieldFocus: 'void *',
  FFI_DoURIAction: 'void *',
  FFI_DoGoToAction: 'void *',
  m_pJsPlatform: 'void *',
  xfa_disabled: 'int',
  FFI_DisplayCaret: 'void *',
  FFI_GetCurrentPageIndex: 'void *',
  FFI_SetCurrentPage: 'void *',
  FFI_GotoURL: 'void *',
  FFI_GetPageViewRect: 'void *',
  FFI_PageEvent: 'void *',
  FFI_PopupMenu: 'void *',
  FFI_OpenFile: 'void *',
  FFI_EmailTo: 'void *',
  FFI_UploadTo: 'void *',
  FFI_GetPlatform: 'void *',
  FFI_GetLanguage: 'void *',
  FFI_DownloadFromURL: 'void *',
  FFI_PostRequestURL: 'void *',
  FFI_PutRequestURL: 'void *',
  FFI_OnFocusChange: 'void *',
  FFI_DoURIActionWithKeyboardModifier: 'void *'
} as const satisfies Readonly<Record<string, KoffiTypeSpec>>;

export const FPDF_FORMFILLINFO_V2 = koffi.struct('FPDF_FORMFILLINFO_V2', FPDF_FORMFILLINFO_MEMBER_TYPES);

export const FS_MATRIX = koffi.struct('FS_MATRIX', {
  a: 'float',
  b: 'float',
  c: 'float',
  d: 'float',
  e: 'float',
  f: 'float'
});

export const FS_RECTF = koffi.struct('FS_RECTF', {
  left: 'float',
  bottom: 'float',
  right: 'float',
  top: 'float'
});

export const FPDF_FILEWRITE_MEMBER_TYPES = {
  version: 'int',
  WriteBlock: koffi.pointer(SaveWriteBlockProto)
} as const satisfies Readonly<Record<string, KoffiTypeSpec>>;

export const FPDF_FILEWRITE = koffi.struct('FPDF_FILEWRITE', FPDF_FILEWRITE_MEMBER_TYPES);

function allocateStruct(
  typeName: string,
  memberTypes: Readonly<Record<string, KoffiTypeSpec>>,
  values: Record<string, unknown>
): KoffiAllocation {
  const memory = koffi.alloc(typeName, 1);

  try {
    for (const [name, type] of Object.entries(memberTypes)) {
      koffi.encode(memory, koffi.offsetof(typeName, name), type, values[name] ?? null);
    }
  } catch (error) {
    freeStruct(memory);

    throw error;
  }

  return memory;
}

function freeStruct(memory: KoffiAllocation): void {
  if (memory === null || memory === undefined) {
    return;
  }

  try {
    koffi.free(memory);
  } catch {
    return;
  }
}

export const FPDF_STRING = koffi.pointer('FPDF_STRING', koffi.opaque());
export const FPDF_DOCUMENT = koffi.pointer('FPDF_DOCUMENT', koffi.opaque());
export const FPDF_PAGE = koffi.pointer('FPDF_PAGE', koffi.opaque());
export const FPDF_BITMAP = koffi.pointer('FPDF_BITMAP', koffi.opaque());
export const FPDF_FORMHANDLE = koffi.pointer('FPDF_FORMHANDLE', koffi.opaque());
export const FPDF_TEXTPAGE = koffi.pointer('FPDF_TEXTPAGE', koffi.opaque());
export const FPDF_PAGEOBJECT = koffi.pointer('FPDF_PAGEOBJECT', koffi.opaque());
export const FPDF_PATHSEGMENT = koffi.pointer('FPDF_PATHSEGMENT', koffi.opaque());

const ULONG_WIDTH = process.platform === 'win32' ? 32 : 64;

function toUlong(value: number): number | bigint {
  return ULONG_WIDTH === 64 ? BigInt(Math.trunc(value)) : Math.trunc(value);
}

function numOf(value: unknown): number {
  return typeof value === 'bigint' ? Number(value) : (value as number);
}

function firstOf(values: readonly number[]): number {
  return values[0] ?? 0;
}

function toHandle<T>(value: unknown): Handle<T> {
  return (value ?? null) as unknown as Handle<T>;
}

const utf16leDecoder = new TextDecoder('utf-16le');

function decodeUtf16Le(bytes: Uint8Array, byteLength: number): string {
  return utf16leDecoder.decode(bytes.subarray(0, byteLength));
}

interface PdfiumBindings {
  FPDF_InitLibraryWithConfig(config: bigint): void;
  FPDF_DestroyLibrary(): void;
  FPDF_LoadDocument(path: string, password: string | null): unknown;
  FPDF_LoadMemDocument(data: Uint8Array, size: number, password: string | null): unknown;
  FPDF_CloseDocument(document: FPDFDocumentPtr): void;
  FPDF_GetPageCount(document: FPDFDocumentPtr): unknown;
  FPDF_GetLastError(): unknown;
  FPDF_LoadPage(document: FPDFDocumentPtr, index: number): unknown;
  FPDF_ClosePage(page: FPDFPagePtr): void;
  FPDF_GetPageWidthF(page: FPDFPagePtr): unknown;
  FPDF_GetPageHeightF(page: FPDFPagePtr): unknown;
  FPDFBitmap_Create(width: number, height: number, alpha: number): unknown;
  FPDFBitmap_Destroy(bitmap: FPDFBitmapPtr): void;
  FPDFBitmap_GetBuffer(bitmap: FPDFBitmapPtr): unknown;
  FPDFBitmap_GetStride(bitmap: FPDFBitmapPtr): unknown;
  FPDFBitmap_FillRect(
    bitmap: FPDFBitmapPtr,
    left: number,
    top: number,
    width: number,
    height: number,
    color: number | bigint
  ): void;
  FPDF_RenderPageBitmap(
    bitmap: FPDFBitmapPtr,
    page: FPDFPagePtr,
    startX: number,
    startY: number,
    sizeX: number,
    sizeY: number,
    rotate: number,
    flags: number
  ): void;
  FPDFText_LoadPage(page: FPDFPagePtr): unknown;
  FPDFText_ClosePage(textPage: FPDFTextPagePtr): void;
  FPDFText_CountChars(textPage: FPDFTextPagePtr): unknown;
  FPDFText_GetText(
    textPage: FPDFTextPagePtr,
    startIndex: number,
    count: number,
    result: Uint8Array
  ): unknown;
  FPDFText_GetUnicode(textPage: FPDFTextPagePtr, index: number): unknown;
  FPDFText_GetCharBox(
    textPage: FPDFTextPagePtr,
    index: number,
    left: number[],
    right: number[],
    bottom: number[],
    top: number[]
  ): unknown;
  FPDFText_GetCharOrigin(textPage: FPDFTextPagePtr, index: number, x: number[], y: number[]): unknown;
  FPDFText_GetCharIndexAtPos(
    textPage: FPDFTextPagePtr,
    x: number,
    y: number,
    xTolerance: number,
    yTolerance: number
  ): unknown;
  FPDFText_CountRects(textPage: FPDFTextPagePtr, start: number, count: number): unknown;
  FPDFText_GetRect(
    textPage: FPDFTextPagePtr,
    rectIndex: number,
    left: number[],
    top: number[],
    right: number[],
    bottom: number[]
  ): unknown;
  FPDFText_GetFontSize(textPage: FPDFTextPagePtr, index: number): unknown;
  FPDFPage_CountObjects(page: FPDFPagePtr): unknown;
  FPDFPage_GetObject(page: FPDFPagePtr, index: number): unknown;
  FPDFPageObj_GetType(pageObject: FPDFPageObjectPtr): unknown;
  FPDFPageObj_GetBounds(
    pageObject: FPDFPageObjectPtr,
    left: number[],
    bottom: number[],
    right: number[],
    top: number[]
  ): unknown;
  FPDFPath_CountSegments(pageObject: FPDFPageObjectPtr): unknown;
  FPDFPath_GetPathSegment(pageObject: FPDFPageObjectPtr, index: number): unknown;
  FPDFPathSegment_GetType(segment: FPDFPathSegmentPtr): unknown;
  FPDFPathSegment_GetPoint(segment: FPDFPathSegmentPtr, x: number[], y: number[]): unknown;
  FPDFTextObj_GetText(
    pageObject: FPDFPageObjectPtr,
    textPage: FPDFTextPagePtr,
    buffer: Uint8Array | null,
    length: number | bigint
  ): unknown;
  FPDFTextObj_GetFontSize(pageObject: FPDFPageObjectPtr, fontSize: number[]): unknown;
  FPDFDOC_InitFormFillEnvironment(document: FPDFDocumentPtr, formInfo: bigint): unknown;
  FPDFDOC_ExitFormFillEnvironment(formHandle: FPDFFormHandlePtr): void;
  FPDF_FFLDraw(
    formHandle: FPDFFormHandlePtr,
    bitmap: FPDFBitmapPtr,
    page: FPDFPagePtr,
    startX: number,
    startY: number,
    sizeX: number,
    sizeY: number,
    rotate: number,
    flags: number
  ): void;
  FPDFPage_Flatten(page: FPDFPagePtr, flag: number): unknown;
  FPDFPage_GetRotation(page: FPDFPagePtr): unknown;
  FPDFPage_SetRotation(page: FPDFPagePtr, rotate: number): void;
  FPDFPage_TransFormWithClip(page: FPDFPagePtr, matrix: bigint, clip: null): unknown;
  FPDFPage_TransformAnnots(
    page: FPDFPagePtr,
    a: number,
    b: number,
    c: number,
    d: number,
    e: number,
    f: number
  ): void;
  FPDFPage_GenerateContent(page: FPDFPagePtr): unknown;
  FPDFPage_GetMediaBox(
    page: FPDFPagePtr,
    left: number[],
    bottom: number[],
    right: number[],
    top: number[]
  ): unknown;
  FPDFPage_SetMediaBox(page: FPDFPagePtr, left: number, bottom: number, right: number, top: number): void;
  FPDFPage_GetCropBox(
    page: FPDFPagePtr,
    left: number[],
    bottom: number[],
    right: number[],
    top: number[]
  ): unknown;
  FPDFPage_SetCropBox(page: FPDFPagePtr, left: number, bottom: number, right: number, top: number): void;
  FPDFPage_GetBleedBox(
    page: FPDFPagePtr,
    left: number[],
    bottom: number[],
    right: number[],
    top: number[]
  ): unknown;
  FPDFPage_SetBleedBox(page: FPDFPagePtr, left: number, bottom: number, right: number, top: number): void;
  FPDFPage_GetTrimBox(
    page: FPDFPagePtr,
    left: number[],
    bottom: number[],
    right: number[],
    top: number[]
  ): unknown;
  FPDFPage_SetTrimBox(page: FPDFPagePtr, left: number, bottom: number, right: number, top: number): void;
  FPDFPage_GetArtBox(
    page: FPDFPagePtr,
    left: number[],
    bottom: number[],
    right: number[],
    top: number[]
  ): unknown;
  FPDFPage_SetArtBox(page: FPDFPagePtr, left: number, bottom: number, right: number, top: number): void;
  FPDF_SaveAsCopy(document: FPDFDocumentPtr, fileWrite: bigint, flags: number | bigint): unknown;
  FPDF_CreateNewDocument(): unknown;
  FPDF_ImportPages(
    destination: FPDFDocumentPtr,
    source: FPDFDocumentPtr,
    pageRange: string | null,
    index: number
  ): unknown;
}

type Api = PdfiumBindings;

let lib: KoffiLib | null = null;
let api: Api | null = null;
let exitHookInstalled = false;

function libraryCandidates(): string[] {
  const candidates: string[] = [];

  const envPath = process.env.PDFIUM_PATH;

  if (envPath !== undefined && envPath !== '') {
    candidates.push(envPath);
  }

  switch (process.platform) {
    case 'darwin':
      candidates.push('libpdfium.dylib');
      break;
    case 'win32':
      candidates.push('libpdfium.dll');
      break;
    default:
      candidates.push('libpdfium.so');
      break;
  }

  if (process.platform === 'darwin') {
    candidates.push('/usr/local/lib/libpdfium.dylib');
    candidates.push('/Applications/LibreOffice.app/Contents/Frameworks/libpdfiumlo.dylib');
  }

  return [...new Set(candidates)];
}

function loadLibrary(): KoffiLib {
  const searched: string[] = [];
  const failures: string[] = [];

  for (const candidate of libraryCandidates()) {
    searched.push(candidate);

    try {
      return koffi.load(candidate) as unknown as KoffiLib;
    } catch (error) {
      failures.push(`${candidate}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(
    `Could not load libpdfium library. Make sure it's installed and in your library path.` +
      ` Searched: ${searched.join(', ')}. Errors: ${failures.join(' | ')}`
  );
}

function buildApi(library: KoffiLib): Api {
  const f = (signature: string): ((...args: unknown[]) => unknown) => library.func(signature);

  return {
    FPDF_InitLibraryWithConfig: (config) => {
      f('void FPDF_InitLibraryWithConfig(FPDF_LIBRARY_CONFIG *config)')(config);
    },
    FPDF_DestroyLibrary: () => {
      f('void FPDF_DestroyLibrary()')();
    },
    FPDF_LoadDocument: (path, password) =>
      f('FPDF_DOCUMENT FPDF_LoadDocument(const char16_t *file_path, const char *password)')(
        path,
        password
      ),
    FPDF_LoadMemDocument: (data, size, password) =>
      f('FPDF_DOCUMENT FPDF_LoadMemDocument(const void *data, int size, const char *password)')(
        data,
        size,
        password
      ),
    FPDF_CloseDocument: (document) => {
      f('void FPDF_CloseDocument(FPDF_DOCUMENT document)')(document);
    },
    FPDF_GetPageCount: (document) => f('int FPDF_GetPageCount(FPDF_DOCUMENT document)')(document),
    FPDF_GetLastError: () => f('ulong FPDF_GetLastError()')(),
    FPDF_LoadPage: (document, index) =>
      f('FPDF_PAGE FPDF_LoadPage(FPDF_DOCUMENT document, int page_index)')(document, index),
    FPDF_ClosePage: (page) => {
      f('void FPDF_ClosePage(FPDF_PAGE page)')(page);
    },
    FPDF_GetPageWidthF: (page) => f('float FPDF_GetPageWidthF(FPDF_PAGE page)')(page),
    FPDF_GetPageHeightF: (page) => f('float FPDF_GetPageHeightF(FPDF_PAGE page)')(page),
    FPDFBitmap_Create: (width, height, alpha) =>
      f('FPDF_BITMAP FPDFBitmap_Create(int width, int height, int alpha)')(width, height, alpha),
    FPDFBitmap_Destroy: (bitmap) => {
      f('void FPDFBitmap_Destroy(FPDF_BITMAP bitmap)')(bitmap);
    },
    FPDFBitmap_GetBuffer: (bitmap) => f('void *FPDFBitmap_GetBuffer(FPDF_BITMAP bitmap)')(bitmap),
    FPDFBitmap_GetStride: (bitmap) => f('int FPDFBitmap_GetStride(FPDF_BITMAP bitmap)')(bitmap),
    FPDFBitmap_FillRect: (bitmap, left, top, width, height, color) => {
      f('void FPDFBitmap_FillRect(FPDF_BITMAP bitmap, int left, int top, int width, int height, ulong color)')(
        bitmap,
        left,
        top,
        width,
        height,
        color
      );
    },
    FPDF_RenderPageBitmap: (bitmap, page, startX, startY, sizeX, sizeY, rotate, flags) => {
      f(
        'void FPDF_RenderPageBitmap(FPDF_BITMAP bitmap, FPDF_PAGE page, int start_x, int start_y, int size_x, int size_y, int rotate, int flags)'
      )(bitmap, page, startX, startY, sizeX, sizeY, rotate, flags);
    },
    FPDFText_LoadPage: (page) => f('FPDF_TEXTPAGE FPDFText_LoadPage(FPDF_PAGE page)')(page),
    FPDFText_ClosePage: (textPage) => {
      f('void FPDFText_ClosePage(FPDF_TEXTPAGE text_page)')(textPage);
    },
    FPDFText_CountChars: (textPage) => f('int FPDFText_CountChars(FPDF_TEXTPAGE text_page)')(textPage),
    FPDFText_GetText: (textPage, startIndex, count, result) =>
      f('int FPDFText_GetText(FPDF_TEXTPAGE text_page, int start_index, int count, unsigned short *result)')(
        textPage,
        startIndex,
        count,
        result
      ),
    FPDFText_GetUnicode: (textPage, index) =>
      f('uint32 FPDFText_GetUnicode(FPDF_TEXTPAGE text_page, int index)')(textPage, index),
    FPDFText_GetCharBox: (textPage, index, left, right, bottom, top) =>
      f(
        'int FPDFText_GetCharBox(FPDF_TEXTPAGE text_page, int index, _Out_ double *left, _Out_ double *right, _Out_ double *bottom, _Out_ double *top)'
      )(textPage, index, left, right, bottom, top),
    FPDFText_GetCharOrigin: (textPage, index, x, y) =>
      f('int FPDFText_GetCharOrigin(FPDF_TEXTPAGE text_page, int index, _Out_ double *x, _Out_ double *y)')(
        textPage,
        index,
        x,
        y
      ),
    FPDFText_GetCharIndexAtPos: (textPage, x, y, xTolerance, yTolerance) =>
      f(
        'int FPDFText_GetCharIndexAtPos(FPDF_TEXTPAGE text_page, double x, double y, double x_tol, double y_tol)'
      )(textPage, x, y, xTolerance, yTolerance),
    FPDFText_CountRects: (textPage, start, count) =>
      f('int FPDFText_CountRects(FPDF_TEXTPAGE text_page, int start, int count)')(
        textPage,
        start,
        count
      ),
    FPDFText_GetRect: (textPage, rectIndex, left, top, right, bottom) =>
      f(
        'int FPDFText_GetRect(FPDF_TEXTPAGE text_page, int rect_index, _Out_ double *left, _Out_ double *top, _Out_ double *right, _Out_ double *bottom)'
      )(textPage, rectIndex, left, top, right, bottom),
    FPDFText_GetFontSize: (textPage, index) =>
      f('double FPDFText_GetFontSize(FPDF_TEXTPAGE text_page, int index)')(textPage, index),
    FPDFPage_CountObjects: (page) => f('int FPDFPage_CountObjects(FPDF_PAGE page)')(page),
    FPDFPage_GetObject: (page, index) =>
      f('FPDF_PAGEOBJECT FPDFPage_GetObject(FPDF_PAGE page, int index)')(page, index),
    FPDFPageObj_GetType: (pageObject) => f('int FPDFPageObj_GetType(FPDF_PAGEOBJECT object)')(pageObject),
    FPDFPageObj_GetBounds: (pageObject, left, bottom, right, top) =>
      f(
        'int FPDFPageObj_GetBounds(FPDF_PAGEOBJECT object, _Out_ float *left, _Out_ float *bottom, _Out_ float *right, _Out_ float *top)'
      )(pageObject, left, bottom, right, top),
    FPDFPath_CountSegments: (pageObject) =>
      f('int FPDFPath_CountSegments(FPDF_PAGEOBJECT path_object)')(pageObject),
    FPDFPath_GetPathSegment: (pageObject, index) =>
      f('FPDF_PATHSEGMENT FPDFPath_GetPathSegment(FPDF_PAGEOBJECT path_object, int index)')(
        pageObject,
        index
      ),
    FPDFPathSegment_GetType: (segment) => f('int FPDFPathSegment_GetType(FPDF_PATHSEGMENT segment)')(segment),
    FPDFPathSegment_GetPoint: (segment, x, y) =>
      f('int FPDFPathSegment_GetPoint(FPDF_PATHSEGMENT segment, _Out_ float *x, _Out_ float *y)')(
        segment,
        x,
        y
      ),
    FPDFTextObj_GetText: (pageObject, textPage, buffer, length) =>
      f('ulong FPDFTextObj_GetText(FPDF_PAGEOBJECT text_object, FPDF_TEXTPAGE text_page, void *buffer, ulong length)')(
        pageObject,
        textPage,
        buffer,
        length
      ),
    FPDFTextObj_GetFontSize: (pageObject, fontSize) =>
      f('float FPDFTextObj_GetFontSize(FPDF_PAGEOBJECT text_object, _Out_ float *font_size)')(
        pageObject,
        fontSize
      ),
    FPDFDOC_InitFormFillEnvironment: (document, formInfo) =>
      f('FPDF_FORMHANDLE FPDFDOC_InitFormFillEnvironment(FPDF_DOCUMENT document, FPDF_FORMFILLINFO_V2 *formInfo)')(
        document,
        formInfo
      ),
    FPDFDOC_ExitFormFillEnvironment: (formHandle) => {
      f('void FPDFDOC_ExitFormFillEnvironment(FPDF_FORMHANDLE hHandle)')(formHandle);
    },
    FPDF_FFLDraw: (formHandle, bitmap, page, startX, startY, sizeX, sizeY, rotate, flags) => {
      f(
        'void FPDF_FFLDraw(FPDF_FORMHANDLE hHandle, FPDF_BITMAP bitmap, FPDF_PAGE page, int start_x, int start_y, int size_x, int size_y, int rotate, int flags)'
      )(
        formHandle,
        bitmap,
        page,
        startX,
        startY,
        sizeX,
        sizeY,
        rotate,
        flags
      );
    },
    FPDFPage_Flatten: (page, flag) => f('int FPDFPage_Flatten(FPDF_PAGE page, int nFlag)')(page, flag),
    FPDFPage_GetRotation: (page) => f('int FPDFPage_GetRotation(FPDF_PAGE page)')(page),
    FPDFPage_SetRotation: (page, rotate) => {
      f('void FPDFPage_SetRotation(FPDF_PAGE page, int nRotate)')(page, rotate);
    },
    FPDFPage_TransFormWithClip: (page, matrix, clip) =>
      f('int FPDFPage_TransFormWithClip(FPDF_PAGE page, FS_MATRIX *matrix, FS_RECTF *clip)')(
        page,
        matrix,
        clip
      ),
    FPDFPage_TransformAnnots: (page, a, b, c, d, e, ff) => {
      f(
        'void FPDFPage_TransformAnnots(FPDF_PAGE page, double a, double b, double c, double d, double e, double f)'
      )(page, a, b, c, d, e, ff);
    },
    FPDFPage_GenerateContent: (page) => f('int FPDFPage_GenerateContent(FPDF_PAGE page)')(page),
    FPDFPage_GetMediaBox: (page, left, bottom, right, top) =>
      f(
        'int FPDFPage_GetMediaBox(FPDF_PAGE page, _Out_ float *left, _Out_ float *bottom, _Out_ float *right, _Out_ float *top)'
      )(page, left, bottom, right, top),
    FPDFPage_SetMediaBox: (page, left, bottom, right, top) => {
      f('void FPDFPage_SetMediaBox(FPDF_PAGE page, float left, float bottom, float right, float top)')(
        page,
        left,
        bottom,
        right,
        top
      );
    },
    FPDFPage_GetCropBox: (page, left, bottom, right, top) =>
      f(
        'int FPDFPage_GetCropBox(FPDF_PAGE page, _Out_ float *left, _Out_ float *bottom, _Out_ float *right, _Out_ float *top)'
      )(page, left, bottom, right, top),
    FPDFPage_SetCropBox: (page, left, bottom, right, top) => {
      f('void FPDFPage_SetCropBox(FPDF_PAGE page, float left, float bottom, float right, float top)')(
        page,
        left,
        bottom,
        right,
        top
      );
    },
    FPDFPage_GetBleedBox: (page, left, bottom, right, top) =>
      f(
        'int FPDFPage_GetBleedBox(FPDF_PAGE page, _Out_ float *left, _Out_ float *bottom, _Out_ float *right, _Out_ float *top)'
      )(page, left, bottom, right, top),
    FPDFPage_SetBleedBox: (page, left, bottom, right, top) => {
      f('void FPDFPage_SetBleedBox(FPDF_PAGE page, float left, float bottom, float right, float top)')(
        page,
        left,
        bottom,
        right,
        top
      );
    },
    FPDFPage_GetTrimBox: (page, left, bottom, right, top) =>
      f(
        'int FPDFPage_GetTrimBox(FPDF_PAGE page, _Out_ float *left, _Out_ float *bottom, _Out_ float *right, _Out_ float *top)'
      )(page, left, bottom, right, top),
    FPDFPage_SetTrimBox: (page, left, bottom, right, top) => {
      f('void FPDFPage_SetTrimBox(FPDF_PAGE page, float left, float bottom, float right, float top)')(
        page,
        left,
        bottom,
        right,
        top
      );
    },
    FPDFPage_GetArtBox: (page, left, bottom, right, top) =>
      f(
        'int FPDFPage_GetArtBox(FPDF_PAGE page, _Out_ float *left, _Out_ float *bottom, _Out_ float *right, _Out_ float *top)'
      )(page, left, bottom, right, top),
    FPDFPage_SetArtBox: (page, left, bottom, right, top) => {
      f('void FPDFPage_SetArtBox(FPDF_PAGE page, float left, float bottom, float right, float top)')(
        page,
        left,
        bottom,
        right,
        top
      );
    },
    FPDF_SaveAsCopy: (document, fileWrite, flags) =>
      f('int FPDF_SaveAsCopy(FPDF_DOCUMENT document, FPDF_FILEWRITE *pFileWrite, ulong flags)')(
        document,
        fileWrite,
        flags
      ),
    FPDF_CreateNewDocument: () => f('FPDF_DOCUMENT FPDF_CreateNewDocument()')(),
    FPDF_ImportPages: (destination, source, pageRange, index) =>
      f('int FPDF_ImportPages(FPDF_DOCUMENT dest_doc, FPDF_DOCUMENT src_doc, const char *pagerange, int index)')(
        destination,
        source,
        pageRange,
        index
      )
  };
}

export function initializeLibrary(): void {
  if (api !== null) {
    return;
  }

  lib = loadLibrary();
  api = buildApi(lib);

  const config = {
    version: 2,
    m_pUserFontPaths: null,
    m_pIsolate: null,
    m_v8EmbedderSlot: 0,
    m_pPlatform: null,
    m_RendererType: 0
  };

  api.FPDF_InitLibraryWithConfig(koffi.as(config, 'FPDF_LIBRARY_CONFIG *') as unknown as bigint);

  if (!exitHookInstalled) {
    exitHookInstalled = true;
    process.on('exit', () => {
      try {
        cleanupLibrary();
      } catch {
        return;
      }
    });
  }
}

export function cleanupLibrary(): void {
  if (api === null) {
    return;
  }

  try {
    api.FPDF_DestroyLibrary();
  } finally {
    api = null;
    lib = null;
  }
}

function getApi(): Api {
  if (api === null) {
    initializeLibrary();
  }

  return api as Api;
}

export function checkLastError(contextMessage = 'PDFium operation failed'): void {
  const errorCode = numOf(getApi().FPDF_GetLastError());

  if (errorCode === FPDF_ERR_SUCCESS) {
    return;
  }

  throw new PdfiumError(`${contextMessage}: ${errorMessage(errorCode)} (Code: ${errorCode})`);
}

interface DocumentState {
  documentPtr: Handle<FPDFDocumentPtr>;
  sourceData: Uint8Array | null;
  pages: Map<number, Page>;
  pageCountCache: number | undefined;
  formHandle: Handle<FPDFFormHandlePtr>;
  formFillInfoPtr: KoffiAllocation | null;
  closed: boolean;
}

const documentFinalizer = new FinalizationRegistry((state: DocumentState) => {
  try {
    finalizeDocument(state);
  } catch {
    return;
  }
});

function finalizeDocument(state: DocumentState): void {
  if (api === null || state.closed || state.documentPtr === null) {
    return;
  }

  if (state.formHandle !== null) {
    try {
      getApi().FPDFDOC_ExitFormFillEnvironment(state.formHandle);
    } catch {
      return;
    } finally {
      state.formHandle = null;
    }
  }

  getApi().FPDF_CloseDocument(state.documentPtr);

  state.documentPtr = null;

  if (state.formFillInfoPtr !== null) {
    freeStruct(state.formFillInfoPtr);
    state.formFillInfoPtr = null;
  }

  state.closed = true;
}

function makeFormFillInfo(): Record<string, number | null> {
  return { version: 2, xfa_disabled: 0 };
}

function sortByReadingOrder<T extends TextNode>(nodes: T[], pageWidth: number): T[] {
  const yThreshold = 4.0 / pageWidth;

  return nodes.sort((a, b) =>
    Math.abs(a.endy - b.endy) < yThreshold ? a.x - b.x : a.endy - b.endy
  );
}

function calculateRenderDimensions(
  pageWidth: number,
  pageHeight: number,
  widthParam: number | undefined,
  heightParam: number | undefined,
  scaleParam: number | undefined
): [number, number] {
  let renderWidth: number;
  let renderHeight: number;

  if (scaleParam !== undefined) {
    renderWidth = Math.round(pageWidth * scaleParam);
    renderHeight = Math.round(pageHeight * scaleParam);
  } else if (widthParam !== undefined || heightParam !== undefined) {
    if (widthParam !== undefined && heightParam !== undefined) {
      renderWidth = widthParam;
      renderHeight = heightParam;
    } else if (widthParam !== undefined) {
      const scaleFactor = widthParam / pageWidth;
      renderWidth = widthParam;
      renderHeight = Math.round(pageHeight * scaleFactor);
    } else {
      const scaleFactor = (heightParam as number) / pageHeight;
      renderWidth = Math.round(pageWidth * scaleFactor);
      renderHeight = heightParam as number;
    }
  } else {
    renderWidth = Math.trunc(pageWidth);
    renderHeight = Math.trunc(pageHeight);
  }

  return [
    Math.min(MAX_SIZE, Math.max(1, renderWidth)),
    Math.min(MAX_SIZE, Math.max(1, renderHeight))
  ];
}

let crcTable: Uint32Array | null = null;

function crc32(bytes: Uint8Array): number {
  if (crcTable === null) {
    crcTable = new Uint32Array(256);

    for (let n = 0; n < 256; n++) {
      let c = n;

      for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }

      crcTable[n] = c >>> 0;
    }
  }

  let crc = 0xffffffff;

  for (let i = 0; i < bytes.length; i++) {
    crc = ((crcTable[(crc ^ (bytes[i] ?? 0)) & 0xff] ?? 0) ^ (crc >>> 8)) >>> 0;
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(chunkType: string, data: Uint8Array): Uint8Array {
  const payload = new Uint8Array(12 + data.length);
  const view = new DataView(payload.buffer);

  view.setUint32(0, data.length, false);

  for (let i = 0; i < 4; i++) {
    payload[4 + i] = chunkType.charCodeAt(i);
  }

  payload.set(data, 8);

  view.setUint32(8 + data.length, crc32(payload.subarray(4, 8 + data.length)), false);

  return payload;
}

export function encodePngRgba(rgba: Uint8Array, width: number, height: number): Uint8Array {
  const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const stride = width * 4;
  const raw = new Uint8Array((stride + 1) * height);

  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }

  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);

  ihdrView.setUint32(0, width, false);
  ihdrView.setUint32(4, height, false);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const idat = deflateSync(raw, { level: 6 });
  const iend = new Uint8Array(0);

  const totalLength =
    signature.length +
    (12 + ihdr.length) +
    (12 + idat.length) +
    (12 + iend.length);

  const png = new Uint8Array(totalLength);
  let offset = 0;

  for (const part of [signature, pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', iend)]) {
    png.set(part, offset);
    offset += part.length;
  }

  return png;
}

export class Page {
  readonly document: Document;
  readonly pageIndex: number;

  #pagePtr: Handle<FPDFPagePtr>;
  #closed = false;
  #width: number | null = null;
  #height: number | null = null;
  #text: string | null = null;
  #textNodes: TextNode[] | null = null;
  #textObjects: TextObject[] | null = null;
  #lineNodes: LineNode[] | null = null;

  constructor(document: Document, pageIndex: number) {
    if (!(document instanceof Document)) {
      throw new TypeError('Document object is required');
    }

    document.ensureNotClosed();

    this.document = document;
    this.pageIndex = pageIndex;

    this.#pagePtr = toHandle<FPDFPagePtr>(
      getApi().FPDF_LoadPage(document.documentPtr as FPDFDocumentPtr, pageIndex)
    );

    if (this.#pagePtr === null) {
      checkLastError(`Failed to load page ${pageIndex}`);

      throw new PdfiumError(`Failed to load page ${pageIndex}, pointer is NULL.`);
    }
  }

  get pagePtr(): Handle<FPDFPagePtr> {
    return this.#pagePtr;
  }

  get formHandle(): Handle<FPDFFormHandlePtr> {
    return this.document.formHandle;
  }

  get width(): number {
    if (this.#width === null) {
      this.#width = numOf(getApi().FPDF_GetPageWidthF(this.#pagePtr as FPDFPagePtr));
    }

    return this.#width;
  }

  get height(): number {
    if (this.#height === null) {
      this.#height = numOf(getApi().FPDF_GetPageHeightF(this.#pagePtr as FPDFPagePtr));
    }

    return this.#height;
  }

  get text(): string {
    if (this.#text !== null) {
      return this.#text;
    }

    this.ensureNotClosed();

    const bindings = getApi();
    const textPage = toHandle<FPDFTextPagePtr>(bindings.FPDFText_LoadPage(this.#pagePtr as FPDFPagePtr));

    if (textPage === null) {
      checkLastError(`Failed to load text page ${this.pageIndex}`);

      throw new PdfiumError(`Failed to load text page ${this.pageIndex}, pointer is NULL.`);
    }

    try {
      const charCount = numOf(bindings.FPDFText_CountChars(textPage));

      if (charCount === 0) {
        return (this.#text = '');
      }

      const bufferCapacity = charCount + 1;
      const buffer = new Uint8Array(bufferCapacity * 2);

      const charsWritten = numOf(bindings.FPDFText_GetText(textPage, 0, bufferCapacity, buffer));

      if (charsWritten <= 0) {
        checkLastError(`Failed to extract text from page ${this.pageIndex}`);

        return (this.#text = '');
      }

      this.#text = decodeUtf16Le(buffer, (charsWritten - 1) * 2);

      return this.#text;
    } finally {
      bindings.FPDFText_ClosePage(textPage);
    }
  }

  isClosed(): boolean {
    return this.#closed;
  }

  ensureNotClosed(): void {
    if (this.#closed) {
      throw new PdfiumError('Page is closed.');
    }

    this.document.ensureNotClosed();
  }

  renderToBitmap(options: RenderOptions = {}): RenderedBitmap {
    this.ensureNotClosed();

    const {
      width: widthParam,
      height: heightParam,
      scale: scaleParam,
      backgroundColor = DEFAULT_BACKGROUND_COLOR,
      flags = DEFAULT_RENDER_FLAGS
    } = options;

    const [renderWidth, renderHeight] = calculateRenderDimensions(
      this.width,
      this.height,
      widthParam,
      heightParam,
      scaleParam
    );

    const bindings = getApi();
    let bitmapPtr: Handle<FPDFBitmapPtr> = null;

    try {
      bitmapPtr = toHandle<FPDFBitmapPtr>(
        bindings.FPDFBitmap_Create(renderWidth, renderHeight, 1)
      );

      if (bitmapPtr === null) {
        checkLastError('Failed to create bitmap (potential pre-existing error)');

        throw new PdfiumError('Failed to create bitmap (FPDFBitmap_Create returned NULL)');
      }

      bindings.FPDFBitmap_FillRect(
        bitmapPtr,
        0,
        0,
        renderWidth,
        renderHeight,
        toUlong(backgroundColor)
      );

      bindings.FPDF_RenderPageBitmap(
        bitmapPtr,
        this.#pagePtr as FPDFPagePtr,
        0,
        0,
        renderWidth,
        renderHeight,
        0,
        flags
      );

      const formHandle = this.formHandle;

      if (formHandle !== null) {
        bindings.FPDF_FFLDraw(
          formHandle,
          bitmapPtr,
          this.#pagePtr as FPDFPagePtr,
          0,
          0,
          renderWidth,
          renderHeight,
          0,
          flags
        );
      }

      const bufferPtr = toHandle<bigint>(bindings.FPDFBitmap_GetBuffer(bitmapPtr));
      const stride = numOf(bindings.FPDFBitmap_GetStride(bitmapPtr));

      if (bufferPtr === null || stride <= 0) {
        throw new PdfiumError('Failed to acquire bitmap buffer');
      }

      const byteLength = stride * renderHeight;
      const bitmapData = new Uint8Array(byteLength);

      bitmapData.set(new Uint8Array(koffi.view(bufferPtr, byteLength)));

      return { data: bitmapData, width: renderWidth, height: renderHeight };
    } finally {
      if (bitmapPtr !== null) {
        bindings.FPDFBitmap_Destroy(bitmapPtr);
      }
    }
  }

  renderToPng(options: RenderOptions = {}): Uint8Array {
    const { data, width, height } = this.renderToBitmap(options);

    return encodePngRgba(data, width, height);
  }

  textNodes(): TextNode[] {
    if (this.#textNodes !== null) {
      return this.#textNodes;
    }

    this.ensureNotClosed();

    const bindings = getApi();
    const textPage = toHandle<FPDFTextPagePtr>(bindings.FPDFText_LoadPage(this.#pagePtr as FPDFPagePtr));

    if (textPage === null) {
      throw new PdfiumError(`Failed to load text page ${this.pageIndex}, pointer is NULL.`);
    }

    try {
      const charCount = numOf(bindings.FPDFText_CountChars(textPage));
      const nodes: TextNode[] = [];

      if (charCount === 0) {
        return (this.#textNodes = nodes);
      }

      const left: number[] = [0];
      const right: number[] = [0];
      const bottom: number[] = [0];
      const top: number[] = [0];
      const originX: number[] = [0];
      const originY: number[] = [0];

      const pageWidth = this.width;
      const pageHeight = this.height;

      let i = 0;

      while (i < charCount) {
        const boxIndex = i;

        let codepoint = numOf(bindings.FPDFText_GetUnicode(textPage, i));

        if (codepoint >= 0xd800 && codepoint <= 0xdbff && i + 1 < charCount) {
          const codepoint2 = numOf(bindings.FPDFText_GetUnicode(textPage, i + 1));

          if (codepoint2 >= 0xdc00 && codepoint2 <= 0xdfff) {
            codepoint = 0x10000 + ((codepoint - 0xd800) << 10) + (codepoint2 - 0xdc00);

            i += 1;
          }
        }

        const char = String.fromCodePoint(codepoint);

        if (numOf(bindings.FPDFText_GetCharBox(textPage, boxIndex, left, right, bottom, top)) === 0) {
          i += 1;

          continue;
        }

        const charLeft = firstOf(left);
        const charRight = firstOf(right);

        bindings.FPDFText_GetCharOrigin(textPage, boxIndex, originX, originY);

        const charOriginX = firstOf(originX);
        const charOriginY = firstOf(originY);

        let fontSize = numOf(bindings.FPDFText_GetFontSize(textPage, boxIndex));

        if (fontSize === 1) {
          fontSize = 8;
        }

        const absX = charLeft;
        const absY = pageHeight - charOriginY - fontSize * 0.8;
        const absWidth = charRight - charLeft;
        const absHeight = fontSize;

        const x = charOriginX / pageWidth;
        const y = absY / pageHeight;
        const nodeWidth = (absWidth + Math.abs(absX - charOriginX) * 2) / pageWidth;
        const nodeHeight = absHeight / pageHeight;

        nodes.push(new TextNodeImpl(char, x, y, nodeWidth, nodeHeight));

        i += 1;
      }

      return (this.#textNodes = sortByReadingOrder(nodes, this.width));
    } finally {
      bindings.FPDFText_ClosePage(textPage);
    }
  }

  textObjects(): TextObject[] {
    if (this.#textObjects !== null) {
      return this.#textObjects;
    }

    this.ensureNotClosed();

    const bindings = getApi();
    const objects: TextObject[] = [];

    const objectCount = numOf(bindings.FPDFPage_CountObjects(this.#pagePtr as FPDFPagePtr));

    if (objectCount === 0) {
      return (this.#textObjects = objects);
    }

    const textPage = toHandle<FPDFTextPagePtr>(bindings.FPDFText_LoadPage(this.#pagePtr as FPDFPagePtr));

    if (textPage === null) {
      checkLastError(`Failed to load text page ${this.pageIndex}`);

      throw new PdfiumError(`Failed to load text page ${this.pageIndex}, pointer is NULL.`);
    }

    try {
      const left: number[] = [0];
      const bottom: number[] = [0];
      const right: number[] = [0];
      const top: number[] = [0];
      const fontSizeOut: number[] = [0];

      for (let i = 0; i < objectCount; i++) {
        const pageObject = toHandle<FPDFPageObjectPtr>(bindings.FPDFPage_GetObject(this.#pagePtr as FPDFPagePtr, i));

        if (pageObject === null) {
          continue;
        }

        if (numOf(bindings.FPDFPageObj_GetType(pageObject)) !== FPDF_PAGEOBJ_TEXT) {
          continue;
        }

        const neededBytes = numOf(bindings.FPDFTextObj_GetText(pageObject, textPage, null, 0));

        if (neededBytes < 4) {
          continue;
        }

        const buffer = new Uint8Array(neededBytes);
        const written = numOf(bindings.FPDFTextObj_GetText(pageObject, textPage, buffer, toUlong(neededBytes)));

        if (written < 4) {
          continue;
        }

        const content = decodeUtf16Le(buffer, written - 2);

        if (content.length === 0) {
          continue;
        }

        if (numOf(bindings.FPDFPageObj_GetBounds(pageObject, left, bottom, right, top)) === 0) {
          continue;
        }

        const objLeft = firstOf(left);
        const objBottom = firstOf(bottom);
        const objRight = firstOf(right);
        const objTop = firstOf(top);

        const objWidth = objRight - objLeft;
        const objHeight = objTop - objBottom;

        if (objWidth <= 0 || objHeight <= 0) {
          continue;
        }

        const reportedFontSize = numOf(bindings.FPDFTextObj_GetFontSize(pageObject, fontSizeOut));

        let fontSize = firstOf(fontSizeOut);

        if (!fontSize) {
          fontSize = reportedFontSize > 0 ? reportedFontSize : objHeight;
        }

        if (fontSize === 1) {
          fontSize = 8;
        }

        const normX = objLeft / this.width;
        const normY = (this.height - objTop) / this.height;
        const normW = objWidth / this.width;
        const normH = objHeight / this.height;

        objects.push(new TextObjectImpl(content, normX, normY, normW, normH, fontSize));
      }

      return (this.#textObjects = sortByReadingOrder(objects, this.width));
    } finally {
      bindings.FPDFText_ClosePage(textPage);
    }
  }

  lineNodes(): LineNode[] {
    if (this.#lineNodes !== null) {
      return this.#lineNodes;
    }

    this.ensureNotClosed();

    const bindings = getApi();
    const nodes: LineNode[] = [];

    const objectCount = numOf(bindings.FPDFPage_CountObjects(this.#pagePtr as FPDFPagePtr));

    if (objectCount === 0) {
      return (this.#lineNodes = nodes);
    }

    const left: number[] = [0];
    const bottom: number[] = [0];
    const right: number[] = [0];
    const top: number[] = [0];

    for (let i = 0; i < objectCount; i++) {
      const pageObject = toHandle<FPDFPageObjectPtr>(bindings.FPDFPage_GetObject(this.#pagePtr as FPDFPagePtr, i));

      if (pageObject === null) {
        continue;
      }

      if (numOf(bindings.FPDFPageObj_GetType(pageObject)) !== FPDF_PAGEOBJ_PATH) {
        continue;
      }

      bindings.FPDFPageObj_GetBounds(pageObject, left, bottom, right, top);

      const objLeft = firstOf(left);
      const objBottom = firstOf(bottom);
      const objRight = firstOf(right);
      const objTop = firstOf(top);

      const objWidth = objRight - objLeft;
      const objHeight = objTop - objBottom;

      if (objWidth < 1 && objHeight < 1) {
        continue;
      }

      const segmentCount = numOf(bindings.FPDFPath_CountSegments(pageObject));

      if (segmentCount < 2) {
        continue;
      }

      if (!(segmentCount <= 10 && (objHeight < 10 || objWidth < 10))) {
        continue;
      }

      let tilt: number;

      if (objWidth > objHeight && objHeight < 10) {
        tilt = 0;
      } else if (objHeight > objWidth && objWidth < 10) {
        tilt = 90;
      } else {
        continue;
      }

      const normX = objLeft / this.width;
      const normY = (this.height - objBottom - objHeight) / this.height;
      const normW = objWidth / this.width;
      const normH = objHeight / this.height;

      nodes.push(new LineNodeImpl(normX, normY, normW, normH, tilt));
    }

    nodes.sort((a, b) => (a.endy === b.endy ? a.x - b.x : a.endy - b.endy));

    return (this.#lineNodes = nodes);
  }

  rotate(): boolean {
    this.ensureNotClosed();

    const bindings = getApi();
    const pagePtr = this.#pagePtr as FPDFPagePtr;

    const rotation = numOf(bindings.FPDFPage_GetRotation(pagePtr));

    if (rotation === 0) {
      return false;
    }

    const l: number[] = [0];
    const b: number[] = [0];
    const r: number[] = [0];
    const t: number[] = [0];

    const hasCrop = numOf(bindings.FPDFPage_GetCropBox(pagePtr, l, b, r, t)) !== 0;

    if (!hasCrop) {
      bindings.FPDFPage_GetMediaBox(pagePtr, l, b, r, t);
    }

    const pl = firstOf(l);
    const pb = firstOf(b);
    const pr = firstOf(r);
    const pt = firstOf(t);

    let a: number;
    let bb: number;
    let c: number;
    let d: number;
    let e: number;
    let f: number;

    switch (rotation) {
      case 1:
        [a, bb, c, d, e, f] = [0, -1, 1, 0, -pb, pr];
        break;
      case 2:
        [a, bb, c, d, e, f] = [-1, 0, 0, -1, pr, pt];
        break;
      case 3:
        [a, bb, c, d, e, f] = [0, 1, -1, 0, pt, -pl];
        break;
      default:
        return false;
    }

    const pageBoxes = [
      { get: bindings.FPDFPage_GetMediaBox, set: bindings.FPDFPage_SetMediaBox },
      { get: bindings.FPDFPage_GetCropBox, set: bindings.FPDFPage_SetCropBox },
      { get: bindings.FPDFPage_GetBleedBox, set: bindings.FPDFPage_SetBleedBox },
      { get: bindings.FPDFPage_GetTrimBox, set: bindings.FPDFPage_SetTrimBox },
      { get: bindings.FPDFPage_GetArtBox, set: bindings.FPDFPage_SetArtBox }
    ];

    for (const box of pageBoxes) {
      if (numOf(box.get(pagePtr, l, b, r, t)) === 0) {
        continue;
      }

      const bl = firstOf(l);
      const bbo = firstOf(b);
      const br = firstOf(r);
      const bt = firstOf(t);

      let c1x: number;
      let c1y: number;
      let c2x: number;
      let c2y: number;

      switch (rotation) {
        case 1:
          [c1x, c1y, c2x, c2y] = [br, bbo, bl, bt];
          break;
        case 2:
          [c1x, c1y, c2x, c2y] = [br, bt, bl, bbo];
          break;
        default:
          [c1x, c1y, c2x, c2y] = [bl, bt, br, bbo];
          break;
      }

      const newLLx = a * c1x + c * c1y + e;
      const newLLy = bb * c1x + d * c1y + f;
      const newURx = a * c2x + c * c2y + e;
      const newURy = bb * c2x + d * c2y + f;

      box.set(pagePtr, newLLx, newLLy, newURx, newURy);
    }

    bindings.FPDFPage_TransformAnnots(pagePtr, a, bb, c, d, e, f);

    const matrix = { a, b: bb, c, d, e, f };

    bindings.FPDFPage_TransFormWithClip(
      pagePtr,
      koffi.as(matrix, 'FS_MATRIX *') as unknown as bigint,
      null
    );

    bindings.FPDFPage_SetRotation(pagePtr, 0);
    bindings.FPDFPage_GenerateContent(pagePtr);

    return true;
  }

  flatten(flag: number = FLAT_NORMALDISPLAY): number {
    this.ensureNotClosed();

    const result = numOf(getApi().FPDFPage_Flatten(this.#pagePtr as FPDFPagePtr, flag));

    if (result === FLATTEN_FAIL) {
      checkLastError(`Failed to flatten page ${this.pageIndex}`);

      throw new PdfiumError(`Failed to flatten page ${this.pageIndex}`);
    }

    return result;
  }

  close(): void {
    if (this.#closed) {
      return;
    }

    if (this.#pagePtr !== null) {
      getApi().FPDF_ClosePage(this.#pagePtr);
    }

    this.#pagePtr = null;
    this.#closed = true;
  }
}

export class Document {
  #state: DocumentState;

  private constructor(documentPtr: Handle<FPDFDocumentPtr>, sourceData: Uint8Array | null = null) {
    if (documentPtr === null) {
      throw new TypeError('document_ptr cannot be nil');
    }

    const state: DocumentState = {
      documentPtr,
      sourceData,
      pages: new Map<number, Page>(),
      pageCountCache: undefined,
      formHandle: null,
      formFillInfoPtr: null,
      closed: false
    };

    const formFillInfoPtr = allocateStruct(
      'FPDF_FORMFILLINFO_V2',
      FPDF_FORMFILLINFO_MEMBER_TYPES,
      makeFormFillInfo()
    );

    state.formFillInfoPtr = formFillInfoPtr;
    state.formHandle = toHandle<FPDFFormHandlePtr>(
      getApi().FPDFDOC_InitFormFillEnvironment(documentPtr, formFillInfoPtr)
    );

    this.#state = state;

    documentFinalizer.register(this, state, this);
  }

  get documentPtr(): Handle<FPDFDocumentPtr> {
    return this.#state.documentPtr;
  }

  get formHandle(): Handle<FPDFFormHandlePtr> {
    return this.#state.formHandle;
  }

  get pageCount(): number {
    if (this.#state.pageCountCache === undefined) {
      this.#state.pageCountCache = numOf(
        getApi().FPDF_GetPageCount(this.#state.documentPtr as FPDFDocumentPtr)
      );
    }

    return this.#state.pageCountCache;
  }

  static create(): Document {
    const documentPtr = toHandle<FPDFDocumentPtr>(getApi().FPDF_CreateNewDocument());

    if (documentPtr === null) {
      checkLastError('Failed to create new document');

      throw new PdfiumError('Failed to create new document');
    }

    return new Document(documentPtr);
  }

  static openFile(filePath: string, password: string | null = null): Document {
    const documentPtr = toHandle<FPDFDocumentPtr>(getApi().FPDF_LoadDocument(filePath, password));

    if (documentPtr === null) {
      checkLastError(`Failed to load document from file '${filePath}'`);

      throw new PdfiumError(`Failed to load document from file '${filePath}', pointer is NULL.`);
    }

    return new Document(documentPtr);
  }

  static openBytes(data: Uint8Array | ArrayBuffer, password: string | null = null): Document {
    const sourceData = data instanceof Uint8Array ? data : new Uint8Array(data);

    const documentPtr = toHandle<FPDFDocumentPtr>(
      getApi().FPDF_LoadMemDocument(sourceData, sourceData.byteLength, password)
    );

    if (documentPtr === null) {
      checkLastError('Failed to load document from memory');

      throw new PdfiumError('Failed to load document from memory, pointer is NULL.');
    }

    return new Document(documentPtr, sourceData);
  }

  isClosed(): boolean {
    return this.#state.closed;
  }

  ensureNotClosed(): void {
    if (this.isClosed()) {
      throw new PdfiumError('Document is closed.');
    }
  }

  getPage(pageIndex: number): Page {
    this.ensureNotClosed();

    if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= this.pageCount) {
      throw new PdfiumError(`Page index ${pageIndex} out of range (0..${this.pageCount - 1})`);
    }

    const cached = this.#state.pages.get(pageIndex);

    if (cached !== undefined) {
      return cached;
    }

    const page = new Page(this, pageIndex);

    this.#state.pages.set(pageIndex, page);

    return page;
  }

  importPages(source: Document): number {
    this.ensureNotClosed();

    const index = this.pageCount;

    const result = numOf(
      getApi().FPDF_ImportPages(
        this.#state.documentPtr as FPDFDocumentPtr,
        source.documentPtr as FPDFDocumentPtr,
        null,
        index
      )
    );

    if (result === 0) {
      throw new PdfiumError('Failed to import pages');
    }

    this.#state.pageCountCache = undefined;

    return result;
  }

  save(stream: PdfWriteTarget, flags: number = FPDF_NO_INCREMENTAL): PdfWriteTarget {
    this.ensureNotClosed();

    const bindings = getApi();
    const documentPtr = this.#state.documentPtr as FPDFDocumentPtr;

    const writeBlock = koffi.register(
      (_pThis: unknown, data: unknown, size: unknown): number => {
        const length = Number(size ?? 0);

        if (data === null || data === undefined || !Number.isFinite(length) || length <= 0) {
          return 1;
        }

        const chunk = new Uint8Array(length);

        chunk.set(new Uint8Array(koffi.view(data, length)));
        stream.write(chunk);

        return 1;
      },
      FPDF_FILEWRITE_MEMBER_TYPES.WriteBlock
    );

    const fileWrite = allocateStruct('FPDF_FILEWRITE', FPDF_FILEWRITE_MEMBER_TYPES, {
      version: 1,
      WriteBlock: writeBlock
    });

    try {
      const result = numOf(bindings.FPDF_SaveAsCopy(documentPtr, fileWrite, toUlong(flags)));

      if (result === 0) {
        checkLastError('Failed to save document');

        throw new PdfiumError('Failed to save document');
      }
    } finally {
      koffi.unregister(writeBlock);
      freeStruct(fileWrite);
    }

    return stream;
  }

  saveToBuffer(flags: number = FPDF_NO_INCREMENTAL): Uint8Array {
    const chunks: Uint8Array[] = [];

    this.save(
      {
        write: (chunk: Uint8Array) => {
          chunks.push(chunk);
        }
      },
      flags
    );

    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const output = new Uint8Array(totalLength);
    let offset = 0;

    for (const chunk of chunks) {
      output.set(chunk, offset);
      offset += chunk.length;
    }

    return output;
  }

  close(): void {
    if (this.#state.closed) {
      return;
    }

    for (const page of this.#state.pages.values()) {
      if (!page.isClosed()) {
        page.close();
      }
    }

    this.#state.pages.clear();

    if (this.#state.formHandle !== null) {
      getApi().FPDFDOC_ExitFormFillEnvironment(this.#state.formHandle);

      this.#state.formHandle = null;
    }

    if (this.#state.formFillInfoPtr !== null) {
      freeStruct(this.#state.formFillInfoPtr);
      this.#state.formFillInfoPtr = null;
    }

    if (this.#state.documentPtr !== null) {
      getApi().FPDF_CloseDocument(this.#state.documentPtr);
    }

    this.#state.documentPtr = null;
    this.#state.sourceData = null;
    this.#state.pageCountCache = undefined;
    this.#state.closed = true;
  }
}

const Pdfium = {
  LIB_NAME,
  MAX_SIZE,
  FPDF_ANNOT,
  FPDF_LCD_TEXT,
  FPDF_NO_NATIVETEXT,
  FPDF_GRAYSCALE,
  FPDF_REVERSE_BYTE_ORDER,
  FPDF_RENDER_LIMITEDIMAGECACHE,
  FPDF_RENDER_FORCEHALFTONE,
  FPDF_PRINTING,
  DEFAULT_RENDER_FLAGS,
  DEFAULT_BACKGROUND_COLOR,
  FPDF_PAGEOBJ_UNKNOWN,
  FPDF_PAGEOBJ_TEXT,
  FPDF_PAGEOBJ_PATH,
  FPDF_PAGEOBJ_IMAGE,
  FPDF_PAGEOBJ_SHADING,
  FPDF_PAGEOBJ_FORM,
  FPDF_SEGMENT_UNKNOWN,
  FPDF_SEGMENT_LINETO,
  FPDF_SEGMENT_BEZIERTO,
  FPDF_SEGMENT_MOVETO,
  FLAT_NORMALDISPLAY,
  FLAT_PRINT,
  FLATTEN_FAIL,
  FLATTEN_SUCCESS,
  FLATTEN_NOTHINGTODO,
  FPDF_INCREMENTAL,
  FPDF_NO_INCREMENTAL,
  FPDF_REMOVE_SECURITY,
  FPDF_ERR_SUCCESS,
  FPDF_ERR_UNKNOWN,
  FPDF_ERR_FILE,
  FPDF_ERR_FORMAT,
  FPDF_ERR_PASSWORD,
  FPDF_ERR_SECURITY,
  FPDF_ERR_PAGE,
  PDFIUM_ERRORS,
  errorMessage,
  checkLastError,
  initializeLibrary,
  cleanupLibrary,
  encodePngRgba,
  Document,
  Page,
  PdfiumError
};

export default Pdfium;
