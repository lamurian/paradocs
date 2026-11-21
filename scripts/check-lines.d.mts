export declare const SOURCE_DIRS: string[];

export interface CheckFileResult {
  file: string;
  lineCount: number;
  overLimit: boolean;
}

export declare function checkFile(
  filePath: string,
  maxLines?: number,
): CheckFileResult;

export declare function checkDirectory(
  dir: string,
  maxLines?: number,
): CheckFileResult[];

export declare function filterStagedFiles(
  files: string[],
  dirs?: string[],
): string[];

export declare function main(): void;
