export {};

declare global {
  type WboPathDataSegment = { type: string; values: number[] };
  type SelectionButtonElement = SVGImageElement & {
    origWidth: number;
    origHeight: number;
    drawCallback: SelectionButtonDrawCallback;
    clickCallback: SelectionButtonClickCallback;
  };
  type SelectionButtonDrawCallback = (
    button: SelectionButtonElement,
    bbox: TransformedBBox,
    scale: number,
  ) => void;
  type SelectionButtonClickCallback = (
    x: number,
    y: number,
    evt: { preventDefault(): void },
  ) => void;

  const io: {
    connect(
      path: string,
      params: import("../types/app-runtime").SocketParams,
    ): import("../types/app-runtime").AppSocket;
  };
  const turnstile: import("../types/app-runtime").TurnstileGlobal;
  type TransformedBBox = {
    r: [number, number];
    a: [number, number];
    b: [number, number];
  };
  var pointInTransformedBBox: (
    point: [number, number],
    bbox: TransformedBBox,
  ) => boolean;
  var transformedBBoxIntersects: (
    left: TransformedBBox,
    right: TransformedBBox,
  ) => boolean;

  interface Window {
    WBOApp: import("../types/app-runtime").AppToolsState;
    WBOBoardState: {
      normalizeBoardState: typeof import("../client-data/js/board_page_state.js")["normalizeBoardState"];
    };
    socketio_extra_headers?: import("../types/app-runtime").SocketHeaders;
    __downloadCapture?: import("../types/app-runtime").DownloadCapture | null;
    __downloadAnchorClicks?: number;
    __downloadBlob?: Blob;
    __lastAlert?: string | null;
    __receivedBroadcasts?: import("../types/app-runtime").BoardMessage[];
    __turnstileOptions?:
      | import("../types/app-runtime").TurnstileRenderOptions
      | null;
    turnstile?: import("../types/app-runtime").TurnstileGlobal;
  }

  interface HTMLElement {
    text?: string;
  }

  interface SVGPathElement {
    getPathData(options?: { normalize?: boolean }): WboPathDataSegment[];
    setPathData(pathData: WboPathDataSegment[]): void;
  }

  interface SVGRectElement {
    getPathData(options?: { normalize?: boolean }): WboPathDataSegment[];
  }

  interface SVGCircleElement {
    getPathData(options?: { normalize?: boolean }): WboPathDataSegment[];
  }

  interface SVGEllipseElement {
    getPathData(options?: { normalize?: boolean }): WboPathDataSegment[];
  }

  interface SVGLineElement {
    getPathData(options?: { normalize?: boolean }): WboPathDataSegment[];
  }

  interface SVGPolylineElement {
    getPathData(options?: { normalize?: boolean }): WboPathDataSegment[];
  }

  interface SVGPolygonElement {
    getPathData(options?: { normalize?: boolean }): WboPathDataSegment[];
  }

  interface SVGGraphicsElement {
    origWidth?: number;
    origHeight?: number;
    drawCallback?: SelectionButtonDrawCallback;
    clickCallback?: SelectionButtonClickCallback;
    transformedBBox(scale?: number): TransformedBBox;
    transformedBBoxContains(x: number, y: number): boolean;
    transformedBBoxIntersects(bbox: TransformedBBox): boolean;
  }

  interface SVGSVGElement {
    transformedBBox(scale?: number): TransformedBBox;
  }
}
