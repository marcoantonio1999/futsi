// Synthetic canvas stream only: no physical camera, permissions, or personal images.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const output='C:/Users/daniel/Documents/marco/mexprod/tmp/outputs/enrollment-camera';await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
try{for(const width of [320,390,1440]){for(const [selfie,facing,mirror] of [[true,'user',true],[false,'environment',false],[true,'',true],[false,'user',true]]){
 const page=await browser.newPage({viewport:{width,height:900}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(({facing})=>{
  Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:async()=>{
   const canvas=document.createElement('canvas');canvas.width=1200;canvas.height=1200;
   const ctx=canvas.getContext('2d');ctx.fillStyle='red';ctx.fillRect(0,0,600,1200);ctx.fillStyle='blue';ctx.fillRect(600,0,600,1200);
   const stream=canvas.captureStream(10),track=stream.getVideoTracks()[0];
   const settings=track.getSettings.bind(track);track.getSettings=()=>({...settings(),facingMode:facing});
   return stream;
  }});
 },{facing});
 await page.goto(`http://127.0.0.1:5213/tests/enrollment-camera-preview.html?selfie=${selfie}`);
 const capture=page.getByRole('button',{name:'Tomar foto',exact:true});await capture.waitFor();
 await page.waitForFunction(()=>!document.querySelector('footer .primary')?.disabled);
 const transform=await page.locator('video').evaluate(el=>getComputedStyle(el).transform);
 assert.equal(transform,mirror?'matrix(-1, 0, 0, 1, 0, 0)':'none');
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 if(selfie&&facing==='user')await page.screenshot({path:`${output}/mirror-${width}.png`});
 await capture.click();await page.getByTestId('capture').waitFor();
 const pixels=await page.getByTestId('capture').evaluate(async img=>{
  await img.decode();const canvas=document.createElement('canvas');canvas.width=1200;canvas.height=1200;
  const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0);return {left:[...ctx.getImageData(100,100,1,1).data],right:[...ctx.getImageData(1100,100,1,1).data]};
 });
 assert(pixels.left[0]>200&&pixels.left[2]<30,'Saved original left remains red');
 assert(pixels.right[2]>200&&pixels.right[0]<30,'Saved original right remains blue');
 assert.deepEqual(errors,[]);console.log(JSON.stringify({width,selfie,facing,mirror,originalCapture:true,noOverflow:true}));await page.close();
}}}finally{await browser.close();}
