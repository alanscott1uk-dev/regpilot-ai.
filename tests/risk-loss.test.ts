import test from "node:test";
import assert from "node:assert/strict";
import {casesSchema,quantifyLoss} from "../lib/risk-loss";

const fixed = {eventsPerYear:1,low:1000,likely:1000,high:1000};
test("GBP scenarios reproduce analytic means and the known percentiles of a unit-rate Poisson loss",()=>{
  const value=quantifyLoss({before:fixed,after:{...fixed,eventsPerYear:0.5}});
  assert.equal(value.before.expected,1000);assert.equal(value.before.median,1000);assert.equal(value.before.p90,2000);
  assert.equal(value.after?.expected,500);assert.equal(value.expectedReduction,500);
  assert.ok(Math.abs(value.before.eventProbability-0.6321205588)<1e-9);
  assert.deepEqual(value,quantifyLoss({before:fixed,after:{...fixed,eventsPerYear:0.5}}));
});

test("rare events, triangular ranges and a treatment that increases loss retain their meaning",()=>{
  const zero = quantifyLoss({before:{...fixed,eventsPerYear:0},after:null});
  assert.deepEqual(zero.before,{expected:0,median:0,p90:0,eventProbability:0});assert.equal(zero.expectedReduction,null);
  const rare=quantifyLoss({before:{...fixed,eventsPerYear:0.02},after:fixed});
  assert.equal(rare.before.expected,20);assert.equal(rare.before.p90,0);assert.equal(rare.expectedReduction,-980);
  const range={eventsPerYear:2,low:0,likely:1000,high:5000};
  const paired=quantifyLoss({before:range,after:range});
  assert.equal(paired.before.expected,4000);assert.deepEqual(paired.before,paired.after);
  const max=quantifyLoss({before:{eventsPerYear:50,low:1e9,likely:1e9,high:1e9},after:null});
  assert.equal(max.before.expected,50e9);assert.ok(max.before.p90>max.before.median);
});

test("out-of-order severities, invalid rates and unsafe amounts are rejected",()=>{
  for (const values of [{eventsPerYear:-1},{eventsPerYear:51},{eventsPerYear:NaN},{low:2000},{high:3},{likely:0.5},{high:Infinity},{high:1e9+1}]) {
    assert.equal(casesSchema.safeParse({before:{...fixed,...values},after:null}).success,false);
  }
});
