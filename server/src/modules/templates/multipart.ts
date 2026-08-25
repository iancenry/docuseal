import type { IncomingMessage } from 'node:http';
import formidable from 'formidable';

export type { FormidableFile, FormidableFields, FormidableFiles } from 'formidable';

export type MultipartResult = {
  fields: import('formidable').FormidableFields;
  files: import('formidable').FormidableFiles;
};

export async function parseMultipart(
  req: IncomingMessage,
  maxFileSize: number,
): Promise<MultipartResult> {
  const form = formidable({ multiples: true, maxFileSize });
  const [fields, files] = await form.parse(req);
  return { fields, files };
}
