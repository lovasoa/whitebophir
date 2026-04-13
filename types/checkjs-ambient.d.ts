export {};

declare global {
  const io: any;
  const turnstile: any;
  var Minitpl: any;
  const WBOMessageCommon: any;
  const wboPencilPoint: any;
  var pointInTransformedBBox: any;
  var transformedBBoxIntersects: any;
  var bbox: any;
  var tmatrix: any;

  interface Window {
    WBOMessageCommon: any;
    WBOBoardPageState: any;
    WBOBoardTransport: any;
    WBOBoardState: any;
    WBOBoardMessages: any;
    WBOBoardConnection: any;
    WBOBoardTurnstile: any;
    WBOBoardTools: any;
    WBOBoardBootstrap: any;
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
    transformedBBox(scale?: number): any;
    transformedBBoxContains(x: number, y: number): boolean;
    transformedBBoxIntersects(bbox: any): boolean;
  }
}
