// biome-ignore-all lint/suspicious/noExplicitAny: This file defines global types for untyped external libraries and internal global state.
export {};

declare global {
  const io: any;
  const turnstile: any;
  var Tools: import("../types/app-runtime").AppToolsState & {
    [name: string]: any;
  };
  function messageForTool(
    message: import("../types/app-runtime").BoardMessage,
  ): void;
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
  const WBOMessageCommon: typeof import("../client-data/js/message_common.js");
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
    WBOMessageCommon: typeof import("../client-data/js/message_common.js");
    Tools: typeof Tools;
    messageForTool: typeof messageForTool;
    WBOBoardPageState: typeof import("../client-data/js/board_page_state.js");
    WBOBoardTransport: typeof import("../client-data/js/board_transport.js");
    WBOBoardState: typeof import("../client-data/js/board_page_state.js")["state"];
    WBOBoardMessages: typeof import("../client-data/js/board_transport.js")["messages"];
    WBOBoardConnection: typeof import("../client-data/js/board_transport.js")["connection"];
    WBOBoardTurnstile: typeof import("../client-data/js/board_transport.js")["turnstile"];
    WBOBoardTools: typeof import("../client-data/js/board_page_state.js")["tools"];
    WBOBoardBootstrap: typeof import("../client-data/js/board_page_state.js")["bootstrap"];
    socketio_extra_headers?: Record<string, string>;
    __downloadCapture?: any;
    __downloadAnchorClicks?: any;
    __downloadBlob?: any;
    __lastAlert?: any;
    __receivedBroadcasts?: any[];
    __turnstileOptions?: any;
    turnstile?: any;
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
