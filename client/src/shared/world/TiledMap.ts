export interface TiledMap {
  width: number;
  height: number;
  tilewidth: number;
  tileheight: number;
  layers: TiledLayer[];
  tilesets: TiledTileset[];
}

export interface TiledLayer {
  name: string;
  type: "tilelayer" | "objectgroup";
  data?: number[]; // Present if type === "tilelayer"
  objects?: TiledObject[]; // Present if type === "objectgroup"
  width?: number;
  height?: number;
  visible?: boolean;
  opacity?: number;
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
  type: string; // e.g., "spawn_area", "interact_chest"
  x: number;
  y: number;
  width: number;
  height: number;
  properties?: { name: string; type: string; value: unknown }[];
}

export interface TiledTileset {
  columns: number;
  spacing: number;
  tileheight: number;
  tilewidth: number;
  tilecount: number;
  firstgid: number;
  source: string;
  imageheight: number;
  imagewidth: number;
}
