import test from "node:test";
import assert from "node:assert/strict";
import { detectIdentityBounds } from "../src/features/enrollments/identityEdges.ts";

function sample(rect) {
  const width=400,height=600,data=new Uint8ClampedArray(width*height*4).fill(255);
  const paint=(x,y,value)=>{const i=(y*width+x)*4;data[i]=data[i+1]=data[i+2]=value;data[i+3]=255;};
  if (rect) {
    for(let y=rect.y;y<rect.y+rect.h;y++)for(let x=rect.x;x<rect.x+rect.w;x++)paint(x,y,185);
    for(let y=0;y<height;y++)paint(1,y,0);
  }
  return {width,height,data};
}
test("detects card edges while ignoring the page border",()=>{
  const box=detectIdentityBounds(sample({x:65,y:75,w:180,h:110}));
  assert(box.left>3 && box.left<=16);
  assert(box.top<=12 && box.right>=61 && box.bottom>=30);
  assert(box.right<80 && box.bottom<45);
});
test("leaves blank scans unaltered",()=>{
  assert.deepEqual(detectIdentityBounds(sample(null)),{left:0,top:0,right:100,bottom:100});
});
test("detects a vertically oriented card",()=>{
  const box=detectIdentityBounds(sample({x:70,y:80,w:110,h:180}));
  assert(box.left>3 && box.right>=45 && box.bottom>=43 && box.bottom<60);
});
