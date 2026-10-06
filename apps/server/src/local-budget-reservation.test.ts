import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from '../test/native-owner-fixture.ts';
test('explicit local ceiling reaches durable reservations while ordinary/default gates retain one and actual configured budget',t=>{
 const f=fixture(':memory:');t.after(()=>{f.brain.quiesce();f.host.stop();f.db.close();});f.brain.cfg.budgetUsdPerDay=3;f.brain.budget=3;assert.equal(f.brain.budget,1);assert.throws(()=>f.brain.paidGate(1.1,'synthetic-local-budget'),/budget/);
 f.brain.enableLocalBudgetV1();assert.equal(f.brain.budget,3);const reservation=f.brain.paidGate(2.5,'synthetic-local-budget');assert.equal(f.db.paidCost(),2.5);assert.throws(()=>f.brain.paidGate(.6,'synthetic-local-budget'),/budget/);reservation.settle(0);assert.equal(f.db.paidCost(),0);
 assert.throws(()=>f.db.reserveCost(1.1,'synthetic-default-budget',3),/budget/);f.brain.budget=.4;assert.throws(()=>f.brain.paidGate(.5,'synthetic-local-budget'),/budget/);
});
test('a non-loopback configuration cannot select the local ceiling',t=>{const f=fixture(':memory:');t.after(()=>{f.brain.quiesce();f.host.stop();f.db.close();});f.brain.cfg.publicUrl='https://sim.example/w/eden';assert.throws(()=>f.brain.enableLocalBudgetV1(),/loopback-required/);f.brain.budget=3;assert.equal(f.brain.budget,1);assert.throws(()=>f.brain.paidGate(1.1,'synthetic-budget'),/budget/);assert.equal(f.db.paidCost(),0);});

test('invalid bounds cannot reserve and settlement preserves uncertain holds and actual over-bound charges',t=>{
 const f=fixture(':memory:');t.after(()=>{f.brain.quiesce();f.host.stop();f.db.close();});
 for(const bound of [-1,NaN,Infinity])assert.throws(()=>f.db.reserveCost(bound,'synthetic-invalid',3,Date.now(),3),/budget/);assert.equal(f.db.paidCost(),0);assert.throws(()=>f.db.reserveCost(.1,'synthetic-invalid-ceiling',3,Date.now(),4 as any),/budget/);assert.equal(f.db.paidCost(),0);
 f.db.reserveCost(.5,'synthetic-uncertain',3,Date.now(),3);const actual=f.db.reserveCost(.8,'synthetic-actual',3,Date.now(),3);assert.ok(Math.abs(f.db.paidCost()-1.3)<1e-9);assert.throws(()=>actual.settle(.9),/exceeded its admission bound/);assert.ok(Math.abs(f.db.paidCost()-1.4)<1e-9);assert.throws(()=>f.db.reserveCost(1.7,'synthetic-next',3,Date.now(),3),/budget/);assert.ok(Math.abs(f.db.paidCost()-1.4)<1e-9);assert.equal(Number((f.db.db.prepare('SELECT COUNT(*) n FROM paid_costs WHERE settled=0').get() as any).n),1);
});
