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

export declare function main(): void;
