declare module 'formidable' {
  import type { IncomingMessage } from 'node:http';

  export interface FormidableFile {
    filepath: string;
    originalFilename: string;
    newFilename: string;
    mimetype: string | null;
    size: number;
    mtimeMs: number;
    hash?: string | null;
    toJSON(): Record<string, unknown>;
  }

  export type FormidableFields = Record<string, string | string[] | undefined>;
  export type FormidableFiles = Record<string, FormidableFile | FormidableFile[] | undefined>;

  export interface FormidableOptions {
    multiples?: boolean;
    maxFileSize?: number;
    allowEmptyFiles?: boolean;
    minFileSize?: number;
  }

  export interface FormidableInstance {
    parse(req: IncomingMessage): Promise<[FormidableFields, FormidableFiles]>;
  }

  export default function formidable(options?: FormidableOptions): FormidableInstance;
}
