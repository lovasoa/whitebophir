import { getMutationType, MutationType } from "../js/message_tool_metadata.js";

/** @typedef {import("../../types/app-runtime").ToolBootContext} ToolBootContext */

/**
 * @param {{
 *   contract: import("./shape_contract.js").ToolContract & {liveCreateType?: string, storedTagName: string},
 *   shortcut: string,
 *   icon: string,
 *   stylesheet: string,
 *   mouseCursor?: string,
 *   secondary?: {name: string, icon: string, active: boolean, switch?: () => void},
 *   uidPrefix: string,
 *   isShapeElement: (element: Element | null) => boolean,
 *   makeCreateMessage: (tool: any, id: string, x: number, y: number) => any,
 *   makeUpdateMessage: (tool: any, x: number, y: number, evt: any) => any,
 *   makeFallbackShape: (update: any) => any,
 *   applyShapeGeometry: (shape: SVGElement, data: any) => void,
 * }} options
 */
export function createShapeToolClass(options) {
  return class ShapeTool {
    static toolName = options.contract.toolName;
    static contract = options.contract;

    /**
     * @param {any} Tools
     */
    constructor(Tools) {
      this.Tools = Tools;
      this.currentShape = null;
      this.lastTime = performance.now();
      this.name = options.contract.toolName;
      this.shortcut = options.shortcut;
      this.secondary = options.secondary || null;
      if (this.secondary?.switch) {
        const switchShape = this.secondary.switch;
        this.secondary.switch = () => switchShape.call(this);
      }
      this.mouseCursor = options.mouseCursor || "crosshair";
      this.icon = options.icon;
      this.stylesheet = options.stylesheet;
    }

    /**
     * @param {number} x
     * @param {number} y
     * @param {MouseEvent | TouchEvent} evt
     */
    press(x, y, evt) {
      evt.preventDefault();
      const id = this.Tools.generateUID(options.uidPrefix);
      this.currentShape = options.makeCreateMessage(this, id, x, y);
      this.Tools.drawAndSend(this.currentShape, this);
    }

    /**
     * @param {number} x
     * @param {number} y
     * @param {MouseEvent | TouchEvent | undefined} evt
     * @param {boolean} [force]
     */
    move(x, y, evt, force = false) {
      if (!this.currentShape) {
        if (evt) evt.preventDefault();
        return;
      }
      const update = options.makeUpdateMessage(this, x, y, evt);
      if (!update) return;
      if (performance.now() - this.lastTime > 70 || force) {
        this.Tools.drawAndSend(update, this);
        this.lastTime = performance.now();
      } else {
        this.draw(update);
      }
      if (evt) evt.preventDefault();
    }

    /**
     * @param {number} x
     * @param {number} y
     */
    release(x, y) {
      this.move(x, y, undefined, true);
      this.currentShape = null;
    }

    /**
     * @param {any} data
     */
    draw(data) {
      this.Tools.drawingEvent = true;
      if (data.type === options.contract.liveCreateType) {
        this.createShape(data);
        return;
      }
      if (getMutationType(data) === MutationType.UPDATE) {
        const svg = this.Tools.svg;
        let shape = svg.getElementById(data.id);
        if (!options.isShapeElement(shape)) {
          shape = this.createShape(options.makeFallbackShape(data));
        }
        options.applyShapeGeometry(shape, data);
        return;
      }
      console.error(
        `${options.contract.toolName}: Draw instruction with unknown type. `,
        data,
      );
    }

    /**
     * @param {any} data
     * @returns {SVGElement}
     */
    createShape(data) {
      const existingShape = this.Tools.svg.getElementById(data.id);
      const shape = options.isShapeElement(existingShape)
        ? existingShape
        : this.Tools.createSVGElement(options.contract.storedTagName);
      shape.id = data.id;
      options.applyShapeGeometry(shape, data);
      shape.setAttribute("stroke", data.color || "black");
      shape.setAttribute("stroke-width", String(data.size || 10));
      shape.setAttribute(
        "opacity",
        String(Math.max(0.1, Math.min(1, data.opacity || 1))),
      );
      if (!this.Tools.drawingArea) {
        throw new Error(`${options.contract.toolName}: Missing drawing area.`);
      }
      if (shape.parentNode !== this.Tools.drawingArea) {
        this.Tools.drawingArea.appendChild(shape);
      }
      return shape;
    }

    /**
     * @param {ToolBootContext} ctx
     * @returns {Promise<any>}
     */
    static async boot(ctx) {
      return new ShapeTool(ctx.runtime.Tools);
    }
  };
}
