import assert from "node:assert/strict";
import test from "node:test";
import { routePrompt } from "../hotseat/main.js";

const X={OcgMessageType:{SELECT_CHAIN:1,SELECT_CARD:2,SELECT_PLACE:3}};
const autoKinds=new Set([X.OcgMessageType.SELECT_PLACE]);
const pass={type:1,index:null};

test("no-choice opponent window does not hand off",()=>{
  const q={type:1,player:1,selects:[]};
  assert.deepEqual(routePrompt(q,0,X,()=>pass,autoKinds,()=>null),
    {automatic:pass,handoffTo:null});
});

test("real opponent response does hand off, even on the current player's turn",()=>{
  const q={type:1,player:1,selects:[{code:42}]};
  assert.deepEqual(routePrompt(q,0,X,()=>null,autoKinds,()=>null),
    {automatic:null,handoffTo:1});
});

test("automatic placement does not hand off",()=>{
  const q={type:3,player:1};
  assert.deepEqual(routePrompt(q,0,X,()=>null,autoKinds,()=>pass),
    {automatic:pass,handoffTo:null});
});

test("opponent-hand selection stays visible to the deciding player",()=>{
  const q={type:2,player:1,selects:[{location:2,controller:0}]};
  assert.deepEqual(routePrompt(q,0,X,()=>pass,autoKinds,()=>null),
    {automatic:null,handoffTo:1});
});
