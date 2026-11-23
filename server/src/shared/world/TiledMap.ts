export interface TiledMap {
  width: number;
  height: number;
  tilewidth: number;
  tileheight: number;
  layers: TiledLayer[];
  tilesets: TiledTileset[];
}

export interface TiledLayer {
  id?: number;

  name: string;
  type: "tilelayer" | "objectgroup";

  data?: number[];
  objects?: TiledObject[];

  width?: number;
  height?: number;

  x?: number;
  y?: number;

  visible?: boolean;
  opacity?: number;

  draworder?: string;

  properties?: TiledLayerProperty[];
}

export interface TiledLayerProperty {
  name: string;
  type: string;
  value: unknown;
}

export interface TiledObject {
  id: number;
  name: string;
  type: string;

  x: number;
  y: number;

  width: number;
  height: number;

  rotation?: number;
  visible?: boolean;
  point?: boolean;

  properties?: {
    name: string;
    type: string;
    value: unknown;
  }[];
}

export interface TiledExternalTileset {
  firstgid: number;
  source: string;
}

export interface TiledEmbeddedTileset {
  firstgid: number;
  name: string;

  tilewidth: number;
  tileheight: number;

  tilecount: number;
  columns: number;

  image?: string;
  imagewidth?: number;
  imageheight?: number;

  spacing?: number;
  margin?: number;
}

export type TiledTileset = TiledExternalTileset;
