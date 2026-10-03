/// <reference types="node" />
import { test, expect } from '@playwright/test';
import { ComponentViews } from '../app/engine-view/components.ts';
import { readingCircleWorld } from '../engine/scenarios/reading-circle.ts';

test('a stationary supported book retains exact rendered bounds at every interpolation alpha', () => {
  for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    const world = readingCircleWorld(yaw);
    const original = JSON.stringify(world);
    const views = new ComponentViews();
    try {
      views.onTick(world);
      views.render(1);
      const bounds = views.bounds('book');
      expect(bounds).not.toBeNull();
      for (const alpha of [0, 0.17, 0.41, 0.88, 1]) {
        views.onTick(world);
        views.render(alpha);
        expect(views.bounds('book')).toEqual(bounds);
      }
      expect(JSON.stringify(world)).toBe(original);
    } finally {
      views.dispose();
    }
  }
});

test('reading expression changes visible bounds while book origin, orientation and support remain exact', () => {
  for (const yaw of [0, Math.PI / 2]) {
    const world = readingCircleWorld(yaw),
      book = world.entities.book;
    const physical = JSON.stringify({ pose: book.pose, support: book.support });
    const views = new ComponentViews();
    try {
      views.onTick(world);
      views.render(1);
      const object = views.group.children.find((o) => o.name === 'book')!;
      const origin = object.position.toArray(),
        orientation = object.quaternion.toArray();
      const initial = views.bounds('book');
      const bounds = [];
      for (const elapsed of [5.25, 11.85, 12]) {
        book.equipment = {
          kind: 'reading',
          config: {
            readSeconds: elapsed,
            durationSeconds: 12,
            phase: 'reading',
          },
        };
        views.onTick(world);
        views.render(1);
        bounds.push(views.bounds('book'));
        expect(object.position.toArray()).toEqual(origin);
        expect(object.quaternion.toArray()).toEqual(orientation);
        expect(JSON.stringify({ pose: book.pose, support: book.support })).toBe(
          physical,
        );
      }
      // The page-turn expression is visible; frozen whole-mesh bounds are not
      // a supported reading guarantee. Authority and the mesh root stay fixed.
      expect(
        bounds.some((b) => JSON.stringify(b) !== JSON.stringify(initial)),
      ).toBe(true);
    } finally {
      views.dispose();
    }
  }
});
