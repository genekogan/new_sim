import test from 'node:test';
import assert from 'node:assert/strict';
import { readingRigFixture, bookThighContacts, THREE } from './rig-fixture.mjs';

test('actual three resident rigs hold the open book clear of deformed thighs throughout seated reading', { timeout: 90_000 }, async () => {
  const { templates, views, idFor } = await readingRigFixture();
  const report = []; let collisions = 0;
  for (const template of templates) for (const seatHeight of [.04, .47, .7]) for (const seconds of [0, 7.3, 30, 120]) {
    const id = idFor(template.name);
    views.setFrame([{ id, p: [0, 0, 0], yaw: .3, walk: 0, walkDist: 0, activityAge: seconds, activity: 'read', baseActivity: seatHeight === .04 ? 'sit-ground' : 'sit', seatHeight }], seconds);
    views.render(1);
    const holder = views.group.getObjectByName(id), book = holder.getObjectByName('activity prop: book');
    const stats = bookThighContacts(holder);
    assert.ok(stats.thighTriangles > 100, 'actual deformed leg geometry tested');
    collisions += stats.intersections;
    if (!process.env.EXPECT_BOOK_INTERSECTION) assert.equal(stats.intersections, 0, `${template.name} seat ${seatHeight} time ${seconds}: ${JSON.stringify(stats)}`);
    // Honest hands remain at the book's centre, rather than a detached prop independently lifted after IK.
    const palms = ['WristL', 'WristR'].map(name => holder.getObjectByName(name)?.getWorldPosition(new THREE.Vector3()));
    const centre = book.getWorldPosition(new THREE.Vector3());
    assert.ok(palms.every(Boolean));
    assert.ok(centre.distanceTo(palms[0].clone().add(palms[1]).multiplyScalar(.5)) < .16, 'book held between real hands');
    assert.ok(book.visible && [...book.matrixWorld.elements].every(Number.isFinite));
    report.push({ rig: template.name, seatHeight, seconds, ...stats });
  }
  if (process.env.EXPECT_BOOK_INTERSECTION) assert.ok(collisions > 0, 'pinned baseline must reproduce actual thigh/page contact');
  console.log(JSON.stringify({ schema: 'reading-rig-clearance/1', samples: report.length, report }));
});
