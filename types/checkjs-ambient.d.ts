// biome-ignore-all lint/suspicious/noExplicitAny: This file defines global types for untyped external libraries and internal global state.
export {};

declare global {
  const io: any;
  const turnstile: import("../types/app-runtime").TurnstileGlobal;
  var Tools: import("../types/app-runtime").AppToolsState;
  type TransformedBBox = {
    r: [number, number];
    a: [number, number];
    b: [number, number];
  };
  var Minitpl: {
    new (
      elem: string | Element,
    ): {
      elem: Element;
      parent: ParentNode;
      add(
        data:
          | string
          | ((element: Element) => void)
          | { [selector: string]: string | ((element: Element) => void) },
      ): Element;
    };
  };
  const wboPencilPoint: any;
  var pointInTransformedBBox: (
    point: [number, number],
    bbox: TransformedBBox,
  ) => boolean;
  var transformedBBoxIntersects: (
    left: TransformedBBox,
    right: TransformedBBox,
  ) => boolean;

  interface Window {
    Tools: typeof Tools;
    WBOBoardState: {
      normalizeBoardState: typeof import("../client-data/js/board_page_state.js")["normalizeBoardState"];
      parseBoardStateText: typeof import("../client-data/js/board_page_state.js")["parseBoardStateText"];
    };
    socketio_extra_headers?: import("../types/app-runtime").SocketHeaders;
    __downloadCapture?: import("../types/app-runtime").DownloadCapture | null;
    __downloadAnchorClicks?: number;
    __downloadBlob?: Blob;
    __lastAlert?: any;
    __receivedBroadcasts?: import("../types/app-runtime").BoardMessage[];
    __turnstileOptions?:
      | import("../types/app-runtime").TurnstileRenderOptions
      | null;
    turnstile?: import("../types/app-runtime").TurnstileGlobal;
  }

  interface Navigator {
    msSaveBlob?: (blob: Blob, defaultName?: string) => boolean;
  }

  interface HTMLElement {
    text?: string;
  }

  interface SVGPathElement {
    getPathData(options?: { normalize?: boolean }): any[];
    setPathData(pathData: any[]): void;
  }

  interface SVGRectElement {
    getPathData(options?: { normalize?: boolean }): any[];
  }

  interface SVGCircleElement {
    getPathData(options?: { normalize?: boolean }): any[];
  }

  interface SVGEllipseElement {
    getPathData(options?: { normalize?: boolean }): any[];
  }

  interface SVGLineElement {
    getPathData(options?: { normalize?: boolean }): any[];
  }

  interface SVGPolylineElement {
    getPathData(options?: { normalize?: boolean }): any[];
  }

  interface SVGPolygonElement {
    getPathData(options?: { normalize?: boolean }): any[];
  }

  interface SVGGraphicsElement {
    origWidth?: number;
    origHeight?: number;
    drawCallback?: any;
    clickCallback?: any;
    transformedBBox(scale?: number): TransformedBBox;
    transformedBBoxContains(x: number, y: number): boolean;
    transformedBBoxIntersects(bbox: TransformedBBox): boolean;
  }

  interface SVGSVGElement {
    transformedBBox(scale?: number): TransformedBBox;
  }
}
