export {};

declare global {
  const io: any;
  const turnstile: any;
  var Minitpl: any;
  const WBOMessageCommon: any;
  const wboPencilPoint: any;
  var fetch: any;
  var pointInTransformedBBox: any;
  var transformedBBoxIntersects: any;
  var bbox: any;
  var tmatrix: any;

  interface Window {
    WBOMessageCommon: any;
    WBOBoardState: any;
    WBOBoardMessages: any;
    WBOBoardConnection: any;
    WBOBoardTurnstile: any;
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

  interface EventTarget {
    matches?(selectors: string): boolean;
  }

  interface Event {
    pageX?: number;
    pageY?: number;
    shiftKey?: boolean;
  }

  interface Element {
    blur?(): void;
    src?: string;
    type?: any;
    style: any;
    width: any;
    height: any;
    x: any;
    y: any;
    origWidth?: number;
    origHeight?: number;
    drawCallback?: any;
    clickCallback?: any;
    transformedBBox?(scale?: number): any;
    transformedBBoxContains?(x: number, y: number): boolean;
    transformedBBoxIntersects?(bbox: any): boolean;
    setAttribute(qualifiedName: string, value: any): void;
    setAttributeNS(namespace: string | null, qualifiedName: string, value: any): void;
  }

  interface HTMLElement {
    text: string;
    value: any;
    width: any;
    height: any;
    x: any;
    y: any;
    getElementById(id: string): any;
    createSVGMatrix(): any;
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
    transformedBBox(scale?: number): any;
    transformedBBoxContains(x: number, y: number): boolean;
    transformedBBoxIntersects(bbox: any): boolean;
  }

  interface SVGSVGElement {
    transformedBBox(scale?: number): any;
  }

  interface Node {
    removeAttribute?(qualifiedName: string): void;
    outerHTML?: string;
  }
}
