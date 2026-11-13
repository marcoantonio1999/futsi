export type IdentityBox = { left: number; top: number; right: number; bottom: number };
const full: IdentityBox = {left:0, top:0, right:100, bottom:100};

export function detectIdentityBounds(image: ImageData): IdentityBox {
  const {width, height, data} = image;
  if (width < 20 || height < 20) return full;
  const gray = new Uint8Array(width * height), gradients = new Uint16Array(width * height);
  const histogram = new Uint32Array(256);
  for (let i = 0; i < gray.length; i++) gray[i] = Math.round(.299 * data[i*4] + .587 * data[i*4+1] + .114 * data[i*4+2]);
  let count = 0, total = 0;
  for (let y=1; y<height-1; y++) for (let x=1; x<width-1; x++) {
    const i=y*width+x;
    const gx = -gray[i-width-1] - 2*gray[i-1] - gray[i+width-1] + gray[i-width+1] + 2*gray[i+1] + gray[i+width+1];
    const gy = -gray[i-width-1] - 2*gray[i-width] - gray[i-width+1] + gray[i+width-1] + 2*gray[i+width] + gray[i+width+1];
    const g=Math.min(255, Math.round(Math.hypot(gx,gy)/4));
    gradients[i]=g;
    if (x > width * .02 && x < width * .98 && y > height * .02 && y < height * .98) {
      histogram[g]++; count++; total+=g;
    }
  }
  let background=0, backgroundSum=0, maximum=-1, threshold=0;
  for (let level=0; level<255; level++) {
    background+=histogram[level]; backgroundSum+=level*histogram[level];
    const foreground=count-background;
    if (!background || !foreground) continue;
    const delta=backgroundSum/background-(total-backgroundSum)/foreground;
    const score=background*foreground*delta*delta;
    if (score>maximum) {maximum=score; threshold=level;}
  }
  threshold=Math.max(20,threshold);
  const edges=new Uint8Array(width*height);
  for (let i=0;i<edges.length;i++) if (gradients[i]>=threshold) edges[i]=1;

  // Connect nearby edge fragments before inspecting connected contours.
  const radius=Math.max(2,Math.round(Math.min(width,height)*.012));
  const horizontal=new Uint8Array(edges.length), expanded=new Uint8Array(edges.length);
  for (let y=0;y<height;y++) {
    let sum=0;
    for (let x=0;x<width;x++) {
      if(x+radius<width) sum+=edges[y*width+x+radius];
      if(x-radius-1>=0) sum-=edges[y*width+x-radius-1];
      if(x===0) for(let j=0;j<radius && j<width;j++) sum+=edges[y*width+j];
      horizontal[y*width+x]=sum>0?1:0;
    }
  }
  for(let x=0;x<width;x++){
    let sum=0;
    for(let y=0;y<height;y++){
      if(y+radius<height)sum+=horizontal[(y+radius)*width+x];
      if(y-radius-1>=0)sum-=horizontal[(y-radius-1)*width+x];
      if(y===0)for(let j=0;j<radius && j<height;j++)sum+=horizontal[j*width+x];
      expanded[y*width+x]=sum>0?1:0;
    }
  }
  const queue=new Int32Array(width*height);
  let best: {x1:number;y1:number;x2:number;y2:number;score:number}|null=null;
  for(let index=0;index<expanded.length;index++){
    if(!expanded[index]) continue;
    expanded[index]=0;let start=0,end=0;queue[end++]=index;
    let x1=width,y1=height,x2=0,y2=0;
    while(start<end){
      const pos=queue[start++],x=pos%width,y=Math.floor(pos/width);
      x1=Math.min(x1,x);x2=Math.max(x2,x);y1=Math.min(y1,y);y2=Math.max(y2,y);
      const neighbours=[pos-1,pos+1,pos-width,pos+width];
      for(let k=0;k<4;k++){
        if((k===0&&x===0)||(k===1&&x===width-1)||(k===2&&y===0)||(k===3&&y===height-1))continue;
        const next=neighbours[k];if(expanded[next]){expanded[next]=0;queue[end++]=next;}
      }
    }
    const w=x2-x1+1,h=y2-y1+1,aspect=w/h,area=w*h;
    const cardShape = (aspect >= 1.25 && aspect <= 2.1) || (aspect >= 1 / 2.1 && aspect <= 1 / 1.25);
    if(!cardShape||w<width*.08||h<height*.05||area>width*height*.8)continue;
    const score=area;
    if(!best||score>best.score)best={x1,y1,x2,y2,score};
  }
  if(!best)return full;
  const pad=radius+2;
  return {left:Math.max(0,Math.floor((best.x1-pad)*100/width)),top:Math.max(0,Math.floor((best.y1-pad)*100/height)),
    right:Math.min(100,Math.ceil((best.x2+pad)*100/width)),bottom:Math.min(100,Math.ceil((best.y2+pad)*100/height))};
}
