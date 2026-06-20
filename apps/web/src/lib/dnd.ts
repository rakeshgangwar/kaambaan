import {
  draggable,
  dropTargetForElements,
} from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import type { Action } from 'svelte/action';

/** Make a card element draggable, carrying its id as drag data (Atlassian pragmatic-drag-and-drop). */
export const cardDraggable: Action<HTMLElement, { cardId: string }> = (node, params) => {
  let current = params;
  const cleanup = draggable({
    element: node,
    getInitialData: () => ({ cardId: current.cardId }),
    onDragStart: () => node.classList.add('opacity-50'),
    onDrop: () => node.classList.remove('opacity-50'),
  });
  return {
    update(next) {
      current = next;
    },
    destroy() {
      cleanup();
    },
  };
};

export interface DropColumnParams {
  stageKey: string;
  onDrop: (cardId: string) => void;
  onOver?: (isOver: boolean) => void;
}

/** Make a column a drop target; calls `onDrop(cardId)` when a card is released over it. */
export const columnDropTarget: Action<HTMLElement, DropColumnParams> = (node, params) => {
  let current = params;
  const cleanup = dropTargetForElements({
    element: node,
    getData: () => ({ stageKey: current.stageKey }),
    onDragEnter: () => current.onOver?.(true),
    onDragLeave: () => current.onOver?.(false),
    onDrop: ({ source }) => {
      current.onOver?.(false);
      const cardId = source.data.cardId;
      if (typeof cardId === 'string') current.onDrop(cardId);
    },
  });
  return {
    update(next) {
      current = next;
    },
    destroy() {
      cleanup();
    },
  };
};
