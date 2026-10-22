declare module "elkjs/lib/elk.bundled.js" {
  export interface ElkLayoutedNode {
    id: string;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    children?: ElkLayoutedNode[];
  }

  export interface ElkLayoutedGraph {
    id?: string;
    children?: ElkLayoutedNode[];
    edges?: unknown[];
  }

  export default class ELK {
    constructor(options?: Record<string, unknown>);
    layout(
      graph: unknown,
      options?: Record<string, unknown>,
    ): Promise<ElkLayoutedGraph>;
  }
}
