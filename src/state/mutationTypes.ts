import type { Markup } from '../model/document';
import type { ToolType } from './appState';

/** All possible mutations for the event-driven architecture. */
export type MutationKind =
  | 'ADD_MARKUP'
  | 'UPDATE_STYLE'
  | 'REPOSITION'
  | 'REMOVE_MARKUPS'
  | 'DUPLICATE_MARKUPS'
  | 'TOGGLE_SELECT'
  | 'SET_SELECTION'
  | 'TOGGLE_TOOL'
  | 'CHANGE_PAGE'
  | 'LOAD_PROJECT_DATA'
  | 'UNDO'
  | 'REDO'
  | 'REBUILD_MARKUP_LAYER';

/** Payload for adding a new markup node to the canvas */
export interface AddMarkupPayload {
  markup: Markup;
  pageIndex?: number;
}

/** Payload for updating style properties on one or more markups */
export interface UpdateStylePayload {
  id: string;
  partialStyle: Partial<Markup['style']>;
}

/** Payload for moving selected markup nodes by a delta offset */
export interface RepositionPayload {
  ids: string[];
  dx: number;
  dy: number;
  snapToGrid?: boolean;
}

/** Payload for removing one or more markup nodes from the document */
export interface RemoveMarkupsPayload {
  ids: string[];
}

/** Payload for duplicating selected markup nodes with an offset */
export interface DuplicateMarkupsPayload {
  ids: string[];
}

/** Payload for toggling the selection state of a single markup node */
export interface ToggleSelectPayload {
  id: string;
}

/** Payload for setting an explicit selection (clears previous, replaces) */
export interface SetSelectionPayload {
  ids: string | string[] | null;
}

/** Payload for switching the active drawing/selection tool */
export interface ToggleToolPayload {
  tool: ToolType;
}

/** Payload for navigating to a different PDF page */
export interface ChangePagePayload {
  index: number;
}

/**
 * Payload for loading project data into state.
 * SPECIAL: This mutation bypasses all hooks during data loading
 * (no undo snapshot, no canvas sync) to avoid redundant work while
 * restoring a previously-saved project or opening a new file.
 */
export interface LoadProjectDataPayload {
  projectData: import('../model/document').ProjectData;
  pdfBytes?: Uint8Array;
}

/** Payload-less — triggers undo via handler directly */
export type UndoPayload = {};

/** Payload-less — triggers redo via handler directly */
export type RedoPayload = {};

/** Payload-less — clears markup layer and re-adds from current page state */
export type RebuildMarkupLayerPayload = {};

/** Union of all mutation payloads, keyed by MutationKind */
export type MutationPayloadMap = {
  ADD_MARKUP: AddMarkupPayload;
  UPDATE_STYLE: UpdateStylePayload;
  REPOSITION: RepositionPayload;
  REMOVE_MARKUPS: RemoveMarkupsPayload;
  DUPLICATE_MARKUPS: DuplicateMarkupsPayload;
  TOGGLE_SELECT: ToggleSelectPayload;
  SET_SELECTION: SetSelectionPayload;
  TOGGLE_TOOL: ToggleToolPayload;
  CHANGE_PAGE: ChangePagePayload;
  LOAD_PROJECT_DATA: LoadProjectDataPayload;
  UNDO: UndoPayload;
  REDO: RedoPayload;
  REBUILD_MARKUP_LAYER: RebuildMarkupLayerPayload;
};

/** Utility type to extract payload by mutation kind */
export type PayloadFor<TKind extends MutationKind> = MutationPayloadMap[TKind];
