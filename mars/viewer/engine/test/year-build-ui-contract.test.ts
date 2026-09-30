import { test } from 'node:test';
import assert from 'node:assert/strict';
import { yearBuild, yearBuildHouse } from '../../app/lab/year-build.ts';

// The selector renders before the asynchronous campus file is available.
// A missing scene must not crash ordinary fresh loads or unrelated presets.
test('year-build choices remain readable before asynchronous scene preparation', () => {
  assert.match(yearBuild.title, /first bay/);
  assert.match(yearBuildHouse.title, /whole house/);
  assert.doesNotThrow(() => yearBuild.description);
  assert.doesNotThrow(() => yearBuildHouse.description);
});
