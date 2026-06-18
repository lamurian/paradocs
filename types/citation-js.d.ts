declare module "@citation-js/core" {
  export class Cite {
    static async: (input: string) => Promise<Cite>;
    format: (formatName: string, options?: Record<string, unknown>) => string;
    data: CSLData[];
  }

  export interface CSLData {
    author?: { family: string; given: string; sequence?: string }[];
    issued?: { "date-parts": number[][] };
    DOI?: string;
    URL?: string;
    title?: string;
    [key: string]: unknown;
  }

  export const plugins: {
    add: (name: string, config: unknown) => void;
    config: {
      get: () => Record<string, unknown>;
    };
  };
}

declare module "@citation-js/plugin-doi" {
  // Side-effect plugin — no exports needed
}

declare module "@citation-js/plugin-bibtex" {
  // Side-effect plugin — no exports needed
}

declare module "@citation-js/plugin-url" {
  // Side-effect plugin — no exports needed
}
